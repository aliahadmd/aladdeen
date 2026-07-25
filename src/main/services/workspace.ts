import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
import { Document, Packer, Paragraph } from 'docx'
import { DesktopError } from '@main/errors'
import type { AppDatabase, ProjectIndexFileRecord, ProjectRecord, TrackedFileRecord } from './database'
import type {
  CreateEntryRequest,
  BinaryDocumentKind,
  BinaryDocumentSnapshot,
  DocumentKind,
  DocumentSnapshot,
  DocumentTarget,
  EnvironmentEvent,
  EnvironmentSnapshot,
  FileRevision,
  IndexedFileSummary,
  ProjectImportPreview,
  ProjectImportSelection,
  ProjectScopeNode,
  ProjectScopePreview,
  ProjectSummary,
  ProjectTreePage,
  RenameEntryRequest,
  RenameEntryResult,
  SaveDocumentRequest,
  SaveBinaryDocumentRequest,
  TextDocumentSnapshot,
  TrackedFileSummary,
  UpdateProjectRequest,
  WorkspaceTreeNode
} from '@shared/contracts'
import {
  ALL_PROJECT_DOCUMENT_KINDS,
  DEFAULT_PROJECT_DOCUMENT_KINDS,
  DOCUMENT_CAPABILITIES,
  defaultExtensionForKind,
  documentKindFromName,
  isDocumentKind,
  isSupportedDocumentName,
  isTextDocumentKind
} from '@shared/documents'
import { toPosixPath } from '@shared/path'
import { MAX_BINARY_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES } from '@shared/limits'
import { decodeMarkdown, encodeMarkdown, sha256 } from './file-format'
import { isPathInside, resolveExistingPath, resolveNewPath, resolveSyntacticPath } from './path-guard'
import { inspectDocxBuffer, inspectDocxPackage } from './zip-guard'

const LOCAL_ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', '.cache', 'node_modules', 'dist', 'build', 'out'])
const MAX_SCOPE_PREVIEW_FILES = 50_000
const PROJECT_TREE_PAGE_SIZE = 250

interface ProjectCandidate {
  token: string
  environmentId: string
  path: string
  name: string
  files: ProjectIndexFileRecord[]
  tree: ProjectScopeNode[]
  truncated: boolean
}

export function validateEntryName(input: string): string {
  const name = input.trim()
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
    throw new DesktopError('INVALID_PATH', 'Use a simple file or folder name without path separators.')
  }
  return name
}

export class WorkspaceService {
  private environmentId: string | null = null
  private readonly projectWatchers = new Map<string, FSWatcher>()
  private standaloneWatcher: FSWatcher | null = null
  private readonly suppressedWrites = new Map<string, number>()
  private readonly projectCandidates = new Map<string, ProjectCandidate>()
  private readonly reindexTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private activationQueue: Promise<void> = Promise.resolve()
  private readonly binarySessions = new Map<string, {
    fileId: string
    environmentId: string
    documentKind: BinaryDocumentKind
  }>()

  constructor(
    private readonly database: AppDatabase,
    private readonly onEvent: (event: EnvironmentEvent) => void
  ) {}

  get activeEnvironmentId(): string | null {
    return this.environmentId
  }

  async activateEnvironment(environmentId: string): Promise<EnvironmentSnapshot> {
    const activation = this.activationQueue.then(() => this.activateEnvironmentNow(environmentId))
    this.activationQueue = activation.then(() => undefined, () => undefined)
    return activation
  }

  private async activateEnvironmentNow(environmentId: string): Promise<EnvironmentSnapshot> {
    const environment = this.database.getEnvironment(environmentId)
    if (!environment) throw new DesktopError('NOT_FOUND', 'That environment no longer exists.')
    await this.stopWatchers()
    this.projectCandidates.clear()
    this.binarySessions.clear()
    this.environmentId = environmentId
    this.database.setActiveEnvironmentId(environmentId)
    await this.refreshMissingFiles()
    await this.startWatchers()
    for (const project of this.database.listProjects(environmentId)) {
      if (!project.archived && !project.indexedAt) this.scheduleProjectReindex(project, 0)
    }
    return this.getSnapshot()
  }

  async deactivateEnvironment(): Promise<void> {
    await this.stopWatchers()
    this.binarySessions.clear()
    this.environmentId = null
  }

  async getSnapshot(): Promise<EnvironmentSnapshot> {
    const environmentId = this.requireEnvironment()
    const environment = this.database.getEnvironment(environmentId)
    if (!environment) throw new DesktopError('NOT_FOUND', 'The active environment no longer exists.')
    const records = this.database.listProjects(environmentId)
    const projects = await Promise.all(records.map((record) => this.projectSummary(record)))
    const files = this.database
      .listTrackedFiles(environmentId)
      .map((file) => this.trackedFileSummary(file, records))
    const state = this.database.getEnvironmentState(environmentId)
    const knownIds = new Set(files.map((file) => file.id))
    return {
      environment,
      environments: this.database.listEnvironments(),
      projects,
      files,
      openFileIds: state.openFileIds.filter((id) => knownIds.has(id)),
      activeFileId: state.activeFileId && knownIds.has(state.activeFileId) ? state.activeFileId : undefined
    }
  }

  async addProjectPath(
    folderPath: string,
    options: Omit<ProjectImportSelection, 'token'> = {
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: [],
      enabledDocumentKinds: [...DEFAULT_PROJECT_DOCUMENT_KINDS],
      pinned: false
    }
  ): Promise<EnvironmentSnapshot> {
    const environmentId = this.requireEnvironment()
    const canonical = await realpath(folderPath)
    const folderStats = await stat(canonical)
    if (!folderStats.isDirectory()) throw new DesktopError('INVALID_PATH', 'Choose a folder to use as a project.')
    this.assertProjectRootAvailable(canonical)
    const project = this.database.addProject(environmentId, canonical, basename(canonical), {
      ...options,
      includePaths: normalizeScopePaths(options.includePaths),
      excludePatterns: normalizePatterns(options.excludePatterns),
      enabledDocumentKinds: normalizeDocumentKinds(options.enabledDocumentKinds)
    })
    await this.reindexProject(project)
    await this.startProjectWatcher(project)
    await this.reassociateTrackedFiles()
    return this.getSnapshot()
  }

