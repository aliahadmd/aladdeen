import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  net,
  nativeTheme,
  protocol,
  session,
  type MenuItemConstructorOptions
} from 'electron'
import { AppDatabase } from '@main/services/database'
import { AiService } from '@main/services/ai/service'
import { ExportService } from '@main/services/export'
import { GlobalSearchService } from '@main/services/global-search'
import { resolveUserDataPolicy } from '@main/services/user-data-policy'
import { WorkspaceService } from '@main/services/workspace'
import { registerIpc } from '@main/ipc'
import { IPC, type CloseReason, type DocumentSnapshot, type OpenFileRequest } from '@shared/contracts'
import { documentKindFromName, isSupportedDocumentName } from '@shared/documents'

const mainBundleDirectory = import.meta.dirname
const productionRendererCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: aladdeen-asset:",
  "font-src 'self' data: blob: aladdeen-asset:",
  "connect-src 'self' aladdeen-document: aladdeen-asset:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aladdeen-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  {
    scheme: 'aladdeen-document',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let workspace: WorkspaceService | null = null
let globalSearch: GlobalSearchService | null = null
let aiService: AiService | null = null
let pendingSystemFile: string | null = null
let pendingOpenRequest: OpenFileRequest | undefined
let quitting = false
let allowWindowClose = false
let allowApplicationQuit = false
let servicesClosed = false
let pendingClose: {
  id: string
  reason: CloseReason
  action: 'close' | 'quit' | 'reload'
  timeout?: NodeJS.Timeout
  blocked: boolean
} | null = null
const systemOpenTokens = new Map<string, { path: string; expiresAt: number }>()
const userDataPolicy = resolveUserDataPolicy({
  appDataPath: app.getPath('appData'),
  isPackaged: app.isPackaged,
  hasExplicitUserDataPath: app.commandLine.hasSwitch('user-data-dir')
})
if (userDataPolicy.userDataPath) app.setPath('userData', userDataPolicy.userDataPath)

function extractDocumentPath(argv: string[]): string | null {
  return argv.find((argument) => isSupportedDocumentName(argument)) ?? null
}

const initialSystemPath = extractDocumentPath(process.argv.slice(1))
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const filePath = extractDocumentPath(argv)
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

void app.whenReady().then(async () => {
  database = new AppDatabase(
    app.getPath('userData'),
    userDataPolicy.previousUserDataPath
  )
  const settings = database.getSettings()
  nativeTheme.themeSource = settings.theme

  workspace = new WorkspaceService(database, (environmentEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.environmentEvent, environmentEvent)
  })
  globalSearch = new GlobalSearchService(database, workspace, () => mainWindow)
  const exportService = new ExportService(workspace, () => mainWindow)
  aiService = new AiService(database, workspace, () => mainWindow)
  registerIpc({
    database,
    workspace,
    exports: exportService,
    search: globalSearch,
    ai: aiService,
    getWindow: () => mainWindow,
    getPendingOpenRequest: () => pendingOpenRequest,
    acceptSystemOpenFile,
    completeClose
  })
  registerAssetProtocol(workspace)
  registerDocumentProtocol(workspace)
  configureSessionSecurity()
  const fileToOpen = pendingSystemFile ?? initialSystemPath
  pendingSystemFile = null
  if (fileToOpen) await openSystemFile(fileToOpen)

  createWindow()
  installMenu()
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'An unexpected startup error occurred.'
  console.error('Aladdeen failed to start:', error)
  dialog.showErrorBox(
    'Aladdeen could not start',
    `${message}\n\nYour documents were not changed. Restart Aladdeen after resolving the error.`
  )
  app.exit(1)
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#f7f7f9',
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
  // The PPTX presenter view opens a scripted about:blank child window and
  // draws into it from the opener. Allow exactly that shape and nothing
  // else; the child inherits the default session, so network egress stays
  // blocked, and the hardening below pins it to about:blank forever.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url !== 'about:blank') return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    }
  })
  mainWindow.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', (event) => event.preventDefault())
    child.webContents.on('will-attach-webview', (event) => event.preventDefault())
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
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
  mainWindow.on('close', (event) => {
    if (allowWindowClose) return
    event.preventDefault()
    requestClose('window-close', 'close')
  })
  mainWindow.on('unresponsive', () => {
    if (pendingClose?.blocked) void handleCloseTimeout(pendingClose.id)
  })
  mainWindow.on('closed', () => {
    globalSearch?.cancelActive(false)
    mainWindow = null
  })
}

function configureSessionSecurity(): void {
  // Fullscreen is the one capability the renderer legitimately needs: the
  // PPTX slide show presents through element.requestFullscreen(), and a
  // denied request leaves that promise permanently pending (no rejection,
  // no fullscreenerror), so the viewer can neither present nor fall back.
  // Everything else (camera, geolocation, notifications, …) stays denied.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'fullscreen')
  )
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'fullscreen')
  const developmentOrigin = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : null
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!/^(?:https?|wss?):/i.test(details.url)) {
      callback({})
      return
    }
    const allowedDevelopmentRequest = developmentOrigin
      ? new URL(details.url).origin === developmentOrigin
      : false
    callback({ cancel: !allowedDevelopmentRequest })
  })
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*'] }, (details, callback) => {
      if (!details.url.endsWith('/index.html')) {
        callback({})
        return
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [productionRendererCsp]
        }
      })
    })
  }
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

