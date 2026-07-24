import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { access, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
import { DesktopError } from '@main/errors'
import type { AppDatabase, ProjectIndexFileRecord, ProjectRecord, TrackedFileRecord } from './database'
import type {
  CreateEntryRequest,
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
  TrackedFileSummary,
  UpdateProjectRequest,
  WorkspaceTreeNode
} from '@shared/contracts'
import { toPosixPath } from '@shared/path'
import { decodeMarkdown, encodeMarkdown, sha256 } from './file-format'
import { isPathInside, resolveExistingPath, resolveNewPath, resolveSyntacticPath } from './path-guard'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules'])
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

function isMarkdown(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

export function validateEntryName(input: string): string {
  const name = input.trim()
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
    throw new DesktopError('INVALID_PATH', 'Use a simple file or folder name without path separators.')
  }
  const base = name.split('.')[0]?.toUpperCase()
  if (base && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
    throw new DesktopError('INVALID_PATH', 'That name is reserved by Windows.')
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

  constructor(
    private readonly database: AppDatabase,
    private readonly onEvent: (event: EnvironmentEvent) => void
  ) {}

  get activeEnvironmentId(): string | null {
    return this.environmentId
  }

  async activateEnvironment(environmentId: string): Promise<EnvironmentSnapshot> {
    const environment = this.database.getEnvironment(environmentId)
    if (!environment) throw new DesktopError('NOT_FOUND', 'That environment no longer exists.')
    await this.stopWatchers()
    this.projectCandidates.clear()
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
      excludePatterns: normalizePatterns(options.excludePatterns)
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
        excludePatterns: normalizePatterns(selection.excludePatterns)
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
      totalMarkdownFiles: scan.files.length,
      truncated: scan.truncated
    }
  }

  async updateProject(request: UpdateProjectRequest): Promise<EnvironmentSnapshot> {
    const current = this.requireProject(request.projectId)
    const project = this.database.updateProject(current.id, {
      scopeMode: request.scopeMode,
      includePaths: normalizeScopePaths(request.includePaths),
      excludePatterns: normalizePatterns(request.excludePatterns),
      groupName: request.groupName,
      pinned: request.pinned,
      archived: request.archived
    })
    await this.projectWatchers.get(project.id)?.close()
    this.projectWatchers.delete(project.id)
    if (project.archived) {
      this.database.setProjectIndexStatus(project.id, 'paused', project.fileCount, project.indexedAt)
    } else {
      await this.reindexProject(project)
      await this.startProjectWatcher(this.database.getProject(project.id)!)
    }
    await this.reassociateTrackedFiles()
    return this.getSnapshot()
  }

  listProjectChildren(projectId: string, parentPath: string, cursor = 0): ProjectTreePage {
    const project = this.requireProject(projectId)
    const entries = directChildren(this.database.listProjectIndex(project.id), parentPath)
    const page = entries.slice(cursor, cursor + PROJECT_TREE_PAGE_SIZE)
    const nextCursor = cursor + page.length < entries.length ? cursor + page.length : undefined
    return { projectId, parentPath, entries: page, total: entries.length, nextCursor }
  }

  searchProjectFiles(query: string, limit = 60): IndexedFileSummary[] {
    return this.database.searchProjectIndex(this.requireEnvironment(), query.trim(), Math.min(100, Math.max(1, limit)))
      .map((file) => ({
        projectId: file.projectId,
        projectName: file.projectName,
        name: file.name,
        relativePath: file.relativePath,
        location: `${file.projectName} › ${file.relativePath}`
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
    const canonical = await realpath(filePath)
    const fileStats = await stat(canonical)
    if (!fileStats.isFile() || !isMarkdown(canonical)) throw new DesktopError('INVALID_FILE', 'Aladdeen opens .md and .markdown files.')
    const project = this.findContainingProject(canonical)
    const tracked = this.database.upsertTrackedFile(environmentId, canonical, project?.id)
    if (!project) await this.restartStandaloneWatcher()
    return this.readTracked(tracked)
  }

  async openRelativeDocument(fileId: string, target: string): Promise<DocumentSnapshot> {
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) {
      throw new DesktopError('INVALID_PATH', 'That link is not a local Markdown file.')
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
        ? this.database.upsertTrackedFile(tracked.environmentId, tracked.path, tracked.projectId)
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
    const currentBuffer = await readFile(tracked.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        this.database.setTrackedFileMissing(tracked.id, true)
        throw new DesktopError('NOT_FOUND', 'This file was deleted outside Aladdeen. Save a copy to recover your changes.')
      }
      throw error
    })
    if (!request.force && sha256(currentBuffer) !== request.expectedRevision.sha256) {
      throw new DesktopError('CONFLICT', 'This file changed outside Aladdeen. Choose which version to keep.')
    }
    const nextBuffer = encodeMarkdown(request.content, request.expectedRevision.lineEnding, request.expectedRevision.hasBom)
    this.suppressedWrites.set(tracked.path, Date.now() + 2_000)
    await writeFileAtomic(tracked.path, nextBuffer, { fsync: true })
    const nextStats = await stat(tracked.path)
    this.database.setTrackedFileMissing(tracked.id, false)
    return this.createRevision(nextStats.mtimeMs, nextBuffer, request.expectedRevision.lineEnding, request.expectedRevision.hasBom)
  }

  async createEntry(request: Omit<CreateEntryRequest, 'kind'>): Promise<DocumentSnapshot> {
    const project = this.requireProject(request.projectId)
    let name = validateEntryName(request.name)
    if (!isMarkdown(name)) name += '.md'
    const target = await resolveNewPath(project.path, request.parentPath, name)
    await writeFile(target, `# ${basename(name, extname(name))}\n\n`, { flag: 'wx' })
    return this.openAbsoluteDocument(target)
  }

  async createStandaloneFile(filePath: string): Promise<DocumentSnapshot> {
    let target = filePath
    if (!isMarkdown(target)) target += '.md'
    const name = basename(target, extname(target))
    await writeFile(target, `# ${name}\n\n`, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      throw new DesktopError('ALREADY_EXISTS', 'A file already exists at that location.')
    })
    return this.openAbsoluteDocument(target)
  }

  async createFolder(request: Omit<CreateEntryRequest, 'kind'>): Promise<EnvironmentSnapshot> {
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
    if (sourceStats.isFile() && !isMarkdown(name)) name += '.md'
    const target = await resolveNewPath(project.path, toPosixPath(relative(project.path, dirname(source))), name)
    try {
      await access(target)
      throw new DesktopError('ALREADY_EXISTS', 'An item with that name already exists.')
    } catch (error) {
      if (error instanceof DesktopError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.suppressedWrites.set(source, Date.now() + 2_000)
    this.suppressedWrites.set(target, Date.now() + 2_000)
    await rename(source, target)
    const affected: TrackedFileRecord[] = []
    for (const file of this.database.listTrackedFiles(this.requireEnvironment())) {
      if (!isPathInside(source, file.path)) continue
      const nextPath = resolve(target, relative(source, file.path))
      this.database.updateTrackedFile(file.id, nextPath, project.id)
      const updated = this.database.getTrackedFile(file.id)
      if (updated) affected.push(updated)
    }
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
    if (!fileStats.isFile() || !isMarkdown(canonical)) throw new DesktopError('INVALID_FILE', 'Choose a Markdown file.')
    const duplicate = this.database.findTrackedFile(this.requireEnvironment(), canonical)
    if (duplicate && duplicate.id !== fileId) throw new DesktopError('ALREADY_EXISTS', 'That Markdown file is already tracked in this environment.')
    const project = this.findContainingProject(canonical)
    this.database.updateTrackedFile(fileId, canonical, project?.id)
    if (!tracked.projectId || !project) await this.restartStandaloneWatcher()
    return this.readDocument(fileId, true)
  }

  async readAsset(fileId: string, target: string): Promise<{ data: Buffer; mimeType: string }> {
    const tracked = this.requireTrackedFile(fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new DesktopError('PERMISSION_DENIED', 'That asset is not available.')
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) throw new DesktopError('INVALID_PATH', 'That image path is not local.')
    const project = tracked.projectId ? this.database.getProject(tracked.projectId) : null
    const authorityRoot = project?.path ?? dirname(tracked.path)
    const candidate = resolve(dirname(tracked.path), target.split(/[?#]/)[0] ?? '')
    if (!isPathInside(authorityRoot, candidate)) throw new DesktopError('INVALID_PATH', 'That image points outside the allowed folder.')
    const canonical = await realpath(candidate)
    if (!isPathInside(authorityRoot, canonical)) throw new DesktopError('INVALID_PATH', 'That image symlink leaves the allowed folder.')
    const mimeType = IMAGE_MIME_TYPES[extname(canonical).toLowerCase()]
    if (!mimeType) throw new DesktopError('INVALID_FILE', 'That asset type is not supported.')
    const fileStats = await stat(canonical)
    if (!fileStats.isFile() || fileStats.size > 30_000_000) throw new DesktopError('INVALID_FILE', 'That image is too large or is not a file.')
    return { data: await readFile(canonical), mimeType }
  }

  async close(): Promise<void> {
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
    const buffer = await readFile(tracked.path)
    const fileStats = await stat(tracked.path)
    if (!fileStats.isFile() || !isMarkdown(tracked.path)) throw new DesktopError('INVALID_FILE', 'Aladdeen opens .md and .markdown files.')
    const decoded = decodeMarkdown(buffer)
    this.database.setTrackedFileMissing(tracked.id, false)
    const summary = this.trackedFileSummary({ ...tracked, missing: false })
    return {
      id: tracked.id,
      environmentId: tracked.environmentId,
      projectId: summary.projectId,
      relativePath: summary.relativePath,
      name: summary.name,
      location: summary.location,
      fullPath: summary.fullPath,
      content: decoded.content,
      revision: this.createRevision(fileStats.mtimeMs, buffer, decoded.lineEnding, decoded.hasBom)
    }
  }

  private createRevision(mtimeMs: number, buffer: Buffer, lineEnding: FileRevision['lineEnding'], hasBom: boolean): FileRevision {
    return { mtimeMs, size: buffer.length, sha256: sha256(buffer), lineEnding, hasBom }
  }

  private async projectSummary(project: ProjectRecord): Promise<ProjectSummary> {
    return {
      id: project.id,
      environmentId: project.environmentId,
      name: project.name,
      displayPath: abbreviatePath(project.path),
      tree: [],
      expandedPaths: this.database.getProjectExpandedPaths(project.id),
      scopeMode: project.scopeMode,
      includePaths: project.includePaths,
      excludePatterns: project.excludePatterns,
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
      missing: file.missing
    }
  }

  private async scanProject(rootPath: string): Promise<{ files: ProjectIndexFileRecord[]; truncated: boolean }> {
    const files: ProjectIndexFileRecord[] = []
    const directories: Array<{ fullPath: string; relativePath: string }> = [{ fullPath: rootPath, relativePath: '' }]

    while (directories.length > 0) {
      const directory = directories.pop()!
      const entries = await readdir(directory.fullPath, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const childRelative = directory.relativePath
          ? `${toPosixPath(directory.relativePath)}/${entry.name}`
          : entry.name
        const fullPath = resolveSyntacticPath(rootPath, childRelative)
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
          directories.push({ fullPath, relativePath: childRelative })
          continue
        }
        if (!entry.isFile() || !isMarkdown(entry.name)) continue
        const fileStats = await stat(fullPath).catch(() => null)
        if (!fileStats?.isFile()) continue
        files.push({
          projectId: '',
          relativePath: childRelative,
          parentPath: toPosixPath(dirname(childRelative)) === '.' ? '' : toPosixPath(dirname(childRelative)),
          name: entry.name,
          mtimeMs: fileStats.mtimeMs,
          size: fileStats.size
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
      const scan = await this.scanProject(project.path)
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
        if (relation && relation.split(sep).some((part) => IGNORED_DIRECTORY_NAMES.has(part) || part.startsWith('.'))) return true
        if (!relation || !pathStats) return false
        const normalized = toPosixPath(relation)
        if (pathStats.isDirectory()) return normalizePatterns(project.excludePatterns).some((pattern) => matchesGlob(`${normalized}/`, pattern))
        return !isMarkdown(normalized) || !isIncludedByScope(normalized, project)
      }
    })
    watcher.on('all', (eventName, fullPath) => this.handleProjectEvent(project, eventName, fullPath))
    this.projectWatchers.set(project.id, watcher)
  }

  private async restartStandaloneWatcher(): Promise<void> {
    await this.standaloneWatcher?.close()
    this.standaloneWatcher = null
    if (!this.environmentId) return
    const standalone = this.database.listTrackedFiles(this.environmentId).filter((file) => !file.projectId)
    if (standalone.length === 0) return
    const watcher = chokidar.watch(standalone.map((file) => file.path), {
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 }
    })
    watcher.on('all', (eventName, fullPath) => {
      const file = this.database.listTrackedFiles(this.requireEnvironment()).find((candidate) => candidate.path === fullPath)
      if (!file) return
      if (this.consumeSuppressed(fullPath)) return
      const type: EnvironmentEvent['type'] = eventName.startsWith('unlink') ? 'removed' : 'changed'
      if (type === 'removed') this.database.setTrackedFileMissing(file.id, true)
      this.onEvent({ type, fileId: file.id, isDirectory: false })
    })
    this.standaloneWatcher = watcher
  }

  private handleProjectEvent(project: ProjectRecord, eventName: string, fullPath: string): void {
    if (!isPathInside(project.path, fullPath) || this.consumeSuppressed(fullPath)) return
    const isDirectory = eventName === 'addDir' || eventName === 'unlinkDir'
    if (!isDirectory && !isMarkdown(fullPath)) return
    const file = this.database.listTrackedFiles(project.environmentId).find((candidate) => candidate.path === fullPath)
    const type: EnvironmentEvent['type'] = eventName === 'change' ? 'changed' : eventName.startsWith('unlink') ? 'removed' : 'added'
    if (file && type === 'removed') this.database.setTrackedFileMissing(file.id, true)
    this.onEvent({ type, projectId: project.id, fileId: file?.id, relativePath: toPosixPath(relative(project.path, fullPath)), isDirectory })
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
    this.suppressedWrites.delete(fullPath)
    return until > Date.now()
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

function isIncludedByScope(relativePath: string, project: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns'>): boolean {
  const normalized = toPosixPath(relativePath)
  const included = project.scopeMode === 'all' || normalizeScopePaths(project.includePaths).some(
    (path) => normalized === path || normalized.startsWith(`${path}/`)
  )
  if (!included) return false
  return !normalizePatterns(project.excludePatterns).some((pattern) => matchesGlob(normalized, pattern))
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
  project: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns'>
): ProjectIndexFileRecord[] {
  return files.filter((file) => isIncludedByScope(file.relativePath, project))
}

function directChildren(files: ProjectIndexFileRecord[], parentPath: string): WorkspaceTreeNode[] {
  const normalizedParent = toPosixPath(parentPath).replace(/^\/|\/$/g, '')
  const prefix = normalizedParent ? `${normalizedParent}/` : ''
  const directories = new Map<string, WorkspaceTreeNode>()
  const entries: WorkspaceTreeNode[] = []
  for (const file of files) {
    if (!file.relativePath.startsWith(prefix)) continue
    const remaining = file.relativePath.slice(prefix.length)
    if (!remaining) continue
    const slash = remaining.indexOf('/')
    if (slash === -1) {
      entries.push({ id: file.relativePath, name: file.name, path: file.relativePath, kind: 'file' })
      continue
    }
    const name = remaining.slice(0, slash)
    const path = prefix ? `${normalizedParent}/${name}` : name
    const existing = directories.get(path)
    if (existing) {
      existing.descendantCount = (existing.descendantCount ?? 0) + 1
    } else {
      const node: WorkspaceTreeNode = { id: path, name, path, kind: 'directory', descendantCount: 1 }
      directories.set(path, node)
      entries.push(node)
    }
  }
  return entries.sort(compareTreeNodes)
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
      descendantCount: 1
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
