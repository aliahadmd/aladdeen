import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  Accent,
  AppSettings,
  DocumentSnapshot,
  DocumentTarget,
  EnvironmentEvent,
  EnvironmentSnapshot,
  ExportRequest,
  OpenDocument,
  OpenFileRequest,
  ThemeMode,
  TrackedFileSummary
} from '@shared/contracts'

type MobilePane = 'editor' | 'preview'

interface AppState {
  initialized: boolean
  environment: EnvironmentSnapshot | null
  documents: OpenDocument[]
  activeFileId: string | null
  settings: AppSettings
  editing: boolean
  mobilePane: MobilePane
  sidebarOpen: boolean
  conflictFileId: string | null
  pendingOpenRequest?: OpenFileRequest
  selectedProjectId: string | null
  selectedFolderPath: string
  initialize(): Promise<void>
  createEnvironment(name: string): Promise<boolean>
  renameEnvironment(name: string): Promise<boolean>
  removeEnvironment(): Promise<boolean>
  switchEnvironment(environmentId: string): Promise<void>
  loadEnvironment(snapshot: EnvironmentSnapshot): Promise<void>
  refreshEnvironment(): Promise<void>
  createProject(name: string): Promise<void>
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  openFile(): Promise<void>
  createFile(name?: string): Promise<void>
  createFolder(name: string): Promise<void>
  openDocument(target: DocumentTarget): Promise<void>
  openRelativeDocument(fileId: string, target: string): Promise<void>
  openDroppedFile(file: File): Promise<void>
  setActiveFileId(fileId: string): void
  updateContent(fileId: string, content: string): void
  updateEditorView(fileId: string, scrollTop: number, selection: number): void
  saveDocument(fileId: string, force?: boolean): Promise<boolean>
  closeDocument(fileId: string, discard?: boolean): Promise<void>
  reorderDocument(fromId: string, toId: string): void
  applyTrackedUpdates(files: TrackedFileSummary[]): void
  removeTrackedFile(fileId: string): Promise<void>
  trashTrackedFile(fileId: string): Promise<void>
  locateTrackedFile(fileId: string): Promise<void>
  handleEnvironmentEvent(event: EnvironmentEvent): Promise<void>
  acceptSystemOpenFile(request: OpenFileRequest): Promise<void>
  resolveConflict(action: 'reload' | 'keep' | 'copy'): Promise<void>
  exportActive(format: ExportRequest['format']): Promise<void>
  updateSettings(next: Partial<AppSettings>): Promise<void>
  setSelectedLocation(projectId: string | null, folderPath?: string): void
  setEditing(value: boolean): void
  setMobilePane(value: MobilePane): void
  setSidebarOpen(value: boolean): void
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function withoutCancelled(error: { code: string; message: string }): void {
  if (error.code !== 'CANCELLED') toast.error(error.message)
}

function openDocumentFromSnapshot(snapshot: DocumentSnapshot): OpenDocument {
  return {
    ...snapshot,
    savedContent: snapshot.content,
    status: 'saved',
    editorScrollTop: 0,
    editorSelection: 0
  }
}

function mergeTrackedMetadata(documents: OpenDocument[], snapshot: EnvironmentSnapshot): OpenDocument[] {
  const files = new Map(snapshot.files.map((file) => [file.id, file]))
  return documents.map((document) => {
    const file = files.get(document.id)
    if (!file) return document
    return {
      ...document,
      name: file.name,
      location: file.location,
      fullPath: file.fullPath,
      projectId: file.projectId,
      relativePath: file.relativePath,
      deleted: file.missing || document.deleted
    }
  })
}

export const useAppStore = create<AppState>((set, get) => {
  const persistOpenState = async (): Promise<void> => {
    if (!get().environment) return
    await window.fluidmd.environments.persistState({
      openFileIds: get().documents.map((document) => document.id),
      activeFileId: get().activeFileId ?? undefined
    })
  }

  const flushDocuments = async (): Promise<boolean> => {
    for (const document of [...get().documents]) {
      if (isDocumentDirty(document) && !(await get().saveDocument(document.id))) return false
    }
    return true
  }

  const ingestDocument = async (snapshot: DocumentSnapshot): Promise<void> => {
    const existing = get().documents.find((document) => document.id === snapshot.id)
    if (existing) {
      set({ activeFileId: snapshot.id, sidebarOpen: false })
    } else {
      set((state) => ({
        documents: [...state.documents, openDocumentFromSnapshot(snapshot)],
        activeFileId: snapshot.id,
        sidebarOpen: false
      }))
    }
    await persistOpenState()
    await get().refreshEnvironment()
  }

  return {
    initialized: false,
    environment: null,
    documents: [],
    activeFileId: null,
    settings: { theme: 'system', accent: 'indigo' },
    editing: false,
    mobilePane: 'preview',
    sidebarOpen: false,
    conflictFileId: null,
    selectedProjectId: null,
    selectedFolderPath: '',

    async initialize() {
      const result = await window.fluidmd.app.bootstrap()
      if (!result.ok) {
        toast.error(result.error.message)
        set({ initialized: true })
        return
      }
      set({
        settings: result.value.settings,
        pendingOpenRequest: result.value.pendingOpenRequest,
        initialized: true
      })
      if (result.value.environment) await get().loadEnvironment(result.value.environment)
      if (result.value.environment && result.value.pendingOpenRequest) await get().acceptSystemOpenFile(result.value.pendingOpenRequest)
    },

    async createEnvironment(name) {
      if (get().environment) {
        if (!(await flushDocuments())) return false
        await persistOpenState()
      }
      const result = await window.fluidmd.environments.create(name)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      await get().loadEnvironment(result.value)
      const pending = get().pendingOpenRequest
      if (pending) await get().acceptSystemOpenFile(pending)
      return true
    },

    async renameEnvironment(name) {
      const environmentId = get().environment?.environment.id
      if (!environmentId) return false
      const result = await window.fluidmd.environments.rename(environmentId, name)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      set({ environment: result.value })
      return true
    },

    async removeEnvironment() {
      const environmentId = get().environment?.environment.id
      if (!environmentId || !(await flushDocuments())) return false
      await persistOpenState()
      const result = await window.fluidmd.environments.remove(environmentId)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      if (result.value) await get().loadEnvironment(result.value)
      else {
        saveTimers.forEach((timer) => clearTimeout(timer))
        saveTimers.clear()
        set({ environment: null, documents: [], activeFileId: null, selectedProjectId: null, selectedFolderPath: '' })
      }
      return true
    },

    async switchEnvironment(environmentId) {
      if (environmentId === get().environment?.environment.id) return
      if (!(await flushDocuments())) return
      await persistOpenState()
      const result = await window.fluidmd.environments.switch(environmentId)
      if (!result.ok) return withoutCancelled(result.error)
      await get().loadEnvironment(result.value)
    },

    async loadEnvironment(snapshot) {
      saveTimers.forEach((timer) => clearTimeout(timer))
      saveTimers.clear()
      const documents: OpenDocument[] = []
      for (const fileId of snapshot.openFileIds) {
        const opened = await window.fluidmd.document.open({ kind: 'tracked', fileId })
        if (opened.ok) documents.push(openDocumentFromSnapshot(opened.value))
      }
      const preferred = snapshot.activeFileId && documents.some((document) => document.id === snapshot.activeFileId)
        ? snapshot.activeFileId
        : documents.at(-1)?.id ?? null
      set({
        environment: snapshot,
        documents,
        activeFileId: preferred,
        sidebarOpen: false,
        conflictFileId: null,
        selectedProjectId: null,
        selectedFolderPath: ''
      })
    },

    async refreshEnvironment() {
      if (!get().environment) return
      const result = await window.fluidmd.environments.refresh()
      if (result.ok) set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value) }))
      else if (result.error.code !== 'NOT_FOUND') toast.error(result.error.message)
    },

    async createProject(name) {
      const result = await window.fluidmd.projects.create(name)
      if (!result.ok) return withoutCancelled(result.error)
      const newest = result.value.projects.find((project) => !get().environment?.projects.some((old) => old.id === project.id))
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value), selectedProjectId: newest?.id ?? null, selectedFolderPath: '' }))
    },

    async addProject() {
      const result = await window.fluidmd.projects.addExisting()
      if (!result.ok) return withoutCancelled(result.error)
      const newest = result.value.projects.find((project) => !get().environment?.projects.some((old) => old.id === project.id))
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value), selectedProjectId: newest?.id ?? null, selectedFolderPath: '' }))
    },

    async removeProject(projectId) {
      const result = await window.fluidmd.projects.remove(projectId)
      if (!result.ok) return withoutCancelled(result.error)
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value), selectedProjectId: null, selectedFolderPath: '' }))
    },

    async openFile() {
      if (!get().environment) return
      const result = await window.fluidmd.document.openFile()
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async createFile(name) {
      if (!get().environment) return
      const projectId = get().selectedProjectId
      const result = projectId && name
        ? await window.fluidmd.files.create({ projectId, parentPath: get().selectedFolderPath, name })
        : await window.fluidmd.files.create()
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async createFolder(name) {
      const projectId = get().selectedProjectId
      if (!projectId) return
      const result = await window.fluidmd.files.createFolder({ projectId, parentPath: get().selectedFolderPath, name })
      if (!result.ok) return withoutCancelled(result.error)
      set({ environment: result.value })
    },

    async openDocument(target) {
      const existing = target.kind === 'tracked' ? get().documents.find((document) => document.id === target.fileId) : undefined
      if (existing) {
        set({ activeFileId: existing.id, sidebarOpen: false })
        await persistOpenState()
        return
      }
      const result = await window.fluidmd.document.open(target)
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async openRelativeDocument(fileId, target) {
      const result = await window.fluidmd.document.openRelative(fileId, target)
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async openDroppedFile(file) {
      if (!get().environment) return
      const result = await window.fluidmd.document.openDropped(file)
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    setActiveFileId(fileId) {
      set({ activeFileId: fileId })
      void persistOpenState()
    },

    updateContent(fileId, content) {
      set((state) => ({
        documents: state.documents.map((document) => document.id === fileId
          ? { ...document, content, status: 'editing', error: undefined }
          : document)
      }))
      const current = saveTimers.get(fileId)
      if (current) clearTimeout(current)
      saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 500))
    },

    updateEditorView(fileId, scrollTop, selection) {
      set((state) => ({
        documents: state.documents.map((document) => document.id === fileId
          ? { ...document, editorScrollTop: scrollTop, editorSelection: selection }
          : document)
      }))
    },

    async saveDocument(fileId, force = false) {
      const timer = saveTimers.get(fileId)
      if (timer) clearTimeout(timer)
      saveTimers.delete(fileId)
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (!document || (document.content === document.savedContent && !force)) return true
      if (document.deleted && !force) {
        set((state) => ({ documents: state.documents.map((item) => item.id === fileId
          ? { ...item, status: 'error', error: 'This file was deleted outside FluidMD.' }
          : item) }))
        return false
      }
      const snapshotContent = document.content
      set((state) => ({ documents: state.documents.map((item) => item.id === fileId ? { ...item, status: 'saving' } : item) }))
      const result = await window.fluidmd.document.save({ fileId, content: snapshotContent, expectedRevision: document.revision, force })
      if (!result.ok) {
        if (result.error.code === 'CONFLICT') {
          set((state) => ({
            conflictFileId: fileId,
            documents: state.documents.map((item) => item.id === fileId ? { ...item, status: 'conflict', error: result.error.message } : item)
          }))
        } else {
          set((state) => ({ documents: state.documents.map((item) => item.id === fileId ? { ...item, status: 'error', error: result.error.message } : item) }))
          toast.error(result.error.message)
        }
        return false
      }
      const latest = get().documents.find((candidate) => candidate.id === fileId)
      const hasNewerEdits = latest?.content !== snapshotContent
      set((state) => ({ documents: state.documents.map((item) => item.id === fileId ? {
        ...item,
        revision: result.value,
        savedContent: snapshotContent,
        status: hasNewerEdits ? 'editing' : 'saved',
        error: undefined,
        deleted: false
      } : item) }))
      if (hasNewerEdits) saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 500))
      return true
    },

    async closeDocument(fileId, discard = false) {
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (!document) return
      if (!discard && isDocumentDirty(document) && !(await get().saveDocument(fileId))) return
      const timer = saveTimers.get(fileId)
      if (timer) clearTimeout(timer)
      saveTimers.delete(fileId)
      set((state) => {
        const index = state.documents.findIndex((item) => item.id === fileId)
        const documents = state.documents.filter((item) => item.id !== fileId)
        const activeFileId = state.activeFileId === fileId ? documents[Math.min(index, documents.length - 1)]?.id ?? null : state.activeFileId
        return { documents, activeFileId }
      })
      await persistOpenState()
    },

    reorderDocument(fromId, toId) {
      if (fromId === toId) return
      set((state) => {
        const documents = [...state.documents]
        const fromIndex = documents.findIndex((document) => document.id === fromId)
        const toIndex = documents.findIndex((document) => document.id === toId)
        if (fromIndex === -1 || toIndex === -1) return state
        const [moved] = documents.splice(fromIndex, 1)
        if (moved) documents.splice(toIndex, 0, moved)
        return { documents }
      })
      void persistOpenState()
    },

    applyTrackedUpdates(files) {
      const byId = new Map(files.map((file) => [file.id, file]))
      set((state) => ({ documents: state.documents.map((document) => {
        const update = byId.get(document.id)
        return update ? { ...document, ...update, id: document.id } : document
      }) }))
    },

    async removeTrackedFile(fileId) {
      await get().closeDocument(fileId)
      if (get().documents.some((document) => document.id === fileId)) return
      const result = await window.fluidmd.files.removeTracked(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      set({ environment: result.value })
    },

    async trashTrackedFile(fileId) {
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (document && isDocumentDirty(document) && !(await get().saveDocument(fileId))) return
      const result = await window.fluidmd.files.trashTracked(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      toast.success(`${document?.name ?? 'File'} moved to Trash.`)
      await get().refreshEnvironment()
    },

    async locateTrackedFile(fileId) {
      const result = await window.fluidmd.files.locate(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      set((state) => ({ documents: state.documents.map((document) => document.id === fileId
        ? { ...document, ...result.value, savedContent: result.value.content, status: 'saved', deleted: false, error: undefined }
        : document) }))
      await get().refreshEnvironment()
    },

    async handleEnvironmentEvent(event) {
      if (event.type === 'tree-changed' || event.type === 'added' || event.isDirectory) await get().refreshEnvironment()
      if (!event.fileId) return
      const document = get().documents.find((candidate) => candidate.id === event.fileId)
      if (event.type === 'removed') {
        if (document) {
          set((state) => ({ documents: state.documents.map((item) => item.id === event.fileId
            ? { ...item, deleted: true, status: 'error', error: 'This file was deleted outside FluidMD.' }
            : item) }))
          toast.warning(`${document.name} was removed outside FluidMD.`)
        }
        await get().refreshEnvironment()
        return
      }
      if (!document || event.type !== 'changed') return
      if (isDocumentDirty(document) || document.status === 'saving') {
        set((state) => ({
          conflictFileId: event.fileId ?? null,
          documents: state.documents.map((item) => item.id === event.fileId ? { ...item, status: 'conflict', error: 'This file changed outside FluidMD.' } : item)
        }))
        return
      }
      const result = await window.fluidmd.document.read(event.fileId)
      if (!result.ok) return
      set((state) => ({ documents: state.documents.map((item) => item.id === event.fileId
        ? { ...item, ...result.value, savedContent: result.value.content, status: 'saved', error: undefined }
        : item) }))
      toast.info(`${document.name} was updated from disk.`)
    },

    async acceptSystemOpenFile(request) {
      if (!get().environment) {
        set({ pendingOpenRequest: request })
        return
      }
      if (!(await flushDocuments())) {
        toast.error('Resolve the current save issue before opening another file.')
        return
      }
      const result = await window.fluidmd.document.acceptOpenFile(request.token)
      if (!result.ok) return withoutCancelled(result.error)
      set({ pendingOpenRequest: undefined })
      await ingestDocument(result.value)
    },

    async resolveConflict(action) {
      const fileId = get().conflictFileId
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (!fileId || !document) return
      if (action === 'keep') {
        if (await get().saveDocument(fileId, true)) set({ conflictFileId: null })
        return
      }
      if (action === 'copy') {
        const copy = await window.fluidmd.document.saveCopy(fileId, document.content)
        if (!copy.ok) return withoutCancelled(copy.error)
        toast.success('A copy of your changes was saved.')
      }
      const external = await window.fluidmd.document.read(fileId)
      if (!external.ok) return withoutCancelled(external.error)
      set((state) => ({
        conflictFileId: null,
        documents: state.documents.map((item) => item.id === fileId
          ? { ...item, ...external.value, savedContent: external.value.content, status: 'saved', error: undefined }
          : item)
      }))
    },

    async exportActive(format) {
      const document = get().documents.find((candidate) => candidate.id === get().activeFileId)
      if (!document) return
      await get().saveDocument(document.id)
      const result = await window.fluidmd.export.document({
        fileId: document.id,
        title: document.name.replace(/\.(md|markdown)$/i, ''),
        content: document.content,
        format
      })
      if (!result.ok) return withoutCancelled(result.error)
      toast.success(`${format.toUpperCase()} exported successfully.`)
    },

    async updateSettings(next) {
      const settings = { ...get().settings, ...next }
      set({ settings })
      const result = await window.fluidmd.settings.update(settings)
      if (!result.ok) toast.error(result.error.message)
    },

    setSelectedLocation(projectId, folderPath = '') {
      set({ selectedProjectId: projectId, selectedFolderPath: folderPath })
    },
    setEditing(value) {
      set({ editing: value, mobilePane: value ? 'editor' : 'preview' })
    },
    setMobilePane(value) {
      set({ mobilePane: value })
    },
    setSidebarOpen(value) {
      set({ sidebarOpen: value })
    }
  }
})

export function isDocumentDirty(document: OpenDocument): boolean {
  return document.content !== document.savedContent
}

export const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export const accentOptions: Array<{ value: Accent; label: string }> = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'blue', label: 'Blue' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' }
]