function registerDocumentProtocol(service: WorkspaceService): void {
  protocol.handle('aladdeen-document', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'session') return new Response('Not found', { status: 404 })
      const sessionId = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!sessionId) return new Response('Not found', { status: 404 })
      const document = await service.resolveBinarySession(sessionId)
      const response = await net.fetch(pathToFileURL(document.path).toString(), {
        headers: request.headers
      })
      const headers = new Headers(response.headers)
      headers.set('Content-Type', document.mimeType)
      headers.set('Cache-Control', 'no-store')
      headers.set('Content-Disposition', 'inline')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

async function openSystemFile(filePath: string): Promise<void> {
  if (!workspace || !database || !documentKindFromName(filePath)) return
  try {
    await access(filePath)
    const token = randomUUID()
    const now = Date.now()
    for (const [candidate, request] of systemOpenTokens) if (request.expiresAt < now) systemOpenTokens.delete(candidate)
    systemOpenTokens.set(token, { path: filePath, expiresAt: now + 3_600_000 })
    pendingOpenRequest = { token, name: filePath.split(/[\\/]/).pop() ?? 'Document' }
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
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Document',
          submenu: [
            {
              label: 'Markdown',
              accelerator: 'Command+N',
              click: () => mainWindow?.webContents.send(IPC.createDocumentRequest, 'markdown')
            },
            {
              label: 'HTML',
              click: () => mainWindow?.webContents.send(IPC.createDocumentRequest, 'html')
            },
            {
              label: 'Word Document',
              click: () => mainWindow?.webContents.send(IPC.createDocumentRequest, 'docx')
            },
            {
              label: 'Excel Workbook',
              click: () => mainWindow?.webContents.send(IPC.createDocumentRequest, 'xlsx')
            },
            {
              label: 'PowerPoint Presentation',
              click: () => mainWindow?.webContents.send(IPC.createDocumentRequest, 'pptx')
            }
          ]
        },
        {
          label: 'Open Document…',
          accelerator: 'Command+O',
          click: () => mainWindow?.webContents.send(IPC.openDocumentRequest)
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Search Environment…',
          accelerator: 'Command+Shift+F',
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
        ...(!app.isPackaged
          ? [
              {
                label: 'Reload',
                accelerator: 'Command+R',
                click: (): void => requestClose('reload', 'reload')
              },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const }
            ]
          : []),
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
  if (BrowserWindow.getAllWindows().length === 0) {
    allowWindowClose = false
    createWindow()
  }
})

app.on('before-quit', (event) => {
  if (allowApplicationQuit) return
  event.preventDefault()
  requestClose('quit', 'quit')
})

app.on('window-all-closed', () => {
  if (quitting) app.quit()
})

function requestClose(reason: CloseReason, action: 'close' | 'quit' | 'reload'): void {
  if (pendingClose) {
    if (action === 'quit') pendingClose.action = 'quit'
    if (pendingClose.blocked && mainWindow && !mainWindow.isDestroyed()) {
      const requestId = pendingClose.id
      pendingClose.blocked = false
      pendingClose.timeout = setTimeout(() => void handleCloseTimeout(requestId), 15_000)
      mainWindow.webContents.send(IPC.prepareClose, { id: requestId, reason: pendingClose.reason })
    }
    return
  }
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    if (action === 'quit') void finishQuit()
    return
  }
  const id = randomUUID()
  const timeout = setTimeout(() => void handleCloseTimeout(id), 15_000)
  pendingClose = { id, reason, action, timeout, blocked: false }
  window.webContents.send(IPC.prepareClose, { id, reason })
}

function completeClose(requestId: string, outcome: 'ready' | 'blocked' | 'cancelled'): void {
  const request = pendingClose
  if (!request || request.id !== requestId) return
  if (request.timeout) clearTimeout(request.timeout)
  if (outcome === 'blocked') {
    request.timeout = undefined
    request.blocked = true
    mainWindow?.show()
    mainWindow?.focus()
    return
  }
  pendingClose = null
  if (outcome === 'cancelled') {
    mainWindow?.show()
    mainWindow?.focus()
    return
  }
  performCloseAction(request.action)
}

async function handleCloseTimeout(requestId: string): Promise<void> {
  const request = pendingClose
  const window = mainWindow
  if (!request || request.id !== requestId || !window || window.isDestroyed()) return
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    title: 'Aladdeen could not confirm your saves',
    message: 'Aladdeen did not receive a save confirmation from the document window.',
    detail: 'Keep the application open to protect your edits, or discard unsaved changes and continue closing.',
    buttons: ['Keep Open', request.action === 'quit' ? 'Quit and Discard' : 'Close and Discard'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (!pendingClose || pendingClose.id !== requestId) return
  if (pendingClose.timeout) clearTimeout(pendingClose.timeout)
  pendingClose = null
  if (result.response === 1) performCloseAction(request.action)
}

function performCloseAction(action: 'close' | 'quit' | 'reload'): void {
  if (action === 'reload') {
    mainWindow?.webContents.reload()
    return
  }
  if (action === 'quit') {
    void finishQuit()
    return
  }
  allowWindowClose = true
  mainWindow?.close()
}

async function finishQuit(): Promise<void> {
  if (allowApplicationQuit) return
  allowApplicationQuit = true
  allowWindowClose = true
  quitting = true
  if (!servicesClosed) {
    servicesClosed = true
    aiService?.dispose()
    globalSearch?.close()
    await workspace?.close()
    database?.close()
  }
  app.quit()
}
