import { basename } from 'node:path'
import { dialog, ipcMain, nativeTheme, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z, type ZodType } from 'zod'
import { asResult, DesktopError } from '@main/errors'
import type { AppDatabase } from '@main/services/database'
import type { ExportService } from '@main/services/export'
import type { GlobalSearchService } from '@main/services/global-search'
import type { WorkspaceService } from '@main/services/workspace'
import { IPC, type DocumentSnapshot, type OpenFileRequest } from '@shared/contracts'
import {
  createEntrySchema,
  documentTargetSchema,
  environmentNameSchema,
  environmentStateSchema,
  exportRequestSchema,
  externalUrlSchema,
  globalSearchRequestSchema,
  idSchema,
  projectImportSelectionSchema,
  relativePathSchema,
  renameEntrySchema,
  saveDocumentSchema,
  settingsSchema,
  updateProjectSchema
} from '@shared/schemas'

interface IpcDependencies {
  database: AppDatabase
  workspace: WorkspaceService
  exports: ExportService
  search: GlobalSearchService
  getWindow: () => BrowserWindow | null
  getPendingOpenRequest: () => OpenFileRequest | undefined
  acceptSystemOpenFile: (token: string) => Promise<DocumentSnapshot>
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new DesktopError('INVALID_PATH', 'Aladdeen rejected an invalid request.', z.prettifyError(result.error))
  return result.data
}

function requireTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) {
    throw new DesktopError('PERMISSION_DENIED', 'The request did not come from the Aladdeen window.')
  }
  if (event.senderFrame && event.senderFrame !== window.webContents.mainFrame) {
    throw new DesktopError('PERMISSION_DENIED', 'Subframes cannot use desktop features.')
  }
}

