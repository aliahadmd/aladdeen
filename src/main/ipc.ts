import { basename, extname } from 'node:path'
import { isAnyArrayBuffer } from 'node:util/types'
import {
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { z, type ZodType } from 'zod'
import { asResult, DesktopError } from '@main/errors'
import type { AgentAuthService } from '@main/services/agent-auth'
import type { AgentService } from '@main/services/agent'
import type { AppDatabase } from '@main/services/database'
import type { ExportService } from '@main/services/export'
import type { GlobalSearchService } from '@main/services/global-search'
import type { WorkspaceService } from '@main/services/workspace'
import { agentSessionMustStopForSettingsChange } from '@shared/agent-settings'
import { IPC, type DocumentSnapshot, type OpenFileRequest } from '@shared/contracts'
import { defaultNameForKind, DOCUMENT_EXTENSIONS, MAX_DROPPED_DOCUMENTS } from '@shared/documents'
import {
  agentBeginLoginSchema,
  agentLoginPromptResponseSchema,
  agentApprovalResponseSchema,
  agentModelRequestSchema,
  agentPromptSchema,
  agentProviderSchema,
  agentProviderModelSchema,
  agentProviderProfileInputSchema,
  agentProviderProfileUpdateSchema,
  agentSessionSchema,
  agentStartSessionSchema,
  agentThinkingRequestSchema,
  createEntrySchema,
  createStandaloneDocumentSchema,
  documentContentSchema,
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
  saveBinaryDocumentSchema,
  settingsSchema,
  updateProjectSchema
} from '@shared/schemas'

interface IpcDependencies {
  database: AppDatabase
  workspace: WorkspaceService
  exports: ExportService
  search: GlobalSearchService
  agent: AgentService
  agentAuth: AgentAuthService
  getWindow: () => BrowserWindow | null
  getPendingOpenRequest: () => OpenFileRequest | undefined
  acceptSystemOpenFile: (token: string) => Promise<DocumentSnapshot>
  completeClose: (requestId: string, outcome: 'ready' | 'blocked' | 'cancelled') => void
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new DesktopError('INVALID_PATH', 'Aladdeen rejected an invalid request.', z.prettifyError(result.error))
  return result.data
}

function requireTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  window: BrowserWindow | null
): void {
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
  agent,
  agentAuth,
  getWindow,
  getPendingOpenRequest,
  acceptSystemOpenFile,
  completeClose
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
  handle(IPC.completeClose, async (_event, input) => {
    const completion = parse(z.object({
      requestId: idSchema,
      outcome: z.enum(['ready', 'blocked', 'cancelled'])
    }), input)
    completeClose(completion.requestId, completion.outcome)
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
      title: 'Choose document project folders',
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
  handle(IPC.agentStartSession, async (_event, input) => {
    const request = parse(agentStartSessionSchema, input)
    return agent.startSession(request.projectId)
  })
  handle(IPC.agentStopSession, async (_event, input) => {
    const request = parse(agentSessionSchema, input)
    return agent.stopSession(request.sessionId)
  })
  handle(IPC.agentPrompt, async (_event, input) => {
    const request = parse(agentPromptSchema, input)
    return agent.prompt(request.sessionId, request.message, request.steer)
  })
  handle(IPC.agentAbort, async (_event, input) => {
    const request = parse(agentSessionSchema, input)
    return agent.abort(request.sessionId)
  })
  handle(IPC.agentRespondApproval, async (_event, input) => {
    const request = parse(agentApprovalResponseSchema, input)
    return agent.respondApproval(request.sessionId, request.requestId, request.decision)
  })
  handle(IPC.agentSetModel, async (_event, input) => {
    const request = parse(agentModelRequestSchema, input)
    return agent.setModel(request.sessionId, request.provider, request.modelId)
  })
  handle(IPC.agentGetModels, async (_event, input) => {
    const request = parse(agentSessionSchema, input)
    return agent.getModels(request.sessionId)
  })
  handle(IPC.agentSetThinkingLevel, async (_event, input) => {
    const request = parse(agentThinkingRequestSchema, input)
    return agent.setThinkingLevel(request.sessionId, request.level)
  })
  handle(IPC.agentBeginLogin, async (_event, input) => {
    const request = typeof input === 'string'
      ? { providerId: parse(agentProviderSchema, input), authType: 'oauth' as const }
      : parse(agentBeginLoginSchema, input)
    return agentAuth.beginLogin(request.providerId, request.authType)
  })
  handle(IPC.agentRespondLoginPrompt, async (_event, input) => {
    const request = parse(agentLoginPromptResponseSchema, input)
    await agentAuth.respondLoginPrompt(request.attemptId, request.promptId, request.value)
  })
  handle(IPC.agentReopenLoginUrl, async (_event, input) => {
    await agentAuth.reopenLoginUrl(parse(idSchema, input))
  })
  handle(IPC.agentCancelLogin, async (_event, input) => {
    await agentAuth.cancelLogin(parse(idSchema, input))
  })
  handle(IPC.agentDisconnectProvider, async (_event, input) => {
    await agentAuth.disconnectProvider(parse(agentProviderSchema, input))
  })
  handle(IPC.agentCredentialStatus, async () => agentAuth.credentialStatus())
  handle(IPC.agentGetModelCatalog, async () => agentAuth.getModelCatalog())
  handle(IPC.agentGetProviderCatalog, async () => agentAuth.getProviderCatalog())
  handle(IPC.agentGetProviderProfiles, async () => agentAuth.getProviderProfiles())
  handle(IPC.agentCreateProviderProfile, async (_event, input) => {
    return agentAuth.createProviderProfile(parse(agentProviderProfileInputSchema, input))
  })
  handle(IPC.agentUpdateProviderProfile, async (_event, input) => {
    const request = parse(agentProviderProfileUpdateSchema, input)
    return agentAuth.updateProviderProfile(request.providerId, request.profile)
  })
  handle(IPC.agentDeleteProviderProfile, async (_event, input) => {
    await agentAuth.deleteProviderProfile(parse(agentProviderSchema, input))
  })
  handle(IPC.agentDiscoverModels, async (_event, input) => {
    return agentAuth.discoverModels(parse(agentProviderSchema, input))
  })
  handle(IPC.agentRefreshModelCatalog, async (_event, input) => {
    return agentAuth.refreshModelCatalog(parse(agentProviderSchema, input))
  })
  handle(IPC.agentVerifyModel, async (_event, input) => {
    const request = parse(agentProviderModelSchema, input)
    return agentAuth.verifyModel(request.providerId, request.modelId)
  })
  handle(IPC.openDocument, async (_event, input) => workspace.openDocument(parse(documentTargetSchema, input)))
  handle(IPC.readDocument, async (_event, input) => workspace.readDocument(parse(idSchema, input)))
  handle(IPC.openRelativeDocument, async (_event, input) => {
    const request = parse(z.object({ fileId: idSchema, target: relativePathSchema }), input)
    return workspace.openRelativeDocument(request.fileId, request.target)
  })
  handle(IPC.openFile, async () => {
    const result = await showOpenDialog(getWindow(), {
      title: 'Open document',
      properties: ['openFile'],
      filters: [{ name: 'Aladdeen documents', extensions: [...DOCUMENT_EXTENSIONS] }]
    })
    if (result.canceled || !result.filePaths[0]) throw new DesktopError('CANCELLED', 'Open file was cancelled.')
    return workspace.openAbsoluteDocument(result.filePaths[0])
  })
  handle(IPC.openDroppedFile, async (_event, input) => {
    const paths = parse(z.array(z.string().min(1).max(16_384)).min(1).max(MAX_DROPPED_DOCUMENTS), input)
    const documents: DocumentSnapshot[] = []
    for (const path of paths) documents.push(await workspace.openAbsoluteDocument(path))
    return documents
  })
  handle(IPC.acceptSystemOpenFile, async (_event, input) => acceptSystemOpenFile(parse(idSchema, input)))
  handle(IPC.saveDocument, async (_event, input) => workspace.saveDocument(parse(saveDocumentSchema, input)))
  handle(IPC.saveDocumentAs, async (_event, input) => {
    const request = parse(saveDocumentSchema, input)
    const currentPath = workspace.getTrackedFilePath(request.fileId)
    const kind = workspace.getTrackedDocumentKind(request.fileId)
    if (kind !== 'markdown' && kind !== 'html') {
      throw new DesktopError('INVALID_FILE', 'Binary documents use their own Save As workflow.')
    }
    const extension = extname(currentPath)
    const result = await showSaveDialog(getWindow(), {
      title: `Save ${kind === 'html' ? 'HTML' : 'Markdown'} as`,
      defaultPath: `${basename(currentPath, extension)} copy${extension}`,
      filters: [{
        name: kind === 'html' ? 'HTML document' : 'Markdown document',
        extensions: kind === 'html' ? ['html', 'htm'] : ['md', 'markdown']
      }]
    })
    if (result.canceled || !result.filePath) {
      throw new DesktopError('CANCELLED', 'Save As was cancelled.')
    }
    return workspace.saveTextDocumentAs(request, result.filePath)
  })
  handle(IPC.releaseDocumentSession, async (_event, input) => {
    workspace.releaseBinarySession(parse(idSchema, input))
  })
  handle(IPC.saveCopy, async (_event, input) => {
    const request = parse(z.object({ fileId: idSchema, content: documentContentSchema }), input)
    return exports.saveCopy(request.fileId, request.content)
  })

  handle(IPC.createEntry, async (_event, input) => {
    if ('projectId' in (input as Record<string, unknown>)) {
      return workspace.createEntry(parse(createEntrySchema, input))
    }
    const request = parse(createStandaloneDocumentSchema, input)
    const result = await showSaveDialog(getWindow(), {
      title: 'Create document',
      defaultPath: defaultNameForKind(request.documentKind),
      filters: [{
        name: request.documentKind === 'markdown'
          ? 'Markdown'
          : request.documentKind === 'html'
            ? 'HTML'
            : request.documentKind === 'docx'
              ? 'Word document'
              : request.documentKind === 'xlsx'
                ? 'Excel workbook'
                : 'PowerPoint presentation',
        extensions: request.documentKind === 'markdown'
          ? ['md', 'markdown']
          : request.documentKind === 'html'
            ? ['html', 'htm']
            : request.documentKind === 'docx'
              ? ['docx']
              : request.documentKind === 'xlsx'
                ? ['xlsx']
                : ['pptx']
      }]
    })
    if (result.canceled || !result.filePath) throw new DesktopError('CANCELLED', 'New file was cancelled.')
    return workspace.createStandaloneFile(result.filePath, request.documentKind)
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
  handle(IPC.revealTrackedFile, async (_event, input) => {
    shell.showItemInFolder(await workspace.resolveTrackedFilePath(parse(idSchema, input)))
  })
  handle(IPC.trashTrackedFile, async (_event, input) => {
    const fileId = parse(idSchema, input)
    await shell.trashItem(await workspace.resolveTrackedFilePath(fileId))
    workspace.markTrackedFileMissing(fileId)
  })
  handle(IPC.removeTrackedFile, async (_event, input) => workspace.removeTrackedFile(parse(idSchema, input)))
  handle(IPC.locateTrackedFile, async (_event, input) => {
    const fileId = parse(idSchema, input)
    const currentPath = workspace.getTrackedFilePath(fileId)
    const result = await showOpenDialog(getWindow(), {
      title: `Locate ${basename(currentPath)}`,
      properties: ['openFile'],
      filters: [{ name: 'Aladdeen documents', extensions: [...DOCUMENT_EXTENSIONS] }]
    })
    if (result.canceled || !result.filePaths[0]) throw new DesktopError('CANCELLED', 'Locate file was cancelled.')
    return workspace.locateTrackedFile(fileId, result.filePaths[0])
  })

  handle(IPC.getSettings, async () => database.getSettings())
  handle(IPC.updateSettings, async (_event, input) => {
    const previousSettings = database.getSettings()
    const requestedSettings = parse(settingsSchema, input)
    if (
      requestedSettings.agentProvider !== previousSettings.agentProvider ||
      requestedSettings.agentModelId !== previousSettings.agentModelId
    ) {
      agentAuth.validateDefaultModelSelection(
        requestedSettings.agentProvider,
        requestedSettings.agentModelId
      )
    }
    const settings = database.setSettings(requestedSettings)
    nativeTheme.themeSource = settings.theme
    if (agentSessionMustStopForSettingsChange(previousSettings, settings)) {
      await agent.close()
      if (!settings.agentEnabled || previousSettings.agentProvider !== settings.agentProvider) {
        await agentAuth.close()
      }
    } else if (previousSettings.agentThinkingLevel !== settings.agentThinkingLevel) {
      await agent.applyConfiguredThinkingLevel(settings.agentThinkingLevel).catch(() => undefined)
    }
    return settings
  })
  handle(IPC.exportDocument, async (_event, input) => exports.exportDocument(parse(exportRequestSchema, input)))
  handle(IPC.openExternal, async (_event, input) => shell.openExternal(parse(externalUrlSchema, input)))

  ipcMain.on(IPC.saveBinaryDocument, (event, input) => {
    const port = event.ports[0]
    if (!port) return
    void asResult(async () => {
      requireTrustedSender(event, getWindow())
      const request = parse(saveBinaryDocumentSchema, input)
      const data = await receiveBinaryPayload(port, request.byteLength)
      let destinationPath: string | undefined
      if (request.saveAs) {
        const currentPath = workspace.getTrackedFilePath(request.fileId)
        const kind = workspace.getTrackedDocumentKind(request.fileId)
        const extension = kind
        const result = await showSaveDialog(getWindow(), {
          title: `Save ${kind.toUpperCase()} as`,
          defaultPath: `${basename(currentPath, `.${extension}`)} copy.${extension}`,
          filters: [{
            name: kind === 'docx'
              ? 'Word document'
              : kind === 'xlsx'
                ? 'Excel workbook'
                : kind === 'pptx'
                  ? 'PowerPoint presentation'
                  : 'PDF document',
            extensions: [extension]
          }]
        })
        if (result.canceled || !result.filePath) {
          throw new DesktopError('CANCELLED', 'Save As was cancelled.')
        }
        destinationPath = result.filePath
      }
      return workspace.saveBinaryDocument(request, data, destinationPath)
    }).then((result) => {
      port.postMessage(result)
      port.close()
    })
  })
}

function showOpenDialog(window: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}

function showSaveDialog(window: BrowserWindow | null, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}

function receiveBinaryPayload(
  port: Electron.MessagePortMain,
  expectedBytes: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The binary save transfer timed out.')), 30_000)
    port.once('message', (event) => {
      clearTimeout(timeout)
      const data = binaryPayload(event.data)
      if (!data || data.byteLength !== expectedBytes) {
        reject(new Error(
          `The binary save transfer was incomplete (expected ${expectedBytes} bytes, received ${data?.byteLength ?? binaryPayloadDescription(event.data)}).`
        ))
        return
      }
      resolve(data)
    })
    port.start()
  })
}

function binaryPayloadDescription(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value !== 'object') return typeof value
  return Object.prototype.toString.call(value)
}

function binaryPayload(value: unknown): Uint8Array | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'bytes' in value
  ) {
    return binaryPayload((value as { bytes?: unknown }).bytes)
  }
  if (isAnyArrayBuffer(value)) {
    return new Uint8Array(value as ArrayBuffer)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}
