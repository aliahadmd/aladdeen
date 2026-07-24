export type ThemeMode = 'light' | 'dark' | 'system'
export type Accent = 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose'
export type SaveStatus = 'editing' | 'saving' | 'saved' | 'conflict' | 'error'

export type ErrorCode =
  | 'CANCELLED'
  | 'INVALID_PATH'
  | 'INVALID_FILE'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'PERMISSION_DENIED'
  | 'EXPORT_FAILED'
  | 'SEARCH_FAILED'
  | 'INTERNAL'

export interface AppError {
  code: ErrorCode
  message: string
  details?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export interface WorkspaceTreeNode {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: WorkspaceTreeNode[]
  descendantCount?: number
}

export interface EnvironmentSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface ProjectSummary {
  id: string
  environmentId: string
  name: string
  displayPath: string
  expandedPaths: string[]
  scopeMode: ProjectScopeMode
  includePaths: string[]
  excludePatterns: string[]
  groupName?: string
  pinned: boolean
  archived: boolean
  fileCount: number
  indexStatus: ProjectIndexStatus
  indexedAt?: number
}

export type ProjectScopeMode = 'all' | 'selected'
export type ProjectIndexStatus = 'ready' | 'indexing' | 'error' | 'paused'

export interface ProjectScopeNode extends WorkspaceTreeNode {
  children?: ProjectScopeNode[]
  descendantCount: number
}

export interface ProjectImportPreview {
  token: string
  name: string
  displayPath: string
  fileCount: number
  tree: ProjectScopeNode[]
  truncated: boolean
}

export interface ProjectImportSelection {
  token: string
  scopeMode: ProjectScopeMode
  includePaths: string[]
  excludePatterns: string[]
  groupName?: string
  pinned: boolean
}

export interface ProjectScopePreview {
  project: ProjectSummary
  tree: ProjectScopeNode[]
  totalMarkdownFiles: number
  truncated: boolean
}

export interface UpdateProjectRequest {
  projectId: string
  scopeMode: ProjectScopeMode
  includePaths: string[]
  excludePatterns: string[]
  groupName?: string
  pinned: boolean
  archived: boolean
}

export interface ProjectTreePage {
  projectId: string
  parentPath: string
  entries: WorkspaceTreeNode[]
  total: number
  nextCursor?: number
}

export interface IndexedFileSummary {
  projectId: string
  projectName: string
  name: string
  relativePath: string
  location: string
}

export interface TrackedFileSummary {
  id: string
  environmentId: string
  projectId?: string
  name: string
  location: string
  fullPath: string
  relativePath?: string
  lastOpenedAt: number
  missing: boolean
}

export interface EnvironmentSnapshot {
  environment: EnvironmentSummary
  environments: EnvironmentSummary[]
  projects: ProjectSummary[]
  files: TrackedFileSummary[]
  openFileIds: string[]
  activeFileId?: string
}

export type DocumentTarget =
  | { kind: 'project'; projectId: string; relativePath: string }
  | { kind: 'tracked'; fileId: string }

export type GlobalSearchScope =
  | { kind: 'environment' }
  | { kind: 'project'; projectId: string }
  | { kind: 'standalone' }

export interface SearchBufferOverride {
  fileId: string
  content: string
}

export interface GlobalSearchRequest {
  query: string
  matchCase: boolean
  wholeWord: boolean
  scope: GlobalSearchScope
  bufferOverrides: SearchBufferOverride[]
}

export interface GlobalSearchMatch {
  id: string
  target: DocumentTarget
  name: string
  location: string
  lineNumber: number
  columnStart: number
  columnEnd: number
  sourceOffsetStart: number
  sourceOffsetEnd: number
  snippet: string
  snippetMatchStart: number
  snippetMatchEnd: number
  fileTruncated: boolean
}

export interface GlobalSearchSummary {
  scannedFiles: number
  totalFiles: number
  matchedFiles: number
  totalMatches: number
  skippedFiles: number
  truncated: boolean
}

export type GlobalSearchEvent =
  | {
      type: 'batch'
      sessionId: string
      matches: GlobalSearchMatch[]
      scannedFiles: number
      totalFiles: number
      skippedFiles: number
    }
  | { type: 'complete'; sessionId: string; summary: GlobalSearchSummary }
  | { type: 'cancelled'; sessionId: string }
  | { type: 'error'; sessionId: string; error: AppError }

export interface FileRevision {
  mtimeMs: number
  size: number
  sha256: string
  lineEnding: 'LF' | 'CRLF'
  hasBom: boolean
}

export interface DocumentSnapshot {
  id: string
  environmentId: string
  projectId?: string
  relativePath?: string
  name: string
  location: string
  fullPath: string
  content: string
  revision: FileRevision
}

export interface PreviewSourceTarget {
  from: number
  to: number
  exact: boolean
}

export interface EditorRevealRequest {
  id: number
  from: number
  to: number
  select: boolean
  origin: 'preview' | 'search'
}

export interface OpenDocument extends DocumentSnapshot {
  savedContent: string
  status: SaveStatus
  error?: string
  deleted?: boolean
  editorScrollTop: number
  editorSelection: number
  editorReveal?: EditorRevealRequest
}

export interface AppSettings {
  theme: ThemeMode
  accent: Accent
  sidebarWidth: number
  sidebarCollapsed: boolean
}

export interface BootstrapData {
  settings: AppSettings
  environment: EnvironmentSnapshot | null
  pendingOpenRequest?: OpenFileRequest
}

export interface EnvironmentEvent {
  type: 'added' | 'changed' | 'removed' | 'tree-changed'
  projectId?: string
  fileId?: string
  relativePath?: string
  isDirectory: boolean
}

export interface OpenFileRequest {
  token: string
  name: string
}

export type CloseReason = 'window-close' | 'quit' | 'reload'

export interface CloseRequest {
  id: string
  reason: CloseReason
}

export interface CloseCompletion {
  requestId: string
  outcome: 'ready' | 'blocked' | 'cancelled'
}

export interface SaveDocumentRequest {
  fileId: string
  content: string
  expectedRevision: FileRevision
  force?: boolean
}

export interface CreateEntryRequest {
  projectId: string
  parentPath: string
  name: string
}

export interface RenameEntryRequest {
  projectId: string
  path: string
  newName: string
}

export interface RenameEntryResult {
  projectId: string
  oldPath: string
  newPath: string
  affectedFiles: TrackedFileSummary[]
}

export interface EnvironmentStateRequest {
  openFileIds: string[]
  activeFileId?: string
}

export interface ExportRequest {
  fileId: string
  title: string
  content: string
  format: 'pdf' | 'docx'
}

export interface SaveCopyResult {
  path: string
}

export interface AladdeenApi {
  app: {
    bootstrap(): Promise<Result<BootstrapData>>
  }
  lifecycle: {
    onPrepareClose(callback: (request: CloseRequest) => void): () => void
    completeClose(completion: CloseCompletion): Promise<Result<void>>
  }
  environments: {
    create(name: string): Promise<Result<EnvironmentSnapshot>>
    rename(environmentId: string, name: string): Promise<Result<EnvironmentSnapshot>>
    remove(environmentId: string): Promise<Result<EnvironmentSnapshot | null>>
    switch(environmentId: string): Promise<Result<EnvironmentSnapshot>>
    refresh(): Promise<Result<EnvironmentSnapshot>>
    persistState(state: EnvironmentStateRequest): Promise<Result<void>>
  }
  projects: {
    create(name: string): Promise<Result<EnvironmentSnapshot>>
    chooseExisting(): Promise<Result<ProjectImportPreview[]>>
    commitImport(selections: ProjectImportSelection[]): Promise<Result<EnvironmentSnapshot>>
    remove(projectId: string): Promise<Result<EnvironmentSnapshot>>
    persistExpandedPaths(projectId: string, paths: string[]): Promise<Result<void>>
    inspectScope(projectId: string): Promise<Result<ProjectScopePreview>>
    update(request: UpdateProjectRequest): Promise<Result<EnvironmentSnapshot>>
    listChildren(projectId: string, parentPath: string, cursor?: number): Promise<Result<ProjectTreePage>>
    search(query: string, limit?: number): Promise<Result<IndexedFileSummary[]>>
  }
  search: {
    start(request: GlobalSearchRequest): Promise<Result<{ sessionId: string }>>
    cancel(sessionId: string): Promise<Result<void>>
    onEvent(callback: (event: GlobalSearchEvent) => void): () => void
    onOpenRequest(callback: () => void): () => void
  }
  document: {
    open(target: DocumentTarget): Promise<Result<DocumentSnapshot>>
    openFile(): Promise<Result<DocumentSnapshot>>
    openDropped(file: File): Promise<Result<DocumentSnapshot>>
    openRelative(fileId: string, target: string): Promise<Result<DocumentSnapshot>>
    acceptOpenFile(token: string): Promise<Result<DocumentSnapshot>>
    read(fileId: string): Promise<Result<DocumentSnapshot>>
    save(request: SaveDocumentRequest): Promise<Result<FileRevision>>
    saveCopy(fileId: string, content: string): Promise<Result<SaveCopyResult>>
    onEvent(callback: (event: EnvironmentEvent) => void): () => void
    onOpenFileRequest(callback: (request: OpenFileRequest) => void): () => void
  }
  files: {
    create(request?: CreateEntryRequest): Promise<Result<DocumentSnapshot>>
    createFolder(request: CreateEntryRequest): Promise<Result<EnvironmentSnapshot>>
    rename(request: RenameEntryRequest): Promise<Result<RenameEntryResult>>
    trash(projectId: string, path: string): Promise<Result<void>>
    revealProjectEntry(projectId: string, path: string): Promise<Result<void>>
    revealTracked(fileId: string): Promise<Result<void>>
    trashTracked(fileId: string): Promise<Result<void>>
    removeTracked(fileId: string): Promise<Result<EnvironmentSnapshot>>
    locate(fileId: string): Promise<Result<DocumentSnapshot>>
  }
  settings: {
    get(): Promise<Result<AppSettings>>
    update(settings: AppSettings): Promise<Result<AppSettings>>
  }
  export: {
    document(request: ExportRequest): Promise<Result<SaveCopyResult>>
  }
  system: {
    openExternal(url: string): Promise<Result<void>>
  }
}

export const IPC = {
  bootstrap: 'app:bootstrap',
  prepareClose: 'app:prepare-close',
  completeClose: 'app:complete-close',
  createEnvironment: 'environments:create',
  renameEnvironment: 'environments:rename',
  removeEnvironment: 'environments:remove',
  switchEnvironment: 'environments:switch',
  refreshEnvironment: 'environments:refresh',
  persistEnvironmentState: 'environments:persist-state',
  createProject: 'projects:create',
  chooseProjects: 'projects:choose-existing',
  commitProjectImport: 'projects:commit-import',
  removeProject: 'projects:remove',
  persistExpandedPaths: 'projects:persist-expanded',
  inspectProjectScope: 'projects:inspect-scope',
  updateProject: 'projects:update',
  listProjectChildren: 'projects:list-children',
  searchProjectFiles: 'projects:search-files',
  startGlobalSearch: 'search:start',
  cancelGlobalSearch: 'search:cancel',
  globalSearchEvent: 'search:event',
  globalSearchOpenRequest: 'search:open-request',
  environmentEvent: 'environment:event',
  systemOpenFileRequest: 'system:open-file-request',
  acceptSystemOpenFile: 'system:accept-open-file',
  openDocument: 'document:open',
  openFile: 'document:open-file',
  openDroppedFile: 'document:open-dropped',
  openRelativeDocument: 'document:open-relative',
  readDocument: 'document:read',
  saveDocument: 'document:save',
  saveCopy: 'document:save-copy',
  createEntry: 'files:create',
  createFolder: 'files:create-folder',
  renameEntry: 'files:rename',
  trashEntry: 'files:trash',
  revealProjectEntry: 'files:reveal-project-entry',
  revealTrackedFile: 'files:reveal-tracked',
  trashTrackedFile: 'files:trash-tracked',
  removeTrackedFile: 'files:remove-tracked',
  locateTrackedFile: 'files:locate',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  exportDocument: 'export:document',
  openExternal: 'system:open-external'
} as const