export function registerIpc({
  database,
  workspace,
  exports,
  search,
  getWindow,
  getPendingOpenRequest,
  acceptSystemOpenFile
}: IpcDependencies): void {
  const handle = <T>(channel: string, operation: (event: IpcMainInvokeEvent, input: unknown) => Promise<T>): void => {
    ipcMain.handle(channel, (event, input) => asResult(async () => {
      requireTrustedSender(event, getWindow())
      return operation(event, input)
    }))
  }

  handle(IPC.bootstrap, async () => {
    const environments = database.listEnvironments()
    const preferred = database.getActiveEnvironmentId()
    const active = environments.find((environment) => environment.id === preferred) ?? environments[0]
    return {
      settings: database.getSettings(),
      environment: active ? await workspace.activateEnvironment(active.id) : null,
      pendingOpenRequest: getPendingOpenRequest()
    }
  })

  handle(IPC.createEnvironment, async (_event, input) => {
    search.cancelActive()
    const environment = database.createEnvironment(parse(environmentNameSchema, input))
    return workspace.activateEnvironment(environment.id)
  })

  handle(IPC.renameEnvironment, async (_event, input) => {
    const request = parse(z.object({ environmentId: idSchema, name: environmentNameSchema }), input)
    database.renameEnvironment(request.environmentId, request.name)
    return workspace.getSnapshot()
  })

  handle(IPC.removeEnvironment, async (_event, input) => {
    search.cancelActive()
    const environmentId = parse(idSchema, input)
    const wasActive = workspace.activeEnvironmentId === environmentId
    database.removeEnvironment(environmentId)
    if (!wasActive) return workspace.getSnapshot()
    const next = database.listEnvironments()[0]
    if (!next) {
      await workspace.deactivateEnvironment()
      return null
    }
    return workspace.activateEnvironment(next.id)
  })

  handle(IPC.switchEnvironment, async (_event, input) => {
    search.cancelActive()
    return workspace.activateEnvironment(parse(idSchema, input))
  })
  handle(IPC.refreshEnvironment, async () => workspace.getSnapshot())
  handle(IPC.persistEnvironmentState, async (_event, input) => {
    const state = parse(environmentStateSchema, input)
    workspace.persistEnvironmentState(state.openFileIds, state.activeFileId)
  })

  handle(IPC.createProject, async (_event, input) => {
    const name = parse(environmentNameSchema, input)
    const result = await showOpenDialog(getWindow(), {
      title: 'Choose where to create the project folder',
      buttonLabel: 'Choose location',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) throw new DesktopError('CANCELLED', 'New folder was cancelled.')
    return workspace.createProject(result.filePaths[0], name)
  })

  handle(IPC.chooseProjects, async () => {
    const result = await showOpenDialog(getWindow(), {
      title: 'Choose Markdown project folders',
      buttonLabel: 'Review projects',
      properties: ['openDirectory', 'createDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) throw new DesktopError('CANCELLED', 'Add project was cancelled.')
    return workspace.prepareProjectImports(result.filePaths)
  })

  handle(IPC.commitProjectImport, async (_event, input) => {
    const selections = parse(z.array(projectImportSelectionSchema).min(1).max(100), input)
    return workspace.commitProjectImports(selections)
  })
  handle(IPC.removeProject, async (_event, input) => workspace.removeProject(parse(idSchema, input)))
  handle(IPC.persistExpandedPaths, async (_event, input) => {
    const request = parse(z.object({ projectId: idSchema, paths: z.array(relativePathSchema).max(5_000) }), input)
    workspace.persistExpandedPaths(request.projectId, request.paths)
  })
  handle(IPC.inspectProjectScope, async (_event, input) => workspace.inspectProjectScope(parse(idSchema, input)))
  handle(IPC.updateProject, async (_event, input) => workspace.updateProject(parse(updateProjectSchema, input)))
  handle(IPC.listProjectChildren, async (_event, input) => {
    const request = parse(z.object({
      projectId: idSchema,
      parentPath: relativePathSchema,
      cursor: z.number().int().min(0).max(1_000_000).optional()
    }), input)
    return workspace.listProjectChildren(request.projectId, request.parentPath, request.cursor)
  })
  handle(IPC.searchProjectFiles, async (_event, input) => {
    const request = parse(z.object({
      query: z.string().max(500),
      limit: z.number().int().min(1).max(100).optional()
    }), input)
    return workspace.searchProjectFiles(request.query, request.limit)
  })
  handle(IPC.startGlobalSearch, async (_event, input) => search.start(parse(globalSearchRequestSchema, input)))
  handle(IPC.cancelGlobalSearch, async (_event, input) => search.cancel(parse(idSchema, input)))

  handle(IPC.openDocument, async (_event, input) => workspace.openDocument(parse(documentTargetSchema, input)))
  handle(IPC.readDocument, async (_event, input) => workspace.readDocument(parse(idSchema, input)))
  handle(IPC.openRelativeDocument, async (_event, input) => {
    const request = parse(z.object({ fileId: idSchema, target: relativePathSchema }), input)
    return workspace.openRelativeDocument(request.fileId, request.target)
  })
  handle(IPC.openFile, async () => {
    const result = await showOpenDialog(getWindow(), {
      title: 'Open Markdown file',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (result.canceled || !result.filePaths[0]) throw new DesktopError('CANCELLED', 'Open file was cancelled.')
    return workspace.openAbsoluteDocument(result.filePaths[0])
  })
  handle(IPC.openDroppedFile, async (_event, input) => workspace.openAbsoluteDocument(parse(z.string().min(1).max(16_384), input)))
  handle(IPC.acceptSystemOpenFile, async (_event, input) => acceptSystemOpenFile(parse(idSchema, input)))
  handle(IPC.saveDocument, async (_event, input) => workspace.saveDocument(parse(saveDocumentSchema, input)))
  handle(IPC.saveCopy, async (_event, input) => {
    const request = parse(z.object({ fileId: idSchema, content: z.string().max(20_000_000) }), input)
    return exports.saveCopy(request.fileId, request.content)
  })

  handle(IPC.createEntry, async (_event, input) => {
    if (input) return workspace.createEntry(parse(createEntrySchema, input))
    const result = await showSaveDialog(getWindow(), {
      title: 'Create Markdown file',
      defaultPath: 'Untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (result.canceled || !result.filePath) throw new DesktopError('CANCELLED', 'New file was cancelled.')
    return workspace.createStandaloneFile(result.filePath)
  })

  handle(IPC.createFolder, async (_event, input) => workspace.createFolder(parse(createEntrySchema, input)))
  handle(IPC.renameEntry, async (_event, input) => workspace.renameEntry(parse(renameEntrySchema, input)))
  handle(IPC.trashEntry, async (_event, input) => {
    const request = parse(z.object({ projectId: idSchema, path: relativePathSchema }), input)
    const fullPath = await workspace.getProjectEntryPath(request.projectId, request.path)
    await shell.trashItem(fullPath)
    await workspace.markPathMissing(request.projectId, request.path)
  })
  handle(IPC.revealProjectEntry, async (_event, input) => {
    const request = parse(z.object({ projectId: idSchema, path: relativePathSchema }), input)
    shell.showItemInFolder(await workspace.getProjectEntryPath(request.projectId, request.path))
  })
  handle(IPC.revealTrackedFile, async (_event, input) => shell.showItemInFolder(workspace.getTrackedFilePath(parse(idSchema, input))))
  handle(IPC.trashTrackedFile, async (_event, input) => {
    const fileId = parse(idSchema, input)
    await shell.trashItem(workspace.getTrackedFilePath(fileId))
    workspace.markTrackedFileMissing(fileId)
  })
  handle(IPC.removeTrackedFile, async (_event, input) => workspace.removeTrackedFile(parse(idSchema, input)))
  handle(IPC.locateTrackedFile, async (_event, input) => {
    const fileId = parse(idSchema, input)
    const currentPath = workspace.getTrackedFilePath(fileId)
    const result = await showOpenDialog(getWindow(), {
      title: `Locate ${basename(currentPath)}`,
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (result.canceled || !result.filePaths[0]) throw new DesktopError('CANCELLED', 'Locate file was cancelled.')
    return workspace.locateTrackedFile(fileId, result.filePaths[0])
  })

  handle(IPC.getSettings, async () => database.getSettings())
  handle(IPC.updateSettings, async (_event, input) => {
    const settings = database.setSettings(parse(settingsSchema, input))
    nativeTheme.themeSource = settings.theme
    return settings
  })
  handle(IPC.exportDocument, async (_event, input) => exports.exportDocument(parse(exportRequestSchema, input)))
  handle(IPC.openExternal, async (_event, input) => shell.openExternal(parse(externalUrlSchema, input)))
}

function showOpenDialog(window: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}

function showSaveDialog(window: BrowserWindow | null, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}
