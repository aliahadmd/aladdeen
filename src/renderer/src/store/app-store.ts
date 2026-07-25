import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  Accent,
  AppSettings,
  DocumentKind,
  DocumentSnapshot,
  DocumentTarget,
  EnvironmentEvent,
  EnvironmentSnapshot,
  ExportRequest,
  GlobalSearchMatch,
  OpenDocument,
  OpenFileRequest,
  PreviewSourceTarget,
  ProjectImportSelection,
  ThemeMode,
  TextDocumentSnapshot,
  TextOpenDocument,
  TrackedFileSummary,
  UpdateProjectRequest
} from '@shared/contracts'
import { isTextDocumentKind } from '@shared/documents'
import { findNearestLiteralMatch, matchesLiteral } from '@shared/search'
import {
  cleanupDocumentRuntime,
  getDocumentRuntime
} from '@renderer/document-adapters/runtime'

type MobilePane = 'editor' | 'preview'
type BootStatus = 'booting' | 'ready' | 'error'

interface EditorViewport {
  scrollTop: number
  selection: number
}

interface AppState {
  bootStatus: BootStatus
  environment: EnvironmentSnapshot | null
  documents: OpenDocument[]
  activeFileId: string | null
  settings: AppSettings
  persistedSettings: AppSettings
  editing: boolean
  mobilePane: MobilePane
  sidebarOpen: boolean
  conflictFileId: string | null
  pendingOpenRequest?: OpenFileRequest
  projectImportOpen: boolean
  globalSearchOpen: boolean
  selectedProjectId: string | null
  selectedFolderPath: string
  initialize(): Promise<void>
  flushDocuments(): Promise<boolean>
  saveDirtyCopies(): Promise<boolean>
  createEnvironment(name: string): Promise<boolean>
  renameEnvironment(name: string): Promise<boolean>
  removeEnvironment(): Promise<boolean>
  switchEnvironment(environmentId: string): Promise<void>
  loadEnvironment(snapshot: EnvironmentSnapshot): Promise<void>
  refreshEnvironment(): Promise<void>
  createProject(name: string): Promise<void>
  addProject(): void
  commitProjectImport(selections: ProjectImportSelection[]): Promise<boolean>
  updateProject(request: UpdateProjectRequest): Promise<boolean>
  removeProject(projectId: string): Promise<void>
  openFile(): Promise<void>
  createFile(name?: string, documentKind?: Exclude<DocumentKind, 'pdf'>): Promise<void>
  createFolder(name: string): Promise<void>
  openDocument(target: DocumentTarget): Promise<void>
  openRelativeDocument(fileId: string, target: string): Promise<void>
  openSearchMatch(
    match: GlobalSearchMatch,
    query: string,
    matchCase: boolean,
    wholeWord: boolean
  ): Promise<void>
  revealPreviewSource(fileId: string, target: PreviewSourceTarget): void
  openDroppedFiles(files: File[]): Promise<void>
  setActiveFileId(fileId: string): void
  updateContent(fileId: string, content: string): void
  markBinaryDirty(fileId: string, dirty?: boolean): void
  updateEditorView(fileId: string, scrollTop: number, selection: number): void
  getEditorView(fileId: string): EditorViewport | undefined
  consumeEditorReveal(fileId: string, revealId: number): void
  updatePreviewScroll(fileId: string, scrollTop: number): void
  getPreviewScroll(fileId: string): number
  saveDocument(fileId: string, force?: boolean): Promise<boolean>
  saveDocumentAs(fileId: string): Promise<boolean>
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
  setProjectImportOpen(value: boolean): void
  setGlobalSearchOpen(value: boolean): void
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const saveOperations = new Map<string, Promise<boolean>>()
const editorViewports = new Map<string, EditorViewport>()
const previewScrollPositions = new Map<string, number>()
let editorRevealId = 0
let initializePromise: Promise<void> | null = null
let environmentRequestId = 0
let settingsRequestId = 0
let settingsWriteQueue: Promise<Awaited<ReturnType<typeof window.aladdeen.settings.update>>> = Promise.resolve({
  ok: true,
  value: {
    theme: 'system',
    accent: 'indigo',
    sidebarWidth: 320,
    sidebarCollapsed: false
  }
})

function withoutCancelled(error: { code: string; message: string }): void {
  if (error.code !== 'CANCELLED') toast.error(error.message)
}

function openDocumentFromSnapshot(snapshot: DocumentSnapshot): OpenDocument {
  const state = {
    status: 'saved' as const,
    editorScrollTop: 0,
    editorSelection: 0
  }
  return isTextSnapshot(snapshot)
    ? { ...snapshot, ...state, savedContent: snapshot.content }
    : { ...snapshot, ...state, binaryDirty: false, adapterRevision: 0 }
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
      deleted: file.missing
    }
  })
}

