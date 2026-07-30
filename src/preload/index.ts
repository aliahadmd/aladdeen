import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AgentEvent,
  type CloseRequest,
  type EnvironmentEvent,
  type GlobalSearchEvent,
  type AladdeenApi,
  type OpenFileRequest
} from '@shared/contracts'

const api: AladdeenApi = {
  app: {
    bootstrap: () => ipcRenderer.invoke(IPC.bootstrap)
  },
  lifecycle: {
    onPrepareClose: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, request: CloseRequest): void => callback(request)
      ipcRenderer.on(IPC.prepareClose, listener)
      return () => ipcRenderer.removeListener(IPC.prepareClose, listener)
    },
    completeClose: (completion) => ipcRenderer.invoke(IPC.completeClose, completion)
  },
  environments: {
    create: (name) => ipcRenderer.invoke(IPC.createEnvironment, name),
    rename: (environmentId, name) => ipcRenderer.invoke(IPC.renameEnvironment, { environmentId, name }),
    remove: (environmentId) => ipcRenderer.invoke(IPC.removeEnvironment, environmentId),
    switch: (environmentId) => ipcRenderer.invoke(IPC.switchEnvironment, environmentId),
    refresh: () => ipcRenderer.invoke(IPC.refreshEnvironment),
    persistState: (state) => ipcRenderer.invoke(IPC.persistEnvironmentState, state)
  },
  projects: {
    create: (name) => ipcRenderer.invoke(IPC.createProject, name),
    chooseExisting: () => ipcRenderer.invoke(IPC.chooseProjects),
    commitImport: (selections) => ipcRenderer.invoke(IPC.commitProjectImport, selections),
    remove: (projectId) => ipcRenderer.invoke(IPC.removeProject, projectId),
    persistExpandedPaths: (projectId, paths) => ipcRenderer.invoke(IPC.persistExpandedPaths, { projectId, paths }),
    inspectScope: (projectId) => ipcRenderer.invoke(IPC.inspectProjectScope, projectId),
    update: (request) => ipcRenderer.invoke(IPC.updateProject, request),
    listChildren: (projectId, parentPath, cursor) =>
      ipcRenderer.invoke(IPC.listProjectChildren, { projectId, parentPath, cursor }),
    search: (query, limit) => ipcRenderer.invoke(IPC.searchProjectFiles, { query, limit })
  },
  search: {
    start: (request) => ipcRenderer.invoke(IPC.startGlobalSearch, request),
    cancel: (sessionId) => ipcRenderer.invoke(IPC.cancelGlobalSearch, sessionId),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, searchEvent: GlobalSearchEvent): void => callback(searchEvent)
      ipcRenderer.on(IPC.globalSearchEvent, listener)
      return () => ipcRenderer.removeListener(IPC.globalSearchEvent, listener)
    },
    onOpenRequest: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.globalSearchOpenRequest, listener)
      return () => ipcRenderer.removeListener(IPC.globalSearchOpenRequest, listener)
    }
  },
  agent: {
    startSession: (projectId) => ipcRenderer.invoke(IPC.agentStartSession, { projectId }),
    stopSession: (sessionId) => ipcRenderer.invoke(IPC.agentStopSession, { sessionId }),
    prompt: (sessionId, message, steer) =>
      ipcRenderer.invoke(IPC.agentPrompt, { sessionId, message, steer }),
    abort: (sessionId) => ipcRenderer.invoke(IPC.agentAbort, { sessionId }),
    respondApproval: (sessionId, requestId, decision) =>
      ipcRenderer.invoke(IPC.agentRespondApproval, { sessionId, requestId, decision }),
    setModel: (sessionId, provider, modelId) =>
      ipcRenderer.invoke(IPC.agentSetModel, { sessionId, provider, modelId }),
    getModels: (sessionId) => ipcRenderer.invoke(IPC.agentGetModels, { sessionId }),
    setThinkingLevel: (sessionId, level) =>
      ipcRenderer.invoke(IPC.agentSetThinkingLevel, { sessionId, level }),
    setApiKey: (provider, apiKey) => ipcRenderer.invoke(IPC.agentSetApiKey, { provider, apiKey }),
    clearApiKey: (provider) => ipcRenderer.invoke(IPC.agentClearApiKey, provider),
    credentialStatus: () => ipcRenderer.invoke(IPC.agentCredentialStatus),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent): void => callback(agentEvent)
      ipcRenderer.on(IPC.agentEvent, listener)
      return () => ipcRenderer.removeListener(IPC.agentEvent, listener)
    }
  },
  document: {
    open: (target) => ipcRenderer.invoke(IPC.openDocument, target),
    openFile: () => ipcRenderer.invoke(IPC.openFile),
    openDropped: (files) => ipcRenderer.invoke(
      IPC.openDroppedFile,
      files.map((file) => webUtils.getPathForFile(file))
    ),
    openRelative: (fileId, target) => ipcRenderer.invoke(IPC.openRelativeDocument, { fileId, target }),
    acceptOpenFile: (token) => ipcRenderer.invoke(IPC.acceptSystemOpenFile, token),
    read: (fileId) => ipcRenderer.invoke(IPC.readDocument, fileId),
    save: (request) => ipcRenderer.invoke(IPC.saveDocument, request),
    saveAs: (request) => ipcRenderer.invoke(IPC.saveDocumentAs, request),
    saveBinary: (request, data) => new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      const channel = new MessageChannel()
      const bytes = new Uint8Array(data)
      channel.port1.onmessage = (event): void => {
        channel.port1.close()
        resolve(event.data)
      }
      channel.port1.start()
      ipcRenderer.postMessage(IPC.saveBinaryDocument, {
        ...request,
        requestId,
        byteLength: bytes.byteLength
      }, [channel.port2])
      // MessagePortMain does not reliably deserialize a transferred bare
      // ArrayBuffer from an isolated preload world. A structured byte view is
      // copied through the dedicated port consistently across the V8 realms.
      channel.port1.postMessage({ bytes })
    }),
    releaseSession: (sessionId) => ipcRenderer.invoke(IPC.releaseDocumentSession, sessionId),
    saveCopy: (fileId, content) => ipcRenderer.invoke(IPC.saveCopy, { fileId, content }),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, environmentEvent: EnvironmentEvent): void => callback(environmentEvent)
      ipcRenderer.on(IPC.environmentEvent, listener)
      return () => ipcRenderer.removeListener(IPC.environmentEvent, listener)
    },
    onOpenFileRequest: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, request: OpenFileRequest): void => callback(request)
      ipcRenderer.on(IPC.systemOpenFileRequest, listener)
      return () => ipcRenderer.removeListener(IPC.systemOpenFileRequest, listener)
    },
    onOpenDocumentRequest: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.openDocumentRequest, listener)
      return () => ipcRenderer.removeListener(IPC.openDocumentRequest, listener)
    },
    onCreateDocumentRequest: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        kind: 'markdown' | 'html' | 'docx' | 'xlsx' | 'pptx'
      ): void => callback(kind)
      ipcRenderer.on(IPC.createDocumentRequest, listener)
      return () => ipcRenderer.removeListener(IPC.createDocumentRequest, listener)
    }
  },
  files: {
    create: (request) => ipcRenderer.invoke(IPC.createEntry, request),
    createFolder: (request) => ipcRenderer.invoke(IPC.createFolder, request),
    rename: (request) => ipcRenderer.invoke(IPC.renameEntry, request),
    trash: (projectId, path) => ipcRenderer.invoke(IPC.trashEntry, { projectId, path }),
    revealProjectEntry: (projectId, path) => ipcRenderer.invoke(IPC.revealProjectEntry, { projectId, path }),
    revealTracked: (fileId) => ipcRenderer.invoke(IPC.revealTrackedFile, fileId),
    trashTracked: (fileId) => ipcRenderer.invoke(IPC.trashTrackedFile, fileId),
    removeTracked: (fileId) => ipcRenderer.invoke(IPC.removeTrackedFile, fileId),
    locate: (fileId) => ipcRenderer.invoke(IPC.locateTrackedFile, fileId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.getSettings),
    update: (settings) => ipcRenderer.invoke(IPC.updateSettings, settings)
  },
  export: {
    document: (request) => ipcRenderer.invoke(IPC.exportDocument, request)
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url)
  }
}

contextBridge.exposeInMainWorld('aladdeen', api)
