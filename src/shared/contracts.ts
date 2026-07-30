import type { ReadingSettings } from './reading'

export type ThemeMode = 'light' | 'dark' | 'system'
export type Accent = 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose'
export type SaveStatus = 'editing' | 'saving' | 'saved' | 'conflict' | 'error'
export type DocumentKind = 'markdown' | 'html' | 'docx' | 'pdf' | 'xlsx' | 'pptx'
export type TextDocumentKind = Extract<DocumentKind, 'markdown' | 'html'>
export type BinaryDocumentKind = Extract<DocumentKind, 'docx' | 'pdf' | 'xlsx' | 'pptx'>
export type DocumentActor = 'user' | 'agent' | 'system'
export type DocumentKindCounts = Record<DocumentKind, number>

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
  documentKind?: DocumentKind
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
  enabledDocumentKinds: DocumentKind[]
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
  kindCounts: DocumentKindCounts
  tree: ProjectScopeNode[]
  truncated: boolean
}

export interface ProjectImportSelection {
  token: string
  scopeMode: ProjectScopeMode
  includePaths: string[]
  excludePatterns: string[]
  enabledDocumentKinds: DocumentKind[]
  groupName?: string
  pinned: boolean
}

export interface ProjectScopePreview {
  project: ProjectSummary
  tree: ProjectScopeNode[]
  totalDocuments: number
  kindCounts: DocumentKindCounts
  truncated: boolean
}

export interface UpdateProjectRequest {
  projectId: string
  scopeMode: ProjectScopeMode
  includePaths: string[]
  excludePatterns: string[]
  enabledDocumentKinds: DocumentKind[]
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
  documentKind: DocumentKind
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
  documentKind: DocumentKind
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

export interface TextSearchBufferOverride {
  fileId: string
  kind: 'text'
  content: string
}

export interface SpreadsheetCellLocator {
  sheetName: string
  address: string
  row: number
  column: number
}

export interface SpreadsheetSearchCell extends SpreadsheetCellLocator {
  value: string
  formula?: string
}

export interface SpreadsheetSearchBufferOverride {
  fileId: string
  kind: 'spreadsheet'
  cells: SpreadsheetSearchCell[]
}

export interface PresentationTextLocator {
  slideIndex: number
  slideNumber: number
  slideId?: string
  elementId?: string
  elementName?: string
  source: 'slide' | 'notes'
}

export interface PresentationSearchEntry extends PresentationTextLocator {
  text: string
}

export interface PresentationSearchBufferOverride {
  fileId: string
  kind: 'presentation'
  entries: PresentationSearchEntry[]
}

export type SearchBufferOverride =
  | TextSearchBufferOverride
  | SpreadsheetSearchBufferOverride
  | PresentationSearchBufferOverride

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
  documentKind?: DocumentKind
  pageIndex?: number
  pageX?: number
  pageY?: number
  documentPosition?: number
  spreadsheetCell?: SpreadsheetCellLocator
  presentationText?: PresentationTextLocator
}

export interface BinarySearchRevealContext {
  query: string
  matchCase: boolean
  wholeWord: boolean
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
  lineEnding?: 'LF' | 'CRLF'
  hasBom?: boolean
}

export interface DocumentCapabilities {
  edit: boolean
  preview: boolean
  split: boolean
  outline: boolean
  search: boolean
  undoRedo: boolean
  save: boolean
  saveAs: boolean
  exportPdf: boolean
  exportDocx: boolean
  comments: boolean
  trackedChanges: boolean
  annotations: boolean
  forms: boolean
  pageTools: boolean
}

export interface BaseDocumentSnapshot {
  id: string
  environmentId: string
  projectId?: string
  relativePath?: string
  name: string
  location: string
  fullPath: string
  revision: FileRevision
  capabilities: DocumentCapabilities
}

export interface TextDocumentSnapshot extends BaseDocumentSnapshot {
  documentKind: TextDocumentKind
  content: string
  encoding: 'utf-8'
}

export interface BinaryDocumentSession {
  id: string
  url: string
  byteLength: number
  encrypted?: boolean
  signed?: boolean
  restricted?: boolean
  spreadsheetCompatibility?: SpreadsheetCompatibility
  presentationCompatibility?: PresentationCompatibility
}

export type SpreadsheetCompatibilityLevel = 'supported' | 'preserve-only' | 'read-only'

export interface SpreadsheetCompatibility {
  level: SpreadsheetCompatibilityLevel
  reasons: string[]
  requiresSaveAs: boolean
}

export type PresentationCompatibilityLevel = 'supported' | 'preserve-only' | 'read-only'

export interface PresentationCompatibility {
  level: PresentationCompatibilityLevel
  reasons: string[]
  requiresSaveAs: boolean
}

export interface BinaryDocumentSnapshot extends BaseDocumentSnapshot {
  documentKind: BinaryDocumentKind
  session: BinaryDocumentSession
}

export type DocumentSnapshot = TextDocumentSnapshot | BinaryDocumentSnapshot

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

export interface OpenDocumentState {
  status: SaveStatus
  error?: string
  deleted?: boolean
  editorScrollTop: number
  editorSelection: number
  editorReveal?: EditorRevealRequest
}

