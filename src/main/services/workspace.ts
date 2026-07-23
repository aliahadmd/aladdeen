import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { access, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
import { FluidError } from '@main/errors'
import type { AppDatabase, ProjectRecord, TrackedFileRecord } from './database'
import type {
  CreateEntryRequest,
  DocumentSnapshot,
  DocumentTarget,
  EnvironmentEvent,
  EnvironmentSnapshot,
  FileRevision,
  ProjectSummary,
  RenameEntryRequest,
  RenameEntryResult,
  SaveDocumentRequest,
  TrackedFileSummary,
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

function isMarkdown(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

export function validateEntryName(input: string): string {
  const name = input.trim()
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
    throw new FluidError('INVALID_PATH', 'Use a simple file or folder name without path separators.')
  }
  const base = name.split('.')[0]?.toUpperCase()
  if (base && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
    throw new FluidError('INVALID_PATH', 'That name is reserved by Windows.')
  }
  return name
}

export class WorkspaceService {
  private environmentId: string | null = null
  private readonly projectWatchers = new Map<string, FSWatcher>()
  private standaloneWatcher: FSWatcher | null = null
  private readonly suppressedWrites = new Map<string, number>()

  constructor(
    private readonly database: AppDatabase,
    private readonly onEvent: (event: EnvironmentEvent) => void
  ) {}

  get activeEnvironmentId(): string | null {
    return this.environmentId
  }

  async activateEnvironment(environmentId: string): Promise<EnvironmentSnapshot> {
    const environment = this.database.getEnvironment(environmentId)
    if (!environment) throw new FluidError('NOT_FOUND', 'That environment no longer exists.')
    await this.stopWatchers()
    this.environmentId = environmentId
    this.database.setActiveEnvironmentId(environmentId)
    await this.refreshMissingFiles()
    await this.startWatchers()
    return this.getSnapshot()
  }

  async deactivateEnvironment(): Promise<void> {
    await this.stopWatchers()
    this.environmentId = null
  }

  async getSnapshot(): Promise<EnvironmentSnapshot> {
    const environmentId = this.requireEnvironment()
    const environment = this.database.getEnvironment(environmentId)
    if (!environment) throw new FluidError('NOT_FOUND', 'The active environment no longer exists.')
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

  async addProjectPath(folderPath: string): Promise<EnvironmentSnapshot> {
    const environmentId = this.requireEnvironment()
    const canonical = await realpath(folderPath)
    const folderStats = await stat(canonical)
    if (!folderStats.isDirectory()) throw new FluidError('INVALID_PATH', 'Choose a folder to use as a project.')
    for (const project of this.database.listProjects(environmentId)) {
      if (isPathInside(project.path, canonical) || isPathInside(canonical, project.path)) {
        throw new FluidError('ALREADY_EXISTS', `“${project.name}” already covers that folder location.`)
      }
    }
    const project = this.database.addProject(environmentId, canonical, basename(canonical))
    await this.startProjectWatcher(project)
    await this.reassociateTrackedFiles()
    return this.getSnapshot()
  }

  async createProject(parentPath: string, requestedName: string): Promise<EnvironmentSnapshot> {
    const name = validateEntryName(requestedName)
    const parent = await realpath(parentPath)
    const target = resolve(parent, name)
    if (!isPathInside(parent, target)) throw new FluidError('INVALID_PATH', 'That project name is not valid.')
    await mkdir(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new FluidError('ALREADY_EXISTS', 'A folder with that name already exists there.')
      throw error
    })
    return this.addProjectPath(target)
  }

  async removeProject(projectId: string): Promise<EnvironmentSnapshot> {
    const project = this.requireProject(projectId)
    if (project.environmentId !== this.requireEnvironment()) throw new FluidError('PERMISSION_DENIED', 'That project is not in this environment.')
    await this.projectWatchers.get(projectId)?.close()
    this.projectWatchers.delete(projectId)
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
    if (project.environmentId !== this.requireEnvironment()) throw new FluidError('PERMISSION_DENIED', 'That project is not in this environment.')
    const fullPath = await resolveExistingPath(project.path, target.relativePath)
    return this.openAbsoluteDocument(fullPath)
  }

  async openAbsoluteDocument(filePath: string): Promise<DocumentSnapshot> {
    const environmentId = this.requireEnvironment()
    const canonical = await realpath(filePath)
    const fileStats = await stat(canonical)
    if (!fileStats.isFile() || !isMarkdown(canonical)) throw new FluidError('INVALID_FILE', 'FluidMD opens .md and .markdown files.')
    const project = this.findContainingProject(canonical)
    const tracked = this.database.upsertTrackedFile(environmentId, canonical, project?.id)
    if (!project) await this.restartStandaloneWatcher()
    return this.readTracked(tracked)
  }

  async openRelativeDocument(fileId: string, target: string): Promise<DocumentSnapshot> {
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) {
      throw new FluidError('INVALID_PATH', 'That link is not a local Markdown file.')
    }
    const file = this.requireTrackedFile(fileId)
    const project = file.projectId ? this.database.getProject(file.projectId) : null
    const authorityRoot = project?.path ?? dirname(file.path)
    const candidate = resolve(dirname(file.path), target.split('#')[0] ?? '')
    if (!isPathInside(authorityRoot, candidate)) throw new FluidError('INVALID_PATH', 'That link points outside the allowed folder.')
    return this.openAbsoluteDocument(candidate)
  }

  async readDocument(fileId: string, touch = false): Promise<DocumentSnapshot> {
    const tracked = this.requireTrackedFile(fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new FluidError('PERMISSION_DENIED', 'That file is not in this environment.')
    try {
      const current = touch
        ? this.database.upsertTrackedFile(tracked.environmentId, tracked.path, tracked.projectId)
        : tracked
      return await this.readTracked(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.database.setTrackedFileMissing(fileId, true)
        throw new FluidError('NOT_FOUND', 'That file is missing. Locate it or remove it from the environment.')
      }
      throw error
    }
  }

  async saveDocument(request: SaveDocumentRequest): Promise<FileRevision> {
    const tracked = this.requireTrackedFile(request.fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new FluidError('PERMISSION_DENIED', 'That file is not in this environment.')
    const currentBuffer = await readFile(tracked.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        this.database.setTrackedFileMissing(tracked.id, true)
        throw new FluidError('NOT_FOUND', 'This file was deleted outside FluidMD. Save a copy to recover your changes.')
      }
      throw error
    })
    if (!request.force && sha256(currentBuffer) !== request.expectedRevision.sha256) {
      throw new FluidError('CONFLICT', 'This file changed outside FluidMD. Choose which version to keep.')
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
      throw new FluidError('ALREADY_EXISTS', 'A file already exists at that location.')
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
      throw new FluidError('ALREADY_EXISTS', 'An item with that name already exists.')
    } catch (error) {
      if (error instanceof FluidError) throw error
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
    if (!fileStats.isFile() || !isMarkdown(canonical)) throw new FluidError('INVALID_FILE', 'Choose a Markdown file.')
    const duplicate = this.database.findTrackedFile(this.requireEnvironment(), canonical)
    if (duplicate && duplicate.id !== fileId) throw new FluidError('ALREADY_EXISTS', 'That Markdown file is already tracked in this environment.')
    const project = this.findContainingProject(canonical)
    this.database.updateTrackedFile(fileId, canonical, project?.id)
    if (!tracked.projectId || !project) await this.restartStandaloneWatcher()
    return this.readDocument(fileId, true)
  }

  async readAsset(fileId: string, target: string): Promise<{ data: Buffer; mimeType: string }> {
    const tracked = this.requireTrackedFile(fileId)
    if (tracked.environmentId !== this.requireEnvironment()) throw new FluidError('PERMISSION_DENIED', 'That asset is not available.')
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) throw new FluidError('INVALID_PATH', 'That image path is not local.')
    const project = tracked.projectId ? this.database.getProject(tracked.projectId) : null
    const authorityRoot = project?.path ?? dirname(tracked.path)
    const candidate = resolve(dirname(tracked.path), target.split(/[?#]/)[0] ?? '')
    if (!isPathInside(authorityRoot, candidate)) throw new FluidError('INVALID_PATH', 'That image points outside the allowed folder.')
    const canonical = await realpath(candidate)
    if (!isPathInside(authorityRoot, canonical)) throw new FluidError('INVALID_PATH', 'That image symlink leaves the allowed folder.')
    const mimeType = IMAGE_MIME_TYPES[extname(canonical).toLowerCase()]
    if (!mimeType) throw new FluidError('INVALID_FILE', 'That asset type is not supported.')
    const fileStats = await stat(canonical)
    if (!fileStats.isFile() || fileStats.size > 30_000_000) throw new FluidError('INVALID_FILE', 'That image is too large or is not a file.')
    return { data: await readFile(canonical), mimeType }
  }

  async close(): Promise<void> {
    await this.stopWatchers()
  }

  private requireEnvironment(): string {
    if (!this.environmentId) throw new FluidError('NOT_FOUND', 'Create or select an environment first.')
    return this.environmentId
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.database.getProject(projectId)
    if (!project || project.environmentId !== this.requireEnvironment()) throw new FluidError('NOT_FOUND', 'That project is not available in this environment.')
    return project
  }

  private requireTrackedFile(fileId: string): TrackedFileRecord {
    const file = this.database.getTrackedFile(fileId)
    if (!file || file.environmentId !== this.requireEnvironment()) throw new FluidError('NOT_FOUND', 'That file is not available in this environment.')
    return file
  }

  private findContainingProject(fullPath: string): ProjectRecord | undefined {
    return this.database.listProjects(this.requireEnvironment()).find((project) => isPathInside(project.path, fullPath))
  }

  private async readTracked(tracked: TrackedFileRecord): Promise<DocumentSnapshot> {
    const buffer = await readFile(tracked.path)
    const fileStats = await stat(tracked.path)
    if (!fileStats.isFile() || !isMarkdown(tracked.path)) throw new FluidError('INVALID_FILE', 'FluidMD opens .md and .markdown files.')
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
    let tree: WorkspaceTreeNode[] = []
    try {
      tree = await this.buildTree(project.path, project.path, '')
    } catch {
      tree = []
    }
    return {
      id: project.id,
      environmentId: project.environmentId,
      name: project.name,
      displayPath: abbreviatePath(project.path),
      tree,
      expandedPaths: this.database.getProjectExpandedPaths(project.id)
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

  private async buildTree(rootPath: string, directoryPath: string, relativeDirectory: string): Promise<WorkspaceTreeNode[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    const nodes = await Promise.all(entries.map(async (entry): Promise<WorkspaceTreeNode | null> => {
      if (entry.isSymbolicLink()) return null
      const childRelative = relativeDirectory ? `${toPosixPath(relativeDirectory)}/${entry.name}` : entry.name
      const fullPath = resolveSyntacticPath(rootPath, childRelative)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith('.')) return null
        const children = await this.buildTree(rootPath, fullPath, childRelative)
        return { id: childRelative, name: entry.name, path: childRelative, kind: 'directory', children }
      }
      if (!entry.isFile() || !isMarkdown(entry.name)) return null
      return { id: childRelative, name: entry.name, path: childRelative, kind: 'file' }
    }))
    return nodes.filter((node): node is WorkspaceTreeNode => Boolean(node)).sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })
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
    const watcher = chokidar.watch(project.path, {
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 },
      ignored: (path) => {
        const relation = relative(project.path, path)
        return Boolean(relation && relation.split(sep).some((part) => IGNORED_DIRECTORY_NAMES.has(part) || part.startsWith('.')))
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
    if (type !== 'changed' || isDirectory) this.onEvent({ type: 'tree-changed', projectId: project.id, isDirectory: true })
  }

  private consumeSuppressed(fullPath: string): boolean {
    const until = this.suppressedWrites.get(fullPath)
    if (!until) return false
    this.suppressedWrites.delete(fullPath)
    return until > Date.now()
  }

  private async stopWatchers(): Promise<void> {
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