  async prepareProjectImports(folderPaths: string[]): Promise<ProjectImportPreview[]> {
    const environmentId = this.requireEnvironment()
    this.projectCandidates.clear()
    const canonicalPaths: string[] = []
    for (const folderPath of folderPaths) {
      const canonical = await realpath(folderPath)
      const folderStats = await stat(canonical)
      if (!folderStats.isDirectory()) throw new DesktopError('INVALID_PATH', 'Choose folders to add as projects.')
      this.assertProjectRootAvailable(canonical)
      if (canonicalPaths.some((path) => isPathInside(path, canonical) || isPathInside(canonical, path))) {
        throw new DesktopError('ALREADY_EXISTS', 'The selected folders overlap. Add only the outer or inner folder.')
      }
      canonicalPaths.push(canonical)
    }

    const candidates = await mapWithConcurrency(canonicalPaths, 4, async (canonical) => {
      const scan = await this.scanProject(canonical)
      const token = randomUUID()
      return {
        token,
        environmentId,
        path: canonical,
        name: basename(canonical),
        files: scan.files,
        tree: buildScopeTree(scan.files.slice(0, MAX_SCOPE_PREVIEW_FILES)),
        truncated: scan.truncated
      } satisfies ProjectCandidate
    })

    const previews: ProjectImportPreview[] = []
    for (const candidate of candidates) {
      this.projectCandidates.set(candidate.token, candidate)
      previews.push({
        token: candidate.token,
        name: candidate.name,
        displayPath: abbreviatePath(candidate.path),
        fileCount: candidate.files.length,
        kindCounts: countDocumentKinds(candidate.files),
        tree: candidate.tree,
        truncated: candidate.truncated
      })
    }
    return previews
  }

  async commitProjectImports(selections: ProjectImportSelection[]): Promise<EnvironmentSnapshot> {
    const environmentId = this.requireEnvironment()
    if (selections.length === 0) throw new DesktopError('INVALID_PATH', 'Choose at least one project folder.')
    const candidates = selections.map((selection) => {
      const candidate = this.projectCandidates.get(selection.token)
      if (!candidate || candidate.environmentId !== environmentId) {
        throw new DesktopError('NOT_FOUND', 'That project selection expired. Choose the folder again.')
      }
      this.assertProjectRootAvailable(candidate.path)
      return { candidate, selection }
    })
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!.candidate
      if (candidates.some((other, otherIndex) =>
        otherIndex !== index && (isPathInside(other.candidate.path, candidate.path) || isPathInside(candidate.path, other.candidate.path))
      )) {
        throw new DesktopError('ALREADY_EXISTS', 'The selected project folders overlap.')
      }
    }

