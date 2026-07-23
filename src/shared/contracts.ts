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
  tree: WorkspaceTreeNode[]
  expandedPaths: string[]
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

export interface OpenDocument extends DocumentSnapshot {
  savedContent: string
  status: SaveStatus
  error?: string
  deleted?: boolean
  editorScrollTop: number
  editorSelection: number
}

export interface AppSettings {
  theme: ThemeMode
  accent: Accent
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
  kind: 'file' | 'directory'
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

export interface FluidMdApi {
  app: {
    bootstrap(): Promise<Result<BootstrapData>>
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
    addExisting(): Promise<Result<EnvironmentSnapshot>>
    remove(projectId: string): Promise<Result<EnvironmentSnapshot>>
    persistExpandedPaths(projectId: string, paths: string[]): Promise<Result<void>>
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
    create(request?: Omit<CreateEntryRequest, 'kind'>): Promise<Result<DocumentSnapshot>>
    createFolder(request: Omit<CreateEntryRequest, 'kind'>): Promise<Result<EnvironmentSnapshot>>
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
  createEnvironment: 'environments:create',
  renameEnvironment: 'environments:rename',
  removeEnvironment: 'environments:remove',
  switchEnvironment: 'environments:switch',
  refreshEnvironment: 'environments:refresh',
  persistEnvironmentState: 'environments:persist-state',
  createProject: 'projects:create',
  addProject: 'projects:add-existing',
  removeProject: 'projects:remove',
  persistExpandedPaths: 'projects:persist-expanded',
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