export const useAppStore = create<AppState>((set, get) => {
  const persistOpenState = async (): Promise<void> => {
    if (!get().environment) return
    await window.aladdeen.environments.persistState({
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

  const saveDocumentNow = async (
    fileId: string,
    force = false,
    saveAs = false
  ): Promise<boolean> => {
    const timer = saveTimers.get(fileId)
    if (timer) clearTimeout(timer)
    saveTimers.delete(fileId)
    const document = get().documents.find((candidate) => candidate.id === fileId)
    if (!document || (!isDocumentDirty(document) && !force && !saveAs)) return true
    if (document.deleted && !force) {
      set((state) => ({ documents: state.documents.map((item) => item.id === fileId
        ? { ...item, status: 'error', error: 'This file was deleted outside Aladdeen.' }
        : item) }))
      return false
    }
    set((state) => ({ documents: state.documents.map((item) => item.id === fileId ? { ...item, status: 'saving' } : item) }))
    if (!isTextOpenDocument(document)) {
      const serializedAdapterRevision = document.adapterRevision
      const runtime = getDocumentRuntime(fileId)
      if (!runtime) {
        set((state) => ({
          documents: state.documents.map((item) => item.id === fileId
            ? { ...item, status: 'error', error: 'The document editor is not ready to save.' }
            : item)
        }))
        return false
      }
      let data: ArrayBuffer
      try {
        data = await runtime.serialize()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The document could not be serialized.'
        set((state) => ({
          documents: state.documents.map((item) => item.id === fileId
            ? { ...item, status: 'error', error: message }
            : item)
        }))
        toast.error(message)
        return false
      }
      const result = await window.aladdeen.document.saveBinary({
        fileId,
        expectedRevision: document.revision,
        force,
        saveAs: saveAs || (document.documentKind === 'pdf' && Boolean(
          document.session.signed || document.session.restricted
        ))
      }, data)
      if (!result.ok) {
        if (result.error.code === 'CONFLICT') {
          set((state) => ({
            conflictFileId: fileId,
            documents: state.documents.map((item) => item.id === fileId
              ? { ...item, status: 'conflict', error: result.error.message }
              : item)
          }))
        } else {
          set((state) => ({
            documents: state.documents.map((item) => item.id === fileId
              ? { ...item, status: 'error', error: result.error.message }
              : item)
          }))
          withoutCancelled(result.error)
        }
        return false
      }
      set((state) => ({
        documents: state.documents.map((item) => item.id === fileId && !isTextOpenDocument(item)
          ? (() => {
              const hasNewerEdits = item.adapterRevision !== serializedAdapterRevision
              return {
                ...item,
                revision: result.value,
                session: { ...item.session, byteLength: result.value.size },
                binaryDirty: hasNewerEdits,
                status: hasNewerEdits ? 'editing' : 'saved',
                error: undefined,
                deleted: false
              }
            })()
          : item)
      }))
      const latest = get().documents.find((candidate) => candidate.id === fileId)
      if (latest && !isTextOpenDocument(latest) && latest.binaryDirty) {
        saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 1_500))
      }
      await get().refreshEnvironment()
      return true
    }

    const snapshotContent = document.content
    const request = {
      fileId,
      content: snapshotContent,
      expectedRevision: document.revision,
      force
    }
    const result = saveAs
      ? await window.aladdeen.document.saveAs(request)
      : await window.aladdeen.document.save(request)
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
    const hasNewerEdits = latest && isTextOpenDocument(latest)
      ? latest.content !== snapshotContent
      : false
    set((state) => ({ documents: state.documents.map((item) => item.id === fileId ? {
      ...item,
      revision: result.value,
      savedContent: snapshotContent,
      status: hasNewerEdits ? 'editing' : 'saved',
      error: undefined,
      deleted: false
    } : item) }))
    if (hasNewerEdits) {
      saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 500))
    }
    if (saveAs) await get().refreshEnvironment()
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
    bootStatus: 'booting',
    environment: null,
    documents: [],
    activeFileId: null,
    settings: {
      theme: 'system',
      accent: 'indigo',
      sidebarWidth: 320,
      sidebarCollapsed: false
    },
    persistedSettings: {
      theme: 'system',
      accent: 'indigo',
      sidebarWidth: 320,
      sidebarCollapsed: false
    },
    editing: false,
    mobilePane: 'preview',
    sidebarOpen: false,
    conflictFileId: null,
    projectImportOpen: false,
    globalSearchOpen: false,
    selectedProjectId: null,
    selectedFolderPath: '',

    async initialize() {
      if (initializePromise) return initializePromise
      initializePromise = (async () => {
        set({ bootStatus: 'booting' })
        const result = await window.aladdeen.app.bootstrap()
        if (!result.ok) {
          toast.error(result.error.message)
          set({ bootStatus: 'error' })
          return
        }
        set({
          settings: result.value.settings,
          persistedSettings: result.value.settings,
          pendingOpenRequest: result.value.pendingOpenRequest
        })
        if (result.value.environment) await get().loadEnvironment(result.value.environment)
        if (result.value.environment && result.value.pendingOpenRequest) {
          await get().acceptSystemOpenFile(result.value.pendingOpenRequest)
        }
        set({ bootStatus: 'ready' })
      })().finally(() => {
        initializePromise = null
      })
      return initializePromise
    },

    async flushDocuments() {
      return flushDocuments()
    },

    async saveDirtyCopies() {
      const dirty = get().documents.filter(isDocumentDirty)
      for (const document of dirty) {
        if (isTextOpenDocument(document)) {
          const result = await window.aladdeen.document.saveCopy(document.id, document.content)
          if (!result.ok) {
            withoutCancelled(result.error)
            return false
          }
        } else if (!(await get().saveDocument(document.id))) {
          return false
        }
      }
      if (dirty.length > 0) {
        toast.success(dirty.length === 1 ? 'A copy of your edits was saved.' : 'Copies of your edits were saved.')
      }
      return true
    },

    async createEnvironment(name) {
      if (get().environment) {
        if (!(await flushDocuments())) return false
        await persistOpenState()
      }
      const result = await window.aladdeen.environments.create(name)
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
      const result = await window.aladdeen.environments.rename(environmentId, name)
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
      const result = await window.aladdeen.environments.remove(environmentId)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      if (result.value) await get().loadEnvironment(result.value)
      else {
        saveTimers.forEach((timer) => clearTimeout(timer))
        saveTimers.clear()
        set({
          environment: null,
          documents: [],
          activeFileId: null,
          globalSearchOpen: false,
          selectedProjectId: null,
          selectedFolderPath: ''
        })
      }
      return true
    },

    async switchEnvironment(environmentId) {
      if (environmentId === get().environment?.environment.id) return
      if (!(await flushDocuments())) return
      await persistOpenState()
      const requestId = ++environmentRequestId
      const result = await window.aladdeen.environments.switch(environmentId)
      if (!result.ok) return withoutCancelled(result.error)
      if (requestId !== environmentRequestId) return
      await get().loadEnvironment(result.value)
    },

    async loadEnvironment(snapshot) {
      const requestId = ++environmentRequestId
      for (const document of get().documents) {
        cleanupDocumentRuntime(document.id)
        if (!isTextOpenDocument(document)) {
          void window.aladdeen.document.releaseSession(document.session.id)
        }
      }
      saveTimers.forEach((timer) => clearTimeout(timer))
      saveTimers.clear()
      saveOperations.clear()
      editorViewports.clear()
      previewScrollPositions.clear()
      const opened = await mapWithConcurrency(snapshot.openFileIds, 4, async (fileId) =>
        window.aladdeen.document.open({ kind: 'tracked', fileId })
      )
      if (requestId !== environmentRequestId) return
      const documents = opened.flatMap((result) => result.ok ? [openDocumentFromSnapshot(result.value)] : [])
      const preferred = snapshot.activeFileId && documents.some((document) => document.id === snapshot.activeFileId)
        ? snapshot.activeFileId
        : documents.at(-1)?.id ?? null
      set({
        environment: snapshot,
        documents,
        activeFileId: preferred,
        sidebarOpen: false,
        globalSearchOpen: false,
        conflictFileId: null,
        selectedProjectId: null,
        selectedFolderPath: ''
      })
    },

    async refreshEnvironment() {
      const environmentId = get().environment?.environment.id
      if (!environmentId) return
      const result = await window.aladdeen.environments.refresh()
      if (!result.ok) {
        if (result.error.code !== 'NOT_FOUND') toast.error(result.error.message)
        return
      }
      if (result.value.environment.id !== get().environment?.environment.id) return
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value) }))
    },

    async createProject(name) {
      const result = await window.aladdeen.projects.create(name)
      if (!result.ok) return withoutCancelled(result.error)
      const newest = result.value.projects.find((project) => !get().environment?.projects.some((old) => old.id === project.id))
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value), selectedProjectId: newest?.id ?? null, selectedFolderPath: '' }))
    },

    addProject() {
      set({ projectImportOpen: true })
    },

    async commitProjectImport(selections) {
      const result = await window.aladdeen.projects.commitImport(selections)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      const newest = result.value.projects.find((project) => !get().environment?.projects.some((old) => old.id === project.id))
      set((state) => ({
        environment: result.value,
        documents: mergeTrackedMetadata(state.documents, result.value),
        selectedProjectId: newest?.id ?? null,
        selectedFolderPath: '',
        projectImportOpen: false
      }))
      return true
    },

    async updateProject(request) {
      const result = await window.aladdeen.projects.update(request)
      if (!result.ok) {
        withoutCancelled(result.error)
        return false
      }
      set((state) => ({
        environment: result.value,
        documents: mergeTrackedMetadata(state.documents, result.value),
        selectedProjectId: request.archived && state.selectedProjectId === request.projectId ? null : state.selectedProjectId,
        selectedFolderPath: request.archived && state.selectedProjectId === request.projectId ? '' : state.selectedFolderPath
      }))
      return true
    },

    async removeProject(projectId) {
      const result = await window.aladdeen.projects.remove(projectId)
      if (!result.ok) return withoutCancelled(result.error)
      set((state) => ({ environment: result.value, documents: mergeTrackedMetadata(state.documents, result.value), selectedProjectId: null, selectedFolderPath: '' }))
    },

    async openFile() {
      if (!get().environment) return
      const result = await window.aladdeen.document.openFile()
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async createFile(name, documentKind = 'markdown') {
      if (!get().environment) return
      const projectId = get().selectedProjectId
      const result = projectId && name
        ? await window.aladdeen.files.create({
            projectId,
            parentPath: get().selectedFolderPath,
            name,
            documentKind
          })
        : await window.aladdeen.files.create({ documentKind })
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async createFolder(name) {
      const projectId = get().selectedProjectId
      if (!projectId) return
      const result = await window.aladdeen.files.createFolder({ projectId, parentPath: get().selectedFolderPath, name })
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
      const result = await window.aladdeen.document.open(target)
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async openRelativeDocument(fileId, target) {
      const result = await window.aladdeen.document.openRelative(fileId, target)
      if (!result.ok) return withoutCancelled(result.error)
      await ingestDocument(result.value)
    },

    async openSearchMatch(match, query, matchCase, wholeWord) {
      let fileId: string | undefined
      if (match.target.kind === 'tracked') {
        fileId = match.target.fileId
      } else {
        const target = match.target
        fileId = get().documents.find((document) =>
          document.projectId === target.projectId && document.relativePath === target.relativePath
        )?.id
      }

      if (!fileId || !get().documents.some((document) => document.id === fileId)) {
        const result = await window.aladdeen.document.open(match.target)
        if (!result.ok) return withoutCancelled(result.error)
        fileId = result.value.id
        await ingestDocument(result.value)
      } else {
        set({ activeFileId: fileId, sidebarOpen: false })
        await persistOpenState()
      }

      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (!document) return
      if (!isTextOpenDocument(document)) {
        set({
          activeFileId: fileId,
          editing: true,
          globalSearchOpen: false
        })
        getDocumentRuntime(fileId)?.reveal?.(match, { query, matchCase, wholeWord })
        return
      }
      let from = match.sourceOffsetStart
      let to = match.sourceOffsetEnd
      if (!matchesLiteral(document.content, from, to, query, matchCase, wholeWord)) {
        const nearest = findNearestLiteralMatch(
          document.content,
          query,
          matchCase,
          wholeWord,
          match.sourceOffsetStart
        )
        if (nearest) {
          from = nearest.from
          to = nearest.to
        } else {
          from = offsetForLine(document.content, match.lineNumber)
          to = from
          toast.info('That search match no longer exists. The file changed after searching.')
        }
      }
      editorRevealId += 1
      set((state) => ({
        activeFileId: fileId,
        editing: true,
        mobilePane: 'editor',
        globalSearchOpen: false,
        documents: state.documents.map((candidate) => candidate.id === fileId
          ? {
              ...candidate,
              editorSelection: to,
              editorReveal: {
                id: editorRevealId,
                from,
                to,
                select: true,
                origin: 'search'
              }
            }
          : candidate)
      }))
    },

    revealPreviewSource(fileId, target) {
      const state = get()
      if (!state.editing || state.activeFileId !== fileId) return
      const document = state.documents.find((candidate) => candidate.id === fileId)
      if (!document || !isTextOpenDocument(document)) return
      const from = Math.min(Math.max(Math.trunc(target.from), 0), document.content.length)
      const to = Math.min(Math.max(Math.trunc(target.to), from), document.content.length)
      editorRevealId += 1
      set((current) => ({
        mobilePane: 'editor',
        documents: current.documents.map((candidate) =>
          candidate.id === fileId
            ? {
                ...candidate,
                editorSelection: target.exact ? to : from,
                editorReveal: {
                  id: editorRevealId,
                  from,
                  to,
                  select: target.exact,
                  origin: 'preview'
                }
              }
            : candidate
        )
      }))
    },

    async openDroppedFiles(files) {
      if (!get().environment || files.length === 0) return
      const result = await window.aladdeen.document.openDropped(files.slice(0, 20))
      if (!result.ok) return withoutCancelled(result.error)
      for (const snapshot of result.value) await ingestDocument(snapshot)
    },

    setActiveFileId(fileId) {
      set({ activeFileId: fileId })
      void persistOpenState()
    },

    updateContent(fileId, content) {
      set((state) => ({
        documents: state.documents.map((document) =>
          document.id === fileId && isTextOpenDocument(document)
          ? { ...document, content, status: 'editing', error: undefined }
          : document)
      }))
      const current = saveTimers.get(fileId)
      if (current) clearTimeout(current)
      saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 500))
    },

    markBinaryDirty(fileId, dirty = true) {
      set((state) => ({
        documents: state.documents.map((document) =>
          document.id === fileId && !isTextOpenDocument(document)
            ? {
                ...document,
                binaryDirty: dirty,
                adapterRevision: document.adapterRevision + (dirty ? 1 : 0),
                status: dirty ? 'editing' : 'saved',
                error: undefined
              }
            : document
        )
      }))
      const current = saveTimers.get(fileId)
      if (current) clearTimeout(current)
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (
        dirty &&
        document &&
        !isTextOpenDocument(document) &&
        !(document.documentKind === 'pdf' && (document.session.signed || document.session.restricted))
      ) {
        saveTimers.set(fileId, setTimeout(() => void get().saveDocument(fileId), 1_500))
      }
    },

    updateEditorView(fileId, scrollTop, selection) {
      editorViewports.set(fileId, { scrollTop, selection })
    },

    getEditorView(fileId) {
      return editorViewports.get(fileId)
    },

    consumeEditorReveal(fileId, revealId) {
      if (!get().documents.some((document) =>
        document.id === fileId && document.editorReveal?.id === revealId
      )) return
      set((state) => ({
        documents: state.documents.map((document) =>
          document.id === fileId && document.editorReveal?.id === revealId
            ? { ...document, editorReveal: undefined }
            : document
        )
      }))
    },

    updatePreviewScroll(fileId, scrollTop) {
      previewScrollPositions.set(fileId, scrollTop)
    },

    getPreviewScroll(fileId) {
      return previewScrollPositions.get(fileId) ?? 0
    },

    async saveDocument(fileId, force = false) {
      const previous = saveOperations.get(fileId) ?? Promise.resolve(true)
      const operation = previous
        .catch(() => false)
        .then(() => saveDocumentNow(fileId, force))
      saveOperations.set(fileId, operation)
      try {
        return await operation
      } finally {
        if (saveOperations.get(fileId) === operation) saveOperations.delete(fileId)
      }
    },

    async saveDocumentAs(fileId) {
      const previous = saveOperations.get(fileId) ?? Promise.resolve(true)
      const operation = previous
        .catch(() => false)
        .then(() => saveDocumentNow(fileId, false, true))
      saveOperations.set(fileId, operation)
      try {
        return await operation
      } finally {
        if (saveOperations.get(fileId) === operation) saveOperations.delete(fileId)
      }
    },

    async closeDocument(fileId, discard = false) {
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (!document) return
      if (!discard && isDocumentDirty(document) && !(await get().saveDocument(fileId))) return
      const timer = saveTimers.get(fileId)
      if (timer) clearTimeout(timer)
      saveTimers.delete(fileId)
      cleanupDocumentRuntime(fileId)
      if (!isTextOpenDocument(document)) {
        await window.aladdeen.document.releaseSession(document.session.id)
      }
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
        if (!update) return document
        return {
          ...document,
          name: update.name,
          location: update.location,
          fullPath: update.fullPath,
          projectId: update.projectId,
          relativePath: update.relativePath,
          deleted: update.missing
        }
      }) }))
    },

    async removeTrackedFile(fileId) {
      await get().closeDocument(fileId)
      if (get().documents.some((document) => document.id === fileId)) return
      const result = await window.aladdeen.files.removeTracked(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      set({ environment: result.value })
    },

    async trashTrackedFile(fileId) {
      const document = get().documents.find((candidate) => candidate.id === fileId)
      if (document && isDocumentDirty(document) && !(await get().saveDocument(fileId))) return
      const result = await window.aladdeen.files.trashTracked(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      toast.success(`${document?.name ?? 'File'} moved to Trash.`)
      await get().refreshEnvironment()
    },

    async locateTrackedFile(fileId) {
      const result = await window.aladdeen.files.locate(fileId)
      if (!result.ok) return withoutCancelled(result.error)
      set((state) => ({
        documents: state.documents.map((document) => document.id === fileId
          ? openDocumentFromSnapshot(result.value)
          : document)
      }))
      await get().refreshEnvironment()
    },

    async handleEnvironmentEvent(event) {
      if (event.type === 'tree-changed' || event.type === 'added' || event.isDirectory) await get().refreshEnvironment()
      if (!event.fileId) return
      const document = get().documents.find((candidate) => candidate.id === event.fileId)
      if (event.type === 'removed') {
        if (document) {
          set((state) => ({ documents: state.documents.map((item) => item.id === event.fileId
            ? { ...item, deleted: true, status: 'error', error: 'This file was deleted outside Aladdeen.' }
            : item) }))
          toast.warning(`${document.name} was removed outside Aladdeen.`)
        }
        await get().refreshEnvironment()
        return
      }
      if (!document || (event.type !== 'changed' && event.type !== 'added')) return
      if (isDocumentDirty(document) || document.status === 'saving') {
        set((state) => ({
          conflictFileId: event.fileId ?? null,
          documents: state.documents.map((item) => item.id === event.fileId ? { ...item, status: 'conflict', error: 'This file changed outside Aladdeen.' } : item)
        }))
        return
      }
      const result = await window.aladdeen.document.read(event.fileId)
      if (!result.ok) return
      if (!isTextOpenDocument(document)) cleanupDocumentRuntime(document.id)
      set((state) => ({
        documents: state.documents.map((item) => item.id === event.fileId
          ? openDocumentFromSnapshot(result.value)
          : item)
      }))
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
      const result = await window.aladdeen.document.acceptOpenFile(request.token)
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
        if (isTextOpenDocument(document)) {
          const copy = await window.aladdeen.document.saveCopy(fileId, document.content)
          if (!copy.ok) return withoutCancelled(copy.error)
          toast.success('A copy of your changes was saved.')
        } else {
          const runtime = getDocumentRuntime(fileId)
          if (!runtime) return
          const data = await runtime.serialize()
          const copy = await window.aladdeen.document.saveBinary({
            fileId,
            expectedRevision: document.revision,
            force: true,
            saveAs: true
          }, data)
          if (!copy.ok) return withoutCancelled(copy.error)
          toast.success('A copy of your document was saved.')
        }
      }
      const external = await window.aladdeen.document.read(fileId)
      if (!external.ok) return withoutCancelled(external.error)
      cleanupDocumentRuntime(fileId)
      set((state) => ({
        conflictFileId: null,
        documents: state.documents.map((item) => item.id === fileId
          ? openDocumentFromSnapshot(external.value)
          : item)
      }))
    },

    async exportActive(format) {
      const document = get().documents.find((candidate) => candidate.id === get().activeFileId)
      if (!document || document.documentKind !== 'markdown') return
      await get().saveDocument(document.id)
      const result = await window.aladdeen.export.document({
        fileId: document.id,
        title: document.name.replace(/\.(md|markdown)$/i, ''),
        content: document.content,
        format
      })
      if (!result.ok) return withoutCancelled(result.error)
      toast.success(`${format.toUpperCase()} exported successfully.`)
    },

    async updateSettings(next) {
      const previous = get().settings
      const settings = { ...previous, ...next }
      const requestId = ++settingsRequestId
      set({ settings })
      settingsWriteQueue = settingsWriteQueue.then(
        () => window.aladdeen.settings.update(settings),
        () => window.aladdeen.settings.update(settings)
      )
      const result = await settingsWriteQueue
      if (result.ok) set({ persistedSettings: result.value })
      if (requestId !== settingsRequestId) return
      if (!result.ok) {
        set({ settings: get().persistedSettings })
        toast.error(result.error.message)
        return
      }
      set({ settings: result.value })
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
    },
    setProjectImportOpen(value) {
      set({ projectImportOpen: value })
    },

    setGlobalSearchOpen(value) {
      set({ globalSearchOpen: value })
    }
  }
})

function offsetForLine(content: string, requestedLine: number): number {
  let line = 1
  let offset = 0
  while (line < requestedLine) {
    const newline = content.indexOf('\n', offset)
    if (newline < 0) return content.length
    offset = newline + 1
    line += 1
  }
  return offset
}

export function isDocumentDirty(document: OpenDocument): boolean {
  return isTextOpenDocument(document)
    ? document.content !== document.savedContent
    : document.binaryDirty
}

function isTextSnapshot(snapshot: DocumentSnapshot): snapshot is TextDocumentSnapshot {
  return isTextDocumentKind(snapshot.documentKind)
}

function isTextOpenDocument(document: OpenDocument): document is TextOpenDocument {
  return isTextDocumentKind(document.documentKind)
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

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await operation(values[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