export interface TextOpenDocument extends TextDocumentSnapshot, OpenDocumentState {
  savedContent: string
}

export interface BinaryOpenDocument extends BinaryDocumentSnapshot, OpenDocumentState {
  binaryDirty: boolean
  adapterRevision: number
}

export type OpenDocument = TextOpenDocument | BinaryOpenDocument

export interface DocumentTransaction {
  id: string
  fileId: string
  documentKind: DocumentKind
  actor: DocumentActor
  baseRevision: string
  undoGroup?: string
  createdAt: number
}

export interface DocumentCapabilitiesByKind {
  markdown: DocumentCapabilities
  html: DocumentCapabilities
  docx: DocumentCapabilities
  pdf: DocumentCapabilities
  xlsx: DocumentCapabilities
  pptx: DocumentCapabilities
}

export interface AppSettings extends ReadingSettings {
  theme: ThemeMode
  accent: Accent
  sidebarWidth: number
  sidebarCollapsed: boolean
  completedOnboardingVersion: number
  agentEnabled: boolean
  agentProvider: AgentProvider
  agentModelId: string
  agentThinkingLevel: AgentThinkingLevel
  agentPanelWidth: number
  agentPanelCollapsed: boolean
}

export type AgentProvider = 'anthropic' | 'openai-codex' | 'kimi-coding' | 'openai' | 'google'
export type AgentAuthType = 'oauth' | 'api_key'
export type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AgentRunState = 'idle' | 'running' | 'aborting'
export type AgentApprovalDecision = 'allow' | 'allow-always' | 'deny' | 'cancelled'
export type AgentSessionErrorCode =
  | 'AUTH_FAILED'
  | 'CRASHED'
  | 'SPAWN_FAILED'
  | 'PROTOCOL_ERROR'
  | 'AGENT_UNAVAILABLE'

export interface AgentModel {
  provider: string
  id: string
  name: string
  supportsThinking: boolean
}

export interface AgentProviderCredentialStatus {
  configured: boolean
  authType?: AgentAuthType
  reauthRequired: boolean
  oauthAvailable: boolean
  apiKeyAvailable: boolean
}

export interface AgentCredentialStatus {
  encryptionAvailable: boolean
  providers: Record<AgentProvider, AgentProviderCredentialStatus>
}

export type AgentAuthPromptType = 'text' | 'secret' | 'select' | 'manual_code'

export interface AgentAuthPromptOption {
  id: string
  label: string
  description?: string
}

export type AgentAuthEvent =
  | { type: 'started'; attemptId: string; provider: AgentProvider }
  | { type: 'browser-opened'; attemptId: string; provider: AgentProvider }
  | {
      type: 'device-code'
      attemptId: string
      provider: AgentProvider
      userCode: string
      expiresAt?: number
    }
  | {
      type: 'prompt'
      attemptId: string
      provider: AgentProvider
      promptId: string
      promptType: AgentAuthPromptType
      message: string
      placeholder?: string
      options?: AgentAuthPromptOption[]
    }
  | { type: 'progress'; attemptId: string; provider: AgentProvider; message: string }
  | { type: 'completed'; attemptId: string; provider: AgentProvider; authType: AgentAuthType }
  | { type: 'failed'; attemptId: string; provider: AgentProvider; message: string }
  | { type: 'cancelled'; attemptId: string; provider: AgentProvider }