    for (const { candidate, selection } of candidates) {
      const project = this.database.addProject(environmentId, candidate.path, candidate.name, {
        ...selection,
        includePaths: normalizeScopePaths(selection.includePaths),
        excludePatterns: normalizePatterns(selection.excludePatterns),
        enabledDocumentKinds: normalizeDocumentKinds(selection.enabledDocumentKinds)
      })
      const included = filterIndexedFiles(candidate.files, project)
      this.database.replaceProjectIndex(project.id, included.map((file) => ({ ...file, projectId: project.id })))
      await this.startProjectWatcher(this.database.getProject(project.id)!)
      this.projectCandidates.delete(candidate.token)
    }
    await this.reassociateTrackedFiles()
    return this.getSnapshot()
  }

  async inspectProjectScope(projectId: string): Promise<ProjectScopePreview> {
    const project = this.requireProject(projectId)
    const scan = await this.scanProject(project.path)
    return {
      project: await this.projectSummary(project),
      tree: buildScopeTree(scan.files.slice(0, MAX_SCOPE_PREVIEW_FILES)),
      totalDocuments: scan.files.length,
      kindCounts: countDocumentKinds(scan.files),
      truncated: scan.truncated
    }
  }

  async updateProject(request: UpdateProjectRequest): Promise<EnvironmentSnapshot> {
    const current = this.requireProject(request.projectId)
    const options = {
      scopeMode: request.scopeMode,
      includePaths: normalizeScopePaths(request.includePaths),
      excludePatterns: normalizePatterns(request.excludePatterns),
      enabledDocumentKinds: normalizeDocumentKinds(request.enabledDocumentKinds),
      groupName: request.groupName,
      pinned: request.pinned,
      archived: request.archived
    }
    let project: ProjectRecord
    if (options.archived) {
      project = this.database.updateProject(current.id, options)
    } else {
      // Build the replacement before changing persisted settings. A failed scan
      // leaves both the previous policy and its known-good index intact.
      const scan = await this.scanProject(current.path, options.enabledDocumentKinds)
      const included = filterIndexedFiles(scan.files, options)
        .map((file) => ({ ...file, projectId: current.id }))
      project = this.database.updateProjectWithIndex(current.id, options, included)
    }
    await this.projectWatchers.get(project.id)?.close()
    this.projectWatchers.delete(project.id)
    if (project.archived) {
      this.database.setProjectIndexStatus(project.id, 'paused', project.fileCount, project.indexedAt)
    } else {
      await this.startProjectWatcher(this.database.getProject(project.id)!)
    }
    await this.reassociateTrackedFiles()
    return this.getSnapshot()
  }

  listProjectChildren(projectId: string, parentPath: string, cursor = 0): ProjectTreePage {
    const project = this.requireProject(projectId)
    const result = this.database.listProjectChildren(project.id, toPosixPath(parentPath), cursor, PROJECT_TREE_PAGE_SIZE)
    const nextCursor = cursor + result.entries.length < result.total ? cursor + result.entries.length : undefined
    return { projectId, parentPath, entries: result.entries, total: result.total, nextCursor }
  }

  searchProjectFiles(query: string, limit = 60): IndexedFileSummary[] {
    return this.database.searchProjectIndex(this.requireEnvironment(), query.trim(), Math.min(100, Math.max(1, limit)))
      .map((file) => ({
        projectId: file.projectId,
        projectName: file.projectName,
        name: file.name,
        relativePath: file.relativePath,
        location: `${file.projectName} › ${file.relativePath}`,
        documentKind: file.documentKind
      }))
  }

  async createProject(parentPath: string, requestedName: string): Promise<EnvironmentSnapshot> {
    const name = validateEntryName(requestedName)
    const parent = await realpath(parentPath)
    const target = resolve(parent, name)
    if (!isPathInside(parent, target)) throw new DesktopError('INVALID_PATH', 'That project name is not valid.')
    await mkdir(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new DesktopError('ALREADY_EXISTS', 'A folder with that name already exists there.')
      throw error
    })
    return this.addProjectPath(target)
  }

  async removeProject(projectId: string): Promise<EnvironmentSnapshot> {
    const project = this.requireProject(projectId)
    if (project.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That project is not in this environment.')
    await this.projectWatchers.get(projectId)?.close()
    this.projectWatchers.delete(projectId)
    const timer = this.reindexTimers.get(projectId)
    if (timer) clearTimeout(timer)
    this.reindexTimers.delete(projectId)
    this.database.removeProject(projectId)
    await this.restartStandaloneWatcher()
    return this.getSnapshot()
  }

  persistExpandedPaths(projectId: string, paths: string[]): void {
    this.requireProject(projectId)
    this.database.setProjectExpandedPaths(projectId, paths)
  }

  persistEnvironmentState(openFileIds: string[], activeFileId?: string): void {
    const environmentId = this.requireEnvironment()
    const validIds = new Set(this.database.listTrackedFiles(environmentId).map((file) => file.id))
    const filtered = openFileIds.filter((id) => validIds.has(id))
    this.database.setEnvironmentState(environmentId, filtered, activeFileId && validIds.has(activeFileId) ? activeFileId : undefined)
  }

  async openDocument(target: DocumentTarget): Promise<DocumentSnapshot> {
    if (target.kind === 'tracked') return this.readDocument(target.fileId, true)
    const project = this.requireProject(target.projectId)
    if (project.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That project is not in this environment.')
    const fullPath = await resolveExistingPath(project.path, target.relativePath)
    return this.openAbsoluteDocument(fullPath)
  }

  async openAbsoluteDocument(filePath: string): Promise<DocumentSnapshot> {
    const environmentId = this.requireEnvironment()
    const originalStats = await lstat(filePath)
    if (originalStats.isSymbolicLink()) throw new DesktopError('INVALID_PATH', 'Symbolic-link documents are not available.')
    const canonical = await realpath(filePath)
    const fileStats = await stat(canonical)
    const documentKind = documentKindFromName(canonical)
    if (!fileStats.isFile() || !documentKind) {
      throw new DesktopError('INVALID_FILE', 'Aladdeen opens Markdown, HTML, DOCX, and PDF documents.')
    }
    this.assertDocumentSize(fileStats.size, documentKind)
    await this.validateDocumentSignature(canonical, documentKind)
    const project = this.findContainingProject(canonical)
    const tracked = this.database.upsertTrackedFile(environmentId, canonical, project?.id, documentKind)
    await this.restartStandaloneWatcher()
    return this.readTracked(tracked)
  }

  async openRelativeDocument(fileId: string, target: string): Promise<DocumentSnapshot> {
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) {
      throw new DesktopError('INVALID_PATH', 'That link is not a local document.')
    }
    const file = this.requireTrackedFile(fileId)
    const project = file.projectId ? this.database.getProject(file.projectId) : null
    const authorityRoot = project?.path ?? dirname(file.path)
    const candidate = resolve(dirname(file.path), target.split('#')[0] ?? '')
    if (!isPathInside(authorityRoot, candidate)) throw new DesktopError('INVALID_PATH', 'That link points outside the allowed folder.')
    return this.openAbsoluteDocument(candidate)
  }

  async readDocument(fileId: string, touch = false): Promise<DocumentSnapshot> {
    const tracked = this.requireTrackedFile(fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That file is not in this environment.')
    try {
      const current = touch
        ? this.database.upsertTrackedFile(
            tracked.environmentId,
            tracked.path,
            tracked.projectId,
            tracked.documentKind
          )
        : tracked
      return await this.readTracked(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.database.setTrackedFileMissing(fileId, true)
        throw new DesktopError('NOT_FOUND', 'That file is missing. Locate it or remove it from the environment.')
      }
      throw error
    }
  }

  async saveDocument(request: SaveDocumentRequest): Promise<FileRevision> {
    const tracked = this.requireTrackedFile(request.fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That file is not in this environment.')
    if (!isTextDocumentKind(tracked.documentKind)) {
      throw new DesktopError('INVALID_FILE', 'Binary documents must be saved through their format adapter.')
    }
    const safePath = await this.resolveTrackedDocumentPath(tracked).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        this.database.setTrackedFileMissing(tracked.id, true)
        throw new DesktopError('NOT_FOUND', 'This file was deleted outside Aladdeen. Save a copy to recover your changes.')
      }
      throw error
    })
    const lineEnding = request.expectedRevision.lineEnding ?? 'LF'
    const hasBom = request.expectedRevision.hasBom ?? false
    const nextBuffer = encodeMarkdown(request.content, lineEnding, hasBom)
    this.assertDocumentSize(nextBuffer.byteLength, tracked.documentKind)
    const currentStats = await stat(safePath)
    this.assertDocumentSize(currentStats.size, tracked.documentKind)
    const currentBuffer = await readFile(safePath)
    this.assertDocumentSize(currentBuffer.byteLength, tracked.documentKind)
    if (!request.force && sha256(currentBuffer) !== request.expectedRevision.sha256) {
      throw new DesktopError('CONFLICT', 'This file changed outside Aladdeen. Choose which version to keep.')
    }
    await this.resolveTrackedDocumentPath(tracked)
    if (!request.force) {
      const latestBuffer = await readFile(safePath)
      this.assertDocumentSize(latestBuffer.byteLength, tracked.documentKind)
      if (sha256(latestBuffer) !== request.expectedRevision.sha256) {
        throw new DesktopError('CONFLICT', 'This file changed outside Aladdeen. Choose which version to keep.')
      }
    }
    this.suppressInternalWrite(safePath)
    try {
      await writeFileAtomic(safePath, nextBuffer, { fsync: true })
    } catch (error) {
      this.suppressedWrites.delete(safePath)
      throw error
    }
    const nextStats = await stat(safePath)
    this.database.setTrackedFileMissing(tracked.id, false)
    return this.createRevision(nextStats.mtimeMs, nextBuffer, lineEnding, hasBom)
  }

  async saveTextDocumentAs(
    request: SaveDocumentRequest,
    destinationPath: string
  ): Promise<FileRevision> {
    const tracked = this.requireTrackedFile(request.fileId)
    if (tracked.environmentId !== this.requireEnvironment()) {
      throw new DesktopError('PERMISSION_DENIED', 'That file is not in this environment.')
    }
    if (!isTextDocumentKind(tracked.documentKind)) {
      throw new DesktopError('INVALID_FILE', 'Binary documents use their own Save As workflow.')
    }
    if (documentKindFromName(destinationPath) !== tracked.documentKind) {
      throw new DesktopError(
        'INVALID_FILE',
        `Save As must keep the ${tracked.documentKind === 'html' ? 'HTML' : 'Markdown'} document format.`
      )
    }
    const canonicalParent = await realpath(dirname(destinationPath))
    const targetPath = resolve(canonicalParent, basename(destinationPath))
    const targetStats = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) {
      throw new DesktopError('INVALID_PATH', 'The Save As destination is not a regular file.')
    }
    const duplicate = this.database.findTrackedFile(this.requireEnvironment(), targetPath)
    if (duplicate && duplicate.id !== tracked.id) {
      throw new DesktopError('ALREADY_EXISTS', 'That destination is already open in this environment.')
    }

    const lineEnding = request.expectedRevision.lineEnding ?? 'LF'
    const hasBom = request.expectedRevision.hasBom ?? false
    const nextBuffer = encodeMarkdown(request.content, lineEnding, hasBom)
    this.assertDocumentSize(nextBuffer.byteLength, tracked.documentKind)
    this.suppressInternalWrite(targetPath)
    try {
      await writeFileAtomic(targetPath, nextBuffer, { fsync: true })
    } catch (error) {
      this.suppressedWrites.delete(targetPath)
      throw error
    }
    const savedStats = await stat(targetPath)
    const project = this.findContainingProject(targetPath)
    this.database.updateTrackedFile(tracked.id, targetPath, project?.id, tracked.documentKind)
    await this.restartStandaloneWatcher()
    return this.createRevision(savedStats.mtimeMs, nextBuffer, lineEnding, hasBom)
  }

  async saveBinaryDocument(
    request: SaveBinaryDocumentRequest,
    data: Uint8Array,
    destinationPath?: string
  ): Promise<FileRevision> {
    const tracked = this.requireTrackedFile(request.fileId)
    if (isTextDocumentKind(tracked.documentKind)) {
      throw new DesktopError('INVALID_FILE', 'Text documents must be saved through their text adapter.')
    }
    if (data.byteLength !== request.byteLength) {
      throw new DesktopError('INVALID_FILE', 'The binary document transfer was incomplete.')
    }
    this.assertDocumentSize(data.byteLength, tracked.documentKind)
    this.validateBinaryBuffer(data, tracked.documentKind)

    const sourcePath = await this.resolveTrackedDocumentPath(tracked)
    let targetPath = sourcePath
    if (destinationPath) {
      if (documentKindFromName(destinationPath) !== tracked.documentKind) {
        throw new DesktopError('INVALID_FILE', `Save As must keep the .${tracked.documentKind} document format.`)
      }
      const canonicalParent = await realpath(dirname(destinationPath))
      targetPath = resolve(canonicalParent, basename(destinationPath))
      const targetStats = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) {
        throw new DesktopError('INVALID_PATH', 'The Save As destination is not a regular file.')
      }
      const duplicate = this.database.findTrackedFile(this.requireEnvironment(), targetPath)
      if (duplicate && duplicate.id !== tracked.id) {
        throw new DesktopError('ALREADY_EXISTS', 'That destination is already open in this environment.')
      }
    }
    if (!destinationPath) {
      const current = await readFile(sourcePath)
      if (!request.force && sha256(current) !== request.expectedRevision.sha256) {
        throw new DesktopError('CONFLICT', 'This file changed outside Aladdeen. Choose which version to keep.')
      }
      await this.resolveTrackedDocumentPath(tracked)
    }

    this.suppressInternalWrite(targetPath)
    try {
      await writeFileAtomic(targetPath, Buffer.from(data), { fsync: true })
    } catch (error) {
      this.suppressedWrites.delete(targetPath)
      throw error
    }

    const savedStats = await stat(targetPath)
    const savedBuffer = Buffer.from(data)
    const revision = this.createRevision(savedStats.mtimeMs, savedBuffer)
    if (destinationPath) {
      const project = this.findContainingProject(targetPath)
      this.database.updateTrackedFile(tracked.id, targetPath, project?.id, tracked.documentKind)
      await this.restartStandaloneWatcher()
    } else {
      this.database.setTrackedFileMissing(tracked.id, false)
    }
    return revision
  }

  async createEntry(request: CreateEntryRequest): Promise<DocumentSnapshot> {
    const project = this.requireProject(request.projectId)
    const inferredKind = documentKindFromName(request.name)
    const documentKind: Exclude<DocumentKind, 'pdf'> = request.documentKind
      ?? (inferredKind === 'html' || inferredKind === 'docx' || inferredKind === 'markdown'
        ? inferredKind
        : 'markdown')
    let name = validateEntryName(request.name)
    if (!documentKindFromName(name)) name += defaultExtensionForKind(documentKind)
    if (documentKindFromName(name) !== documentKind) {
      throw new DesktopError('INVALID_FILE', 'The filename extension does not match the selected document type.')
    }
    if (!project.enabledDocumentKinds.includes(documentKind)) {
      throw new DesktopError('INVALID_FILE', 'Enable this document type in Project settings before creating it here.')
    }
    const target = await resolveNewPath(project.path, request.parentPath, name)
    await this.writeNewDocument(target, documentKind)
    return this.openAbsoluteDocument(target)
  }

  async createStandaloneFile(
    filePath: string,
    documentKind: Exclude<DocumentKind, 'pdf'> = 'markdown'
  ): Promise<DocumentSnapshot> {
    let target = filePath
    if (!documentKindFromName(target)) target += defaultExtensionForKind(documentKind)
    if (documentKindFromName(target) !== documentKind) {
      throw new DesktopError('INVALID_FILE', 'The filename extension does not match the selected document type.')
    }
    await this.writeNewDocument(target, documentKind).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      throw new DesktopError('ALREADY_EXISTS', 'A file already exists at that location.')
    })
    return this.openAbsoluteDocument(target)
  }

  async createFolder(request: CreateEntryRequest): Promise<EnvironmentSnapshot> {
    const project = this.requireProject(request.projectId)
    const target = await resolveNewPath(project.path, request.parentPath, validateEntryName(request.name))
    await mkdir(target)
    return this.getSnapshot()
  }

  async renameEntry(request: RenameEntryRequest): Promise<RenameEntryResult> {
    const project = this.requireProject(request.projectId)
    const source = await resolveExistingPath(project.path, request.path)
    const sourceStats = await stat(source)
    let name = validateEntryName(request.newName)
    if (sourceStats.isFile() && !documentKindFromName(name)) name += extname(source)
    if (sourceStats.isFile() && !isSupportedDocumentName(name)) {
      throw new DesktopError('INVALID_FILE', 'Use a Markdown, HTML, DOCX, or PDF filename.')
    }
    const renamedKind = sourceStats.isFile() ? documentKindFromName(name) : undefined
    if (renamedKind && !project.enabledDocumentKinds.includes(renamedKind)) {
      throw new DesktopError('INVALID_FILE', 'Enable this document type in Project settings before using that extension.')
    }
    const target = await resolveNewPath(project.path, toPosixPath(relative(project.path, dirname(source))), name)
    try {
      await access(target)
      throw new DesktopError('ALREADY_EXISTS', 'An item with that name already exists.')
    } catch (error) {
      if (error instanceof DesktopError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const environmentId = this.requireEnvironment()
    const changes = this.database.listTrackedFiles(environmentId)
      .filter((file) => isPathInside(source, file.path))
      .map((file) => ({ file, nextPath: resolve(target, relative(source, file.path)) }))
    const movingIds = new Set(changes.map(({ file }) => file.id))
    for (const change of changes) {
      const collision = this.database.findTrackedFile(environmentId, change.nextPath)
      if (collision && !movingIds.has(collision.id)) {
        throw new DesktopError('ALREADY_EXISTS', 'That destination belongs to another tracked file.')
      }
    }
    const suppressedPaths = [
      source,
      target,
      ...changes.flatMap(({ file, nextPath }) => [file.path, nextPath])
    ]
    for (const path of suppressedPaths) this.suppressInternalWrite(path)
    try {
      await rename(source, target)
    } catch (error) {
      for (const path of suppressedPaths) this.suppressedWrites.delete(path)
      throw error
    }
    try {
      this.database.updateTrackedFiles(changes.map(({ file, nextPath }) => ({
        id: file.id,
        path: nextPath,
        projectId: project.id
      })))
    } catch (error) {
      await rename(target, source).catch(() => undefined)
      throw error
    }
    const affected = changes.flatMap(({ file }) => {
      const updated = this.database.getTrackedFile(file.id)
      return updated ? [updated] : []
    })
    await this.restartStandaloneWatcher()
    const projects = this.database.listProjects(this.requireEnvironment())
    return {
      projectId: project.id,
      oldPath: request.path,
      newPath: toPosixPath(relative(project.path, target)),
      affectedFiles: affected.map((file) => this.trackedFileSummary(file, projects))
    }
  }

  getProjectEntryPath(projectId: string, relativePath: string): Promise<string> {
    return resolveExistingPath(this.requireProject(projectId).path, relativePath)
  }

  async markPathMissing(projectId: string, relativePath: string): Promise<void> {
    const project = this.requireProject(projectId)
    const deletedPath = resolveSyntacticPath(project.path, relativePath)
    for (const file of this.database.listTrackedFiles(this.requireEnvironment())) {
      if (isPathInside(deletedPath, file.path)) {
        this.database.setTrackedFileMissing(file.id, true)
        this.onEvent({ type: 'removed', projectId, fileId: file.id, relativePath, isDirectory: false })
      }
    }
  }

  getTrackedFilePath(fileId: string): string {
    return this.requireTrackedFile(fileId).path
  }

  getTrackedDocumentKind(fileId: string): DocumentKind {
    return this.requireTrackedFile(fileId).documentKind
  }

  async resolveTrackedFilePath(fileId: string): Promise<string> {
    return this.resolveTrackedDocumentPath(this.requireTrackedFile(fileId))
  }

  async resolveBinarySession(sessionId: string): Promise<{
    path: string
    mimeType: string
    size: number
  }> {
    const session = this.binarySessions.get(sessionId)
    if (!session || session.environmentId !== this.requireEnvironment()) {
      throw new DesktopError('NOT_FOUND', 'That document session has expired.')
    }
    const tracked = this.requireTrackedFile(session.fileId)
    if (tracked.documentKind !== session.documentKind) {
      throw new DesktopError('PERMISSION_DENIED', 'That document session no longer matches its file.')
    }
    const path = await this.resolveTrackedDocumentPath(tracked)
    const fileStats = await stat(path)
    this.assertDocumentSize(fileStats.size, tracked.documentKind)
    await this.validateDocumentSignature(path, tracked.documentKind)
    return {
      path,
      size: fileStats.size,
      mimeType: tracked.documentKind === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
  }

  releaseBinarySession(sessionId: string): void {
    this.binarySessions.delete(sessionId)
  }

  markTrackedFileMissing(fileId: string): void {
    const tracked = this.requireTrackedFile(fileId)
    this.database.setTrackedFileMissing(fileId, true)
    this.onEvent({ type: 'removed', projectId: tracked.projectId, fileId, isDirectory: false })
  }

  async removeTrackedFile(fileId: string): Promise<EnvironmentSnapshot> {
    const tracked = this.requireTrackedFile(fileId)
    this.database.removeTrackedFile(fileId)
    if (!tracked.projectId) await this.restartStandaloneWatcher()
    return this.getSnapshot()
  }

  async locateTrackedFile(fileId: string, replacementPath: string): Promise<DocumentSnapshot> {
    const tracked = this.requireTrackedFile(fileId)
    const canonical = await realpath(replacementPath)
    const fileStats = await stat(canonical)
    const documentKind = documentKindFromName(canonical)
    if (!fileStats.isFile() || !documentKind) {
      throw new DesktopError('INVALID_FILE', 'Choose a Markdown, HTML, DOCX, or PDF document.')
    }
    const duplicate = this.database.findTrackedFile(this.requireEnvironment(), canonical)
    if (duplicate && duplicate.id !== fileId) {
      throw new DesktopError('ALREADY_EXISTS', 'That document is already tracked in this environment.')
    }
    const project = this.findContainingProject(canonical)
    this.database.updateTrackedFile(fileId, canonical, project?.id, documentKind)
    if (!tracked.projectId || !project) await this.restartStandaloneWatcher()
    return this.readDocument(fileId, true)
  }

  async readAsset(fileId: string, target: string): Promise<{ data: Buffer; mimeType: string }> {
    const tracked = this.requireTrackedFile(fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That asset is not available.')
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) throw new DesktopError('INVALID_PATH', 'That asset path is not local.')
    const documentPath = await this.resolveTrackedDocumentPath(tracked)
    const project = tracked.projectId ? this.database.getProject(tracked.projectId) : null
    const authorityRoot = project?.path ?? dirname(documentPath)
    const candidate = resolve(dirname(documentPath), target.split(/[?#]/)[0] ?? '')
    if (!isPathInside(authorityRoot, candidate)) throw new DesktopError('INVALID_PATH', 'That asset points outside the allowed folder.')
    const canonical = await resolveExistingPath(authorityRoot, toPosixPath(relative(authorityRoot, candidate)))
    const mimeType = LOCAL_ASSET_MIME_TYPES[extname(canonical).toLowerCase()]
    if (!mimeType) throw new DesktopError('INVALID_FILE', 'That asset type is not supported.')
    const fileStats = await stat(canonical)
    if (!fileStats.isFile() || fileStats.size > 30_000_000) throw new DesktopError('INVALID_FILE', 'That asset is too large or is not a file.')
    return { data: await readFile(canonical), mimeType }
  }

  async close(): Promise<void> {
    this.binarySessions.clear()
    await this.stopWatchers()
  }

  private requireEnvironment(): string {
    if (!this.environmentId) throw new DesktopError('NOT_FOUND', 'Create or select an environment first.')
    return this.environmentId
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.database.getProject(projectId)
    if (!project || project.environmentId !== this.requireEnvironment()) throw new DesktopError('NOT_FOUND', 'That project is not available in this environment.')
    return project
  }

  private requireTrackedFile(fileId: string): TrackedFileRecord {
    const file = this.database.getTrackedFile(fileId)
    if (!file || file.environmentId !== this.requireEnvironment()) throw new DesktopError('NOT_FOUND', 'That file is not available in this environment.')
    return file
  }

  private findContainingProject(fullPath: string): ProjectRecord | undefined {
    return this.database.listProjects(this.requireEnvironment()).find((project) => isPathInside(project.path, fullPath))
  }

  private assertProjectRootAvailable(canonicalPath: string): void {
    for (const project of this.database.listProjects(this.requireEnvironment())) {
      if (isPathInside(project.path, canonicalPath) || isPathInside(canonicalPath, project.path)) {
        throw new DesktopError('ALREADY_EXISTS', `“${project.name}” already covers that folder location.`)
      }
    }
  }

  private async readTracked(tracked: TrackedFileRecord): Promise<DocumentSnapshot> {
    const safePath = await this.resolveTrackedDocumentPath(tracked)
    const fileStats = await stat(safePath)
    const documentKind = documentKindFromName(safePath)
    if (!fileStats.isFile() || !documentKind) {
      throw new DesktopError('INVALID_FILE', 'Aladdeen opens Markdown, HTML, DOCX, and PDF documents.')
    }
    this.assertDocumentSize(fileStats.size, documentKind)
    await this.validateDocumentSignature(safePath, documentKind)
    this.database.setTrackedFileMissing(tracked.id, false)
    if (tracked.documentKind !== documentKind) {
      this.database.updateTrackedFile(tracked.id, safePath, tracked.projectId, documentKind)
    }
    const current = { ...tracked, documentKind, missing: false }
    const summary = this.trackedFileSummary(current)
    const base = {
      id: tracked.id,
      environmentId: tracked.environmentId,
      projectId: summary.projectId,
      relativePath: summary.relativePath,
      name: summary.name,
      location: summary.location,
      fullPath: summary.fullPath
    }

    if (isTextDocumentKind(documentKind)) {
      const buffer = await readFile(safePath)
      this.assertDocumentSize(buffer.byteLength, documentKind)
      const decoded = decodeMarkdown(buffer)
      return {
        ...base,
        documentKind,
        content: decoded.content,
        encoding: 'utf-8',
        capabilities: DOCUMENT_CAPABILITIES[documentKind],
        revision: this.createRevision(fileStats.mtimeMs, buffer, decoded.lineEnding, decoded.hasBom)
      } satisfies TextDocumentSnapshot
    }

    const session = this.createBinarySession(tracked.id, tracked.environmentId, documentKind)
    return {
      ...base,
      documentKind,
      capabilities: DOCUMENT_CAPABILITIES[documentKind],
      revision: {
        mtimeMs: fileStats.mtimeMs,
        size: fileStats.size,
        sha256: await sha256File(safePath)
      },
      session: {
        id: session,
        url: `aladdeen-document://session/${encodeURIComponent(session)}`,
        byteLength: fileStats.size,
        signed: documentKind === 'pdf' ? await this.pdfAppearsSigned(safePath) : undefined
      }
    } satisfies BinaryDocumentSnapshot
  }

  private createRevision(
    mtimeMs: number,
    buffer: Buffer,
    lineEnding?: NonNullable<FileRevision['lineEnding']>,
    hasBom?: boolean
  ): FileRevision {
    return {
      mtimeMs,
      size: buffer.length,
      sha256: sha256(buffer),
      ...(lineEnding ? { lineEnding, hasBom: Boolean(hasBom) } : {})
    }
  }

  private async resolveTrackedDocumentPath(tracked: TrackedFileRecord): Promise<string> {
    const targetStats = await lstat(tracked.path)
    if (targetStats.isSymbolicLink()) throw new DesktopError('INVALID_PATH', 'Symbolic-link documents are not available.')
    const canonical = await realpath(tracked.path)
    if (canonical !== tracked.path) {
      throw new DesktopError('INVALID_PATH', 'The document path changed through a symbolic link.')
    }
    const project = tracked.projectId ? this.database.getProject(tracked.projectId) : null
    if (project) {
      const canonicalRoot = await realpath(project.path)
      if (canonicalRoot !== project.path || !isPathInside(canonicalRoot, canonical)) {
        throw new DesktopError('PERMISSION_DENIED', 'The document is no longer inside its registered project.')
      }
    }
    return canonical
  }

  private assertDocumentSize(size: number, documentKind: DocumentKind): void {
    const limit = isTextDocumentKind(documentKind) ? MAX_DOCUMENT_BYTES : MAX_BINARY_DOCUMENT_BYTES
    if (size > limit) {
      const label = isTextDocumentKind(documentKind) ? '20 MiB' : '512 MiB'
      throw new DesktopError('INVALID_FILE', `This ${documentKind.toUpperCase()} document is larger than Aladdeen’s ${label} limit.`)
    }
  }

  private createBinarySession(
    fileId: string,
    environmentId: string,
    documentKind: BinaryDocumentKind
  ): string {
    for (const [id, session] of this.binarySessions) {
      if (session.fileId === fileId && session.environmentId === environmentId) return id
    }
    const id = randomUUID()
    this.binarySessions.set(id, { fileId, environmentId, documentKind })
    return id
  }

  private async validateDocumentSignature(
    path: string,
    documentKind: DocumentKind
  ): Promise<void> {
    if (documentKind === 'docx') {
      try {
        await inspectDocxPackage(path)
      } catch (error) {
        throw new DesktopError(
          'INVALID_FILE',
          'This file is not a safe, supported DOCX document.',
          error instanceof Error ? error.message : undefined
        )
      }
      return
    }

    const handle = await open(path, 'r')
    try {
      const header = Buffer.alloc(1024)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      const bytes = header.subarray(0, bytesRead)
      if (documentKind === 'pdf') {
        const marker = bytes.indexOf(Buffer.from('%PDF-'))
        if (marker < 0 || marker > 1019) {
          throw new DesktopError('INVALID_FILE', 'This file does not contain a valid PDF signature.')
        }
        return
      }
      try {
        const fileStats = await handle.stat()
        this.assertDocumentSize(fileStats.size, documentKind)
        const buffer = await readFile(path)
        decodeMarkdown(buffer)
      } catch (error) {
        if (error instanceof DesktopError) throw error
        throw new DesktopError(
          'INVALID_FILE',
          `This ${documentKind === 'html' ? 'HTML' : 'Markdown'} document is not valid UTF-8 text.`,
          error instanceof Error ? error.message : undefined
        )
      }
    } finally {
      await handle.close()
    }
  }

  private validateBinaryBuffer(
    data: Uint8Array,
    documentKind: BinaryDocumentKind
  ): void {
    if (documentKind === 'pdf') {
      const header = new TextDecoder('latin1').decode(data.subarray(0, 1024))
      if (!header.includes('%PDF-')) {
        throw new DesktopError('INVALID_FILE', 'The PDF editor produced an invalid document.')
      }
      return
    }
    if (
      data.byteLength < 4 ||
      data[0] !== 0x50 ||
      data[1] !== 0x4b ||
      (data[2] !== 0x03 && data[2] !== 0x05 && data[2] !== 0x07)
    ) {
      throw new DesktopError('INVALID_FILE', 'The DOCX editor produced an invalid OOXML package.')
    }
    try {
      inspectDocxBuffer(data)
    } catch (error) {
      throw new DesktopError(
        'INVALID_FILE',
        'The DOCX editor produced an unsafe or incomplete OOXML package.',
        error instanceof Error ? error.message : undefined
      )
    }
  }

  private async pdfAppearsSigned(path: string): Promise<boolean> {
    const fileStats = await stat(path)
    const sampleSize = Math.min(fileStats.size, 8 * 1024 * 1024)
    const handle = await open(path, 'r')
    try {
      const sample = Buffer.alloc(sampleSize)
      await handle.read(sample, 0, sampleSize, 0)
      const text = sample.toString('latin1')
      return /\/ByteRange\s*\[|\/Type\s*\/Sig\b/.test(text)
    } finally {
      await handle.close()
    }
  }

  private async writeNewDocument(
    target: string,
    documentKind: Exclude<DocumentKind, 'pdf'>
  ): Promise<void> {
    const title = basename(target, extname(target))
    if (documentKind === 'markdown') {
      await writeFile(target, `# ${title}\n\n`, { flag: 'wx' })
      return
    }
    if (documentKind === 'html') {
      await writeFile(
        target,
        `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${escapeHtml(title)}</title>\n</head>\n<body>\n  <h1>${escapeHtml(title)}</h1>\n</body>\n</html>\n`,
        { flag: 'wx' }
      )
      return
    }
    const document = new Document({
      sections: [{
        children: [new Paragraph({ text: title, heading: 'Title' })]
      }]
    })
    await writeFile(target, await Packer.toBuffer(document), { flag: 'wx' })
  }

  private suppressInternalWrite(path: string): void {
    const until = Date.now() + 2_000
    this.suppressedWrites.set(path, until)
    const timer = setTimeout(() => {
      if ((this.suppressedWrites.get(path) ?? 0) <= Date.now()) this.suppressedWrites.delete(path)
    }, 2_100)
    timer.unref?.()
  }

  private async projectSummary(project: ProjectRecord): Promise<ProjectSummary> {
    return {
      id: project.id,
      environmentId: project.environmentId,
      name: project.name,
      displayPath: abbreviatePath(project.path),
      expandedPaths: this.database.getProjectExpandedPaths(project.id),
      scopeMode: project.scopeMode,
      includePaths: project.includePaths,
      excludePatterns: project.excludePatterns,
      enabledDocumentKinds: project.enabledDocumentKinds,
      groupName: project.groupName,
      pinned: project.pinned,
      archived: project.archived,
      fileCount: project.fileCount,
      indexStatus: project.indexStatus,
      indexedAt: project.indexedAt
    }
  }

  private trackedFileSummary(file: TrackedFileRecord, projects = this.database.listProjects(file.environmentId)): TrackedFileSummary {
    const project = file.projectId ? projects.find((candidate) => candidate.id === file.projectId) : undefined
    const relativePath = project ? toPosixPath(relative(project.path, file.path)) : undefined
    return {
      id: file.id,
      environmentId: file.environmentId,
      projectId: project?.id,
      name: basename(file.path),
      location: project ? `${project.name} › ${relativePath}` : abbreviatePath(dirname(file.path)),
      fullPath: file.path,
      relativePath,
      lastOpenedAt: file.lastOpenedAt,
      missing: file.missing,
      documentKind: file.documentKind
    }
  }

  private async scanProject(
    rootPath: string,
    enabledDocumentKinds: readonly DocumentKind[] = ALL_PROJECT_DOCUMENT_KINDS
  ): Promise<{ files: ProjectIndexFileRecord[]; truncated: boolean }> {
    const files: ProjectIndexFileRecord[] = []
    const directories: Array<{ fullPath: string; relativePath: string }> = [{ fullPath: rootPath, relativePath: '' }]
    const enabledKinds = new Set(enabledDocumentKinds)

    while (directories.length > 0) {
      const directory = directories.pop()!
      const entries = await readdir(directory.fullPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const childRelative = directory.relativePath
          ? `${toPosixPath(directory.relativePath)}/${entry.name}`
          : entry.name
        const fullPath = resolveSyntacticPath(rootPath, childRelative)
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue
          directories.push({ fullPath, relativePath: childRelative })
          continue
        }
        const documentKind = documentKindFromName(entry.name)
        if (!entry.isFile() || !documentKind || !enabledKinds.has(documentKind)) continue
        const fileStats = await stat(fullPath)
        if (!fileStats.isFile()) continue
        files.push({
          projectId: '',
          relativePath: childRelative,
          parentPath: toPosixPath(dirname(childRelative)) === '.' ? '' : toPosixPath(dirname(childRelative)),
          name: entry.name,
          mtimeMs: fileStats.mtimeMs,
          size: fileStats.size,
          documentKind
        })
      }
    }
    return { files, truncated: files.length > MAX_SCOPE_PREVIEW_FILES }
  }

  private async reindexProject(project: ProjectRecord): Promise<void> {
    if (project.archived) {
      this.database.setProjectIndexStatus(project.id, 'paused', project.fileCount, project.indexedAt)
      return
    }
    this.database.setProjectIndexStatus(project.id, 'indexing', project.fileCount)
    try {
      const scan = await this.scanProject(project.path, project.enabledDocumentKinds)
      const included = filterIndexedFiles(scan.files, project).map((file) => ({ ...file, projectId: project.id }))
      this.database.replaceProjectIndex(project.id, included)
    } catch (error) {
      this.database.setProjectIndexStatus(project.id, 'error', project.fileCount)
      throw error
    }
  }

  private async refreshMissingFiles(): Promise<void> {
    if (!this.environmentId) return
    await Promise.all(this.database.listTrackedFiles(this.environmentId).map(async (file) => {
      let missing = false
      try { await access(file.path) } catch { missing = true }
      this.database.setTrackedFileMissing(file.id, missing)
    }))
  }

  private async reassociateTrackedFiles(): Promise<void> {
    const environmentId = this.requireEnvironment()
    for (const file of this.database.listTrackedFiles(environmentId)) {
      const project = this.findContainingProject(file.path)
      if (project?.id !== file.projectId) this.database.updateTrackedFile(file.id, file.path, project?.id)
    }
    await this.restartStandaloneWatcher()
  }

  private async startWatchers(): Promise<void> {
    for (const project of this.database.listProjects(this.requireEnvironment())) await this.startProjectWatcher(project)
    await this.restartStandaloneWatcher()
  }

  private async startProjectWatcher(project: ProjectRecord): Promise<void> {
    await this.projectWatchers.get(project.id)?.close()
    if (project.archived) return
    const watchTargets = project.scopeMode === 'all'
      ? [project.path]
      : normalizeScopePaths(project.includePaths).map((path) => resolveSyntacticPath(project.path, path))
    if (watchTargets.length === 0) return
    const watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 },
      ignored: (path, pathStats) => {
        const relation = relative(project.path, path)
        if (relation && relation.split(sep).some((part) => IGNORED_DIRECTORY_NAMES.has(part))) return true
        if (!relation || !pathStats) return false
        const normalized = toPosixPath(relation)
        if (pathStats.isDirectory()) return normalizePatterns(project.excludePatterns).some((pattern) => matchesGlob(`${normalized}/`, pattern))
        const documentKind = documentKindFromName(normalized)
        return !documentKind || !isIncludedByProjectPolicy(normalized, documentKind, project)
      }
    })
    watcher.on('all', (eventName, fullPath) => this.handleProjectEvent(project, eventName, fullPath))
    this.projectWatchers.set(project.id, watcher)
  }

  private async restartStandaloneWatcher(): Promise<void> {
    await this.standaloneWatcher?.close()
    this.standaloneWatcher = null
    if (!this.environmentId) return
    const exactFiles = this.database.listTrackedFiles(this.environmentId).filter((file) => {
      if (!file.projectId) return true
      const project = this.database.getProject(file.projectId)
      if (!project || project.archived || !isPathInside(project.path, file.path)) return true
      return !isIncludedByProjectPolicy(
        toPosixPath(relative(project.path, file.path)),
        file.documentKind,
        project
      )
    })
    if (exactFiles.length === 0) return
    const watchedEnvironmentId = this.environmentId
    const watcher = chokidar.watch(exactFiles.map((file) => file.path), {
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 }
    })
    watcher.on('all', (eventName, fullPath) => {
      if (!watchedEnvironmentId || this.environmentId !== watchedEnvironmentId) return
      const file = this.database.listTrackedFiles(watchedEnvironmentId).find((candidate) => candidate.path === fullPath)
      if (!file) return
      if (this.consumeSuppressed(fullPath)) return
      const type: EnvironmentEvent['type'] =
        eventName.startsWith('unlink') ? 'removed' : eventName === 'add' ? 'added' : 'changed'
      if (type === 'removed') this.database.setTrackedFileMissing(file.id, true)
      else this.database.setTrackedFileMissing(file.id, false)
      this.onEvent({ type, fileId: file.id, isDirectory: false })
    })
    this.standaloneWatcher = watcher
  }

  private handleProjectEvent(project: ProjectRecord, eventName: string, fullPath: string): void {
    if (project.environmentId !== this.environmentId || !isPathInside(project.path, fullPath) || this.consumeSuppressed(fullPath)) return
    const isDirectory = eventName === 'addDir' || eventName === 'unlinkDir'
    const relativePath = toPosixPath(relative(project.path, fullPath))
    const documentKind = documentKindFromName(fullPath)
    if (!isDirectory && (!documentKind || !isIncludedByProjectPolicy(relativePath, documentKind, project))) return
    const file = this.database.listTrackedFiles(project.environmentId).find((candidate) => candidate.path === fullPath)
    const type: EnvironmentEvent['type'] = eventName === 'change' ? 'changed' : eventName.startsWith('unlink') ? 'removed' : 'added'
    if (file && type === 'removed') this.database.setTrackedFileMissing(file.id, true)
    if (file && type === 'added') this.database.setTrackedFileMissing(file.id, false)
    this.onEvent({ type, projectId: project.id, fileId: file?.id, relativePath, isDirectory })
    if (type !== 'changed' || isDirectory) this.scheduleProjectReindex(project)
  }

  private scheduleProjectReindex(project: ProjectRecord, delay = 220): void {
    const existing = this.reindexTimers.get(project.id)
    if (existing) clearTimeout(existing)
    this.reindexTimers.set(project.id, setTimeout(() => {
      this.reindexTimers.delete(project.id)
      if (project.environmentId !== this.environmentId) return
      void this.reindexProject(this.database.getProject(project.id) ?? project)
        .then(() => this.onEvent({ type: 'tree-changed', projectId: project.id, isDirectory: true }))
        .catch(() => this.onEvent({ type: 'tree-changed', projectId: project.id, isDirectory: true }))
    }, delay))
  }

  private consumeSuppressed(fullPath: string): boolean {
    const until = this.suppressedWrites.get(fullPath)
    if (!until) return false
    if (until > Date.now()) return true
    this.suppressedWrites.delete(fullPath)
    return false
  }

  private async stopWatchers(): Promise<void> {
    for (const timer of this.reindexTimers.values()) clearTimeout(timer)
    this.reindexTimers.clear()
    await Promise.all([...this.projectWatchers.values()].map((watcher) => watcher.close()))
    this.projectWatchers.clear()
    await this.standaloneWatcher?.close()
    this.standaloneWatcher = null
  }
}

function abbreviatePath(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  return isPathInside(home, path) ? `~${path.slice(home.length)}` : path
}

function normalizeScopePaths(paths: string[]): string[] {
  const normalized = paths.map((path) => toPosixPath(path.trim()).replace(/^\.\//, '').replace(/\/+$/, ''))
  for (const path of normalized) {
    if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '')) {
      throw new DesktopError('INVALID_PATH', 'A selected project path is not valid.')
    }
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right))
}

