import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Worker } from 'node:worker_threads'
import createSearchWorker from './search-worker?nodeWorker'
import type { AppDatabase, ProjectRecord, TrackedFileRecord } from './database'
import type { WorkspaceService } from './workspace'
import { DesktopError } from '@main/errors'
import { IPC, type GlobalSearchEvent, type GlobalSearchRequest } from '@shared/contracts'
import { isPathInside } from './path-guard'
import {
  type SearchWorkerCandidate,
  type SearchWorkerEvent,
  type SearchWorkerRequest
} from './search-worker-protocol'

interface ActiveSearchSession {
  id: string
  worker: Worker | null
}

export class GlobalSearchService {
  private active: ActiveSearchSession | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly workspace: WorkspaceService,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  start(request: GlobalSearchRequest): { sessionId: string } {
    const environmentId = this.workspace.activeEnvironmentId
    if (!environmentId) throw new DesktopError('NOT_FOUND', 'Create or select an environment before searching.')
    this.cancelActive()

    const sessionId = randomUUID()
    const candidates = this.buildCandidates(environmentId, request)
    this.active = { id: sessionId, worker: null }

    setImmediate(() => {
      if (this.active?.id !== sessionId) return
      this.launch({
        sessionId,
        query: request.query,
        matchCase: request.matchCase,
        wholeWord: request.wholeWord,
        candidates
      })
    })
    return { sessionId }
  }

  cancel(sessionId: string): void {
    if (this.active?.id === sessionId) this.cancelActive()
  }

  cancelActive(emit = true): void {
    const session = this.active
    if (!session) return
    this.active = null
    void session.worker?.terminate()
    if (emit) this.emit({ type: 'cancelled', sessionId: session.id })
  }

  close(): void {
    this.cancelActive(false)
  }

  private buildCandidates(environmentId: string, request: GlobalSearchRequest): SearchWorkerCandidate[] {
    const allProjects = this.database.listProjects(environmentId)
    const activeProjects = allProjects
      .filter((project) => !project.archived)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name))
    let projects: ProjectRecord[]
    if (request.scope.kind === 'project') {
      const projectId = request.scope.projectId
      const project = activeProjects.find((candidate) => candidate.id === projectId)
      if (!project) throw new DesktopError('PERMISSION_DENIED', 'That project is not searchable in this environment.')
      projects = [project]
    } else {
      projects = request.scope.kind === 'standalone' ? [] : activeProjects
    }

    const trackedFiles = this.database.listTrackedFiles(environmentId)
    const trackedById = new Map(trackedFiles.map((file) => [file.id, file]))
    const overrideByPath = new Map<string, string>()
    for (const override of request.bufferOverrides) {
      const tracked = trackedById.get(override.fileId)
      if (!tracked) throw new DesktopError('PERMISSION_DENIED', 'An open search buffer is not in this environment.')
      if (!tracked.missing) overrideByPath.set(tracked.path, override.content)
    }

    const candidates: SearchWorkerCandidate[] = []
    const includedPaths = new Set<string>()
    for (const project of projects) {
      for (const file of this.database.listProjectIndex(project.id)) {
        const path = resolve(project.path, file.relativePath)
        if (includedPaths.has(path)) continue
        includedPaths.add(path)
        candidates.push({
          key: `project:${project.id}:${file.relativePath}`,
          target: { kind: 'project', projectId: project.id, relativePath: file.relativePath },
          name: file.name,
          location: `${project.name} › ${file.relativePath}`,
          path,
          authorityRoot: project.path,
          standalone: false,
          documentKind: file.documentKind,
          contentOverride: overrideByPath.get(path)
        })
      }
    }

    if (request.scope.kind !== 'project') {
      const standalone = trackedFiles
        .filter((file) => !file.projectId && !file.missing)
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      for (const file of standalone) {
        if (includedPaths.has(file.path)) continue
        includedPaths.add(file.path)
        candidates.push(this.standaloneCandidate(file, overrideByPath.get(file.path)))
      }
    }
    return candidates
  }

  private standaloneCandidate(file: TrackedFileRecord, contentOverride?: string): SearchWorkerCandidate {
    return {
      key: `tracked:${file.id}`,
      target: { kind: 'tracked', fileId: file.id },
      name: file.path.split(/[\\/]/).at(-1) ?? 'Document',
      location: abbreviatePath(dirname(file.path)),
      path: file.path,
      authorityRoot: file.path,
      standalone: true,
      documentKind: file.documentKind,
      contentOverride
    }
  }

  private launch(request: SearchWorkerRequest): void {
    const session = this.active
    if (!session || session.id !== request.sessionId) return
    const worker = createSearchWorker({ name: `aladdeen-search-${request.sessionId}` })
    session.worker = worker
    worker.on('message', (event: SearchWorkerEvent) => {
      if (this.active?.id !== request.sessionId || event.sessionId !== request.sessionId) return
      if (event.type === 'error') {
        this.emit({
          type: 'error',
          sessionId: event.sessionId,
          error: { code: 'SEARCH_FAILED', message: 'Could not search this environment.', details: event.message }
        })
        this.finish(request.sessionId)
        return
      }
      this.emit(event)
      if (event.type === 'complete') this.finish(request.sessionId)
    })
    worker.once('error', (error) => {
      if (this.active?.id !== request.sessionId) return
      this.emit({
        type: 'error',
        sessionId: request.sessionId,
        error: { code: 'SEARCH_FAILED', message: 'The background search worker stopped.', details: error.message }
      })
      this.finish(request.sessionId)
    })
    worker.postMessage(request)
  }

  private finish(sessionId: string): void {
    if (this.active?.id !== sessionId) return
    const worker = this.active.worker
    this.active = null
    void worker?.terminate()
  }

  private emit(event: GlobalSearchEvent): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.globalSearchEvent, event)
  }
}

function abbreviatePath(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  return isPathInside(home, path) ? `~${path.slice(home.length)}` : path
}
