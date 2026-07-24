import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { access } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  protocol,
  session,
  type MenuItemConstructorOptions
} from 'electron'
import { AppDatabase } from '@main/services/database'
import { ExportService } from '@main/services/export'
import { GlobalSearchService } from '@main/services/global-search'
import { WorkspaceService } from '@main/services/workspace'
import { registerIpc } from '@main/ipc'
import { IPC, type DocumentSnapshot, type OpenFileRequest } from '@shared/contracts'

const mainBundleDirectory = import.meta.dirname
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aladdeen-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let workspace: WorkspaceService | null = null
let globalSearch: GlobalSearchService | null = null
let pendingSystemFile: string | null = null
let pendingOpenRequest: OpenFileRequest | undefined
let quitting = false
const systemOpenTokens = new Map<string, { path: string; expiresAt: number }>()

function extractMarkdownPath(argv: string[]): string | null {
  return argv.find((argument) => MARKDOWN_EXTENSIONS.has(extname(argument).toLowerCase())) ?? null
}

const initialSystemPath = extractMarkdownPath(process.argv.slice(1))
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const filePath = extractMarkdownPath(argv)
  if (filePath) void openSystemFile(filePath)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) void openSystemFile(filePath)
  else pendingSystemFile = filePath
})

app.whenReady().then(async () => {
  const previousApplicationDirectory = process.platform === 'linux'
    ? ['fl', 'uid', 'md'].join('')
    : ['Fl', 'uid', 'MD'].join('')
  const previousUserDataPath = app.commandLine.hasSwitch('user-data-dir')
    ? undefined
    : join(app.getPath('appData'), previousApplicationDirectory)
  database = new AppDatabase(
    app.getPath('userData'),
    previousUserDataPath
  )
  const settings = database.getSettings()
  nativeTheme.themeSource = settings.theme

  workspace = new WorkspaceService(database, (environmentEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.environmentEvent, environmentEvent)
  })
  globalSearch = new GlobalSearchService(database, workspace, () => mainWindow)

  const exportService = new ExportService(workspace, () => mainWindow)
  registerIpc({
    database,
    workspace,
    exports: exportService,
    search: globalSearch,
    getWindow: () => mainWindow,
    getPendingOpenRequest: () => pendingOpenRequest,
    acceptSystemOpenFile
  })
  registerAssetProtocol(workspace)
  configureSessionSecurity()
  const fileToOpen = pendingSystemFile ?? initialSystemPath
  pendingSystemFile = null
  if (fileToOpen) await openSystemFile(fileToOpen)

  createWindow()
  installMenu()
})

function createWindow(): void {
  const state = database?.getWindowState()
  mainWindow = new BrowserWindow({
    x: state?.x,
    y: state?.y,
    width: state?.width ?? 1280,
    height: state?.height ?? 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#f7f7f9',
    title: 'Aladdeen',
    webPreferences: {
      preload: join(mainBundleDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  if (state?.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(mainBundleDirectory, '../renderer/index.html'))
  }

  let boundsTimer: NodeJS.Timeout | undefined
  const rememberBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!mainWindow || !database || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getNormalBounds()
      database.setWindowState({ ...bounds, maximized: mainWindow.isMaximized() })
    }, 250)
  }
  mainWindow.on('resize', rememberBounds)
  mainWindow.on('move', rememberBounds)
  mainWindow.on('maximize', rememberBounds)
  mainWindow.on('unmaximize', rememberBounds)
  mainWindow.on('closed', () => {
    globalSearch?.cancelActive(false)
    mainWindow = null
  })
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function registerAssetProtocol(service: WorkspaceService): void {
  protocol.handle('aladdeen-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'document') return new Response('Not found', { status: 404 })
      const fileId = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const target = url.searchParams.get('path')
      if (!fileId || !target) return new Response('Not found', { status: 404 })
      const asset = await service.readAsset(fileId, target)
      return new Response(Uint8Array.from(asset.data), {
        status: 200,
        headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

async function openSystemFile(filePath: string): Promise<void> {
  if (!workspace || !database || !MARKDOWN_EXTENSIONS.has(extname(filePath).toLowerCase())) return
  try {
    await access(filePath)
    const token = randomUUID()
    const now = Date.now()
    for (const [candidate, request] of systemOpenTokens) if (request.expiresAt < now) systemOpenTokens.delete(candidate)
    systemOpenTokens.set(token, { path: filePath, expiresAt: now + 3_600_000 })
    pendingOpenRequest = { token, name: filePath.split(/[\\/]/).pop() ?? 'Markdown file' }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.send(IPC.systemOpenFileRequest, pendingOpenRequest)
    }
  } catch {
    // Ignore paths removed between the OS event and application readiness.
  }
}

async function acceptSystemOpenFile(token: string): Promise<DocumentSnapshot> {
  const request = systemOpenTokens.get(token)
  systemOpenTokens.delete(token)
  if (!request || request.expiresAt < Date.now()) throw new Error('The file-open request expired. Open the file again.')
  pendingOpenRequest = undefined
  if (!workspace) throw new Error('Aladdeen is not ready.')
  return workspace.openAbsoluteDocument(request.path)
}

function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Search Environment…',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.globalSearchOpenRequest)
            }
          }
        },
        { type: 'separator' },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  quitting = true
  globalSearch?.close()
  void workspace?.close()
  database?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit()
})