export type AgentEvent =
  | { type: 'run-state'; sessionId: string; state: AgentRunState }
  | { type: 'assistant-start'; sessionId: string; messageId: string }
  | { type: 'text-delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'thinking-delta'; sessionId: string; messageId: string; delta: string }
  | {
      type: 'block-end'
      sessionId: string
      messageId: string
      block: 'text' | 'thinking'
      contentIndex: number
    }
  | {
      type: 'assistant-end'
      sessionId: string
      messageId: string
      stopReason?: string
      error?: string
    }
  | {
      type: 'tool-start'
      sessionId: string
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      type: 'tool-update'
      sessionId: string
      toolCallId: string
      output: string
      truncated: boolean
    }
  | {
      type: 'tool-end'
      sessionId: string
      toolCallId: string
      output: string
      truncated: boolean
      isError: boolean
    }
  | {
      type: 'approval-request'
      sessionId: string
      requestId: string
      toolCallId?: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      type: 'approval-resolved'
      sessionId: string
      requestId: string
      decision: AgentApprovalDecision
    }
  | {
      type: 'retry'
      sessionId: string
      phase: 'start' | 'end'
      attempt: number
      maxAttempts?: number
      delayMs?: number
      success?: boolean
      message?: string
    }
  | {
      type: 'compaction'
      sessionId: string
      phase: 'start' | 'end'
      reason?: string
      message?: string
    }
  | {
      type: 'session-error'
      sessionId: string
      code: AgentSessionErrorCode
      message: string
    }
  | { type: 'session-ended'; sessionId: string; reason: 'stopped' | 'exited' | 'crashed' }

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

export interface SaveBinaryDocumentRequest {
  requestId: string
  fileId: string
  expectedRevision: FileRevision
  byteLength: number
  force?: boolean
  saveAs?: boolean
}

export interface CreateEntryRequest {
  projectId: string
  parentPath: string
  name: string
  documentKind?: Exclude<DocumentKind, 'pdf'>
}

export interface CreateStandaloneDocumentRequest {
  documentKind: Exclude<DocumentKind, 'pdf'>
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
  agent: {
    startSession(projectId: string): Promise<Result<{ sessionId: string }>>
    stopSession(sessionId: string): Promise<Result<void>>
    prompt(sessionId: string, message: string, steer?: boolean): Promise<Result<void>>
    abort(sessionId: string): Promise<Result<void>>
    respondApproval(
      sessionId: string,
      requestId: string,
      decision: Exclude<AgentApprovalDecision, 'cancelled'>
    ): Promise<Result<void>>
    setModel(sessionId: string, provider: AgentProvider, modelId: string): Promise<Result<AgentModel>>
    getModels(sessionId: string): Promise<Result<AgentModel[]>>
    setThinkingLevel(sessionId: string, level: AgentThinkingLevel): Promise<Result<void>>
    setApiKey(provider: AgentProvider, apiKey: string): Promise<Result<void>>
    clearApiKey(provider: AgentProvider): Promise<Result<void>>
    beginLogin(provider: AgentProvider): Promise<Result<{ attemptId: string }>>
    respondLoginPrompt(attemptId: string, promptId: string, value: string): Promise<Result<void>>
    reopenLoginUrl(attemptId: string): Promise<Result<void>>
    cancelLogin(attemptId: string): Promise<Result<void>>
    disconnectProvider(provider: AgentProvider): Promise<Result<void>>
    credentialStatus(): Promise<Result<AgentCredentialStatus>>
    getModelCatalog(): Promise<Result<AgentModel[]>>
    onEvent(callback: (event: AgentEvent) => void): () => void
    onAuthEvent(callback: (event: AgentAuthEvent) => void): () => void
  }
  document: {
    open(target: DocumentTarget): Promise<Result<DocumentSnapshot>>
    openFile(): Promise<Result<DocumentSnapshot>>
    openDropped(files: File[]): Promise<Result<DocumentSnapshot[]>>
    openRelative(fileId: string, target: string): Promise<Result<DocumentSnapshot>>
    acceptOpenFile(token: string): Promise<Result<DocumentSnapshot>>
    read(fileId: string): Promise<Result<DocumentSnapshot>>
    save(request: SaveDocumentRequest): Promise<Result<FileRevision>>
    saveAs(request: SaveDocumentRequest): Promise<Result<FileRevision>>
    saveBinary(
      request: Omit<SaveBinaryDocumentRequest, 'requestId' | 'byteLength'>,
      data: ArrayBuffer
    ): Promise<Result<FileRevision>>
    releaseSession(sessionId: string): Promise<Result<void>>
    saveCopy(fileId: string, content: string): Promise<Result<SaveCopyResult>>
    onEvent(callback: (event: EnvironmentEvent) => void): () => void
    onOpenFileRequest(callback: (request: OpenFileRequest) => void): () => void
    onOpenDocumentRequest(callback: () => void): () => void
    onCreateDocumentRequest(callback: (kind: Exclude<DocumentKind, 'pdf'>) => void): () => void
  }
  files: {
    create(request: CreateEntryRequest | CreateStandaloneDocumentRequest): Promise<Result<DocumentSnapshot>>
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
  agentStartSession: 'agent:start-session',
  agentStopSession: 'agent:stop-session',
  agentPrompt: 'agent:prompt',
  agentAbort: 'agent:abort',
  agentRespondApproval: 'agent:respond-approval',
  agentSetModel: 'agent:set-model',
  agentGetModels: 'agent:get-models',
  agentSetThinkingLevel: 'agent:set-thinking-level',
  agentSetApiKey: 'agent:set-api-key',
  agentClearApiKey: 'agent:clear-api-key',
  agentBeginLogin: 'agent:begin-login',
  agentRespondLoginPrompt: 'agent:respond-login-prompt',
  agentReopenLoginUrl: 'agent:reopen-login-url',
  agentCancelLogin: 'agent:cancel-login',
  agentDisconnectProvider: 'agent:disconnect-provider',
  agentCredentialStatus: 'agent:credential-status',
  agentGetModelCatalog: 'agent:get-model-catalog',
  agentEvent: 'agent:event',
  agentAuthEvent: 'agent:auth-event',
  environmentEvent: 'environment:event',
  systemOpenFileRequest: 'system:open-file-request',
  openDocumentRequest: 'document:open-request',
  createDocumentRequest: 'document:create-request',
  acceptSystemOpenFile: 'system:accept-open-file',
  openDocument: 'document:open',
  openFile: 'document:open-file',
  openDroppedFile: 'document:open-dropped',
  openRelativeDocument: 'document:open-relative',
  readDocument: 'document:read',
  saveDocument: 'document:save',
  saveDocumentAs: 'document:save-as',
  saveBinaryDocument: 'document:save-binary',
  binarySaveResult: 'document:save-binary-result',
  releaseDocumentSession: 'document:release-session',
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