function normalizePatterns(patterns: string[]): string[] {
  return [...new Set(patterns.map((pattern) => toPosixPath(pattern.trim()).replace(/^\//, '')).filter(Boolean))]
}

function normalizeDocumentKinds(kinds: readonly DocumentKind[]): DocumentKind[] {
  const normalized = [...new Set(kinds.filter(isDocumentKind))]
  if (normalized.length === 0) throw new DesktopError('INVALID_PATH', 'Choose at least one document type.')
  return normalized
}

function isIncludedByScope(relativePath: string, project: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns'>): boolean {
  const normalized = toPosixPath(relativePath)
  const included = project.scopeMode === 'all' || normalizeScopePaths(project.includePaths).some(
    (path) => normalized === path || normalized.startsWith(`${path}/`)
  )
  if (!included) return false
  return !normalizePatterns(project.excludePatterns).some((pattern) => matchesGlob(normalized, pattern))
}

function isIncludedByProjectPolicy(
  relativePath: string,
  documentKind: DocumentKind,
  project: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns' | 'enabledDocumentKinds'>
): boolean {
  return project.enabledDocumentKinds.includes(documentKind) && isIncludedByScope(relativePath, project)
}

function matchesGlob(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const source = escaped
    .replaceAll('**/', '\u0000')
    .replaceAll('**', '\u0001')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('\u0000', '(?:.*/)?')
    .replaceAll('\u0001', '.*')
  const prefix = pattern.endsWith('/') ? source : `${source}(?:/.*)?`
  return new RegExp(`^${prefix}$`, 'i').test(path)
}

function filterIndexedFiles(
  files: ProjectIndexFileRecord[],
  project: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns' | 'enabledDocumentKinds'>
): ProjectIndexFileRecord[] {
  return files.filter((file) => isIncludedByProjectPolicy(file.relativePath, file.documentKind, project))
}

function countDocumentKinds(files: readonly ProjectIndexFileRecord[]): Record<DocumentKind, number> {
  const counts: Record<DocumentKind, number> = { markdown: 0, html: 0, docx: 0, pdf: 0 }
  for (const file of files) counts[file.documentKind] += 1
  return counts
}

function buildScopeTree(files: ProjectIndexFileRecord[]): ProjectScopeNode[] {
  const roots: ProjectScopeNode[] = []
  const childrenByPath = new Map<string, ProjectScopeNode[]>()
  childrenByPath.set('', roots)
  const directories = new Map<string, ProjectScopeNode>()

  for (const file of files) {
    const parts = file.relativePath.split('/')
    let parentPath = ''
    for (const part of parts.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${part}` : part
      let directory = directories.get(directoryPath)
      if (!directory) {
        const children: ProjectScopeNode[] = []
        directory = {
          id: directoryPath,
          name: part,
          path: directoryPath,
          kind: 'directory',
          children,
          descendantCount: 0
        }
        directories.set(directoryPath, directory)
        childrenByPath.get(parentPath)!.push(directory)
        childrenByPath.set(directoryPath, children)
      }
      directory.descendantCount += 1
      parentPath = directoryPath
    }
    childrenByPath.get(parentPath)!.push({
      id: file.relativePath,
      name: file.name,
      path: file.relativePath,
      kind: 'file',
      descendantCount: 1,
      documentKind: file.documentKind
    })
  }

  const sort = (nodes: ProjectScopeNode[]): void => {
    nodes.sort(compareTreeNodes)
    for (const node of nodes) if (node.children) sort(node.children)
  }
  sort(roots)
  return roots
}

function compareTreeNodes(left: WorkspaceTreeNode, right: WorkspaceTreeNode): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      outputs[index] = await operation(inputs[index]!)
    }
  })
  await Promise.all(workers)
  return outputs
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
