import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DesktopError } from '@main/errors'
import type { AppSettings, EnvironmentSummary } from '@shared/contracts'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false
}

const DATABASE_FILENAME = 'aladdeen.sqlite'
const PREVIOUS_DATABASE_FILENAME = ['fl', 'uid', 'md.sqlite'].join('')

function restorePreviousDatabase(destination: string, userDataPath: string, previousUserDataPath?: string): void {
  if (existsSync(destination)) return
  const candidates = [
    join(userDataPath, PREVIOUS_DATABASE_FILENAME),
    previousUserDataPath ? join(previousUserDataPath, PREVIOUS_DATABASE_FILENAME) : undefined
  ]
  for (const candidate of candidates) {
    if (!candidate || candidate === destination || !existsSync(candidate)) continue
    copyFileSync(candidate, destination)
    return
  }
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface ProjectRecord {
  id: string
  environmentId: string
  path: string
  name: string
  lastOpenedAt: number
  scopeMode: 'all' | 'selected'
  includePaths: string[]
  excludePatterns: string[]
  groupName?: string
  pinned: boolean
  archived: boolean
  fileCount: number
  indexStatus: 'ready' | 'indexing' | 'error' | 'paused'
  indexedAt?: number
}

export interface ProjectIndexFileRecord {
  projectId: string
  relativePath: string
  parentPath: string
  name: string
  mtimeMs: number
  size: number
}

export interface TrackedFileRecord {
  id: string
  environmentId: string
  projectId?: string
  path: string
  lastOpenedAt: number
  missing: boolean
}

export interface EnvironmentStateRecord {
  openFileIds: string[]
  activeFileId?: string
}

export class AppDatabase {
  private readonly db: DatabaseSync

  constructor(userDataPath: string, previousUserDataPath?: string) {
    const databasePath = join(userDataPath, DATABASE_FILENAME)
    mkdirSync(dirname(databasePath), { recursive: true })
    restorePreviousDatabase(databasePath, userDataPath, previousUserDataPath)
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version < 1) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS recent_workspaces (
          path TEXT PRIMARY KEY,
          last_opened_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS workspace_state (
          workspace_path TEXT PRIMARY KEY,
          selected_file TEXT,
          expanded_paths TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS window_state (
          window_id TEXT PRIMARY KEY,
          bounds TEXT NOT NULL,
          maximized INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        ) STRICT;
        PRAGMA user_version = 1;
        COMMIT;
      `)
    }

    if (row.user_version < 2) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS environments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS environment_projects (
          id TEXT PRIMARY KEY,
          environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          last_opened_at INTEGER NOT NULL,
          UNIQUE(environment_id, path)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS environment_files (
          id TEXT PRIMARY KEY,
          environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
          project_id TEXT REFERENCES environment_projects(id) ON DELETE SET NULL,
          path TEXT NOT NULL,
          last_opened_at INTEGER NOT NULL,
          missing INTEGER NOT NULL DEFAULT 0,
          UNIQUE(environment_id, path)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS environment_state (
          environment_id TEXT PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
          open_file_ids TEXT NOT NULL DEFAULT '[]',
          active_file_id TEXT,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS project_state (
          project_id TEXT PRIMARY KEY REFERENCES environment_projects(id) ON DELETE CASCADE,
          expanded_paths TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        ) STRICT;
        PRAGMA user_version = 2;
        COMMIT;
      `)
      this.importLegacyWorkspaceHistory()
      this.db.exec('DROP TABLE IF EXISTS workspace_state; DROP TABLE IF EXISTS recent_workspaces;')
    }

    if (row.user_version < 3) {
      this.db.exec(`
        BEGIN;
        ALTER TABLE environment_projects ADD COLUMN scope_mode TEXT NOT NULL DEFAULT 'all';
        ALTER TABLE environment_projects ADD COLUMN include_paths TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE environment_projects ADD COLUMN exclude_patterns TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE environment_projects ADD COLUMN group_name TEXT;
        ALTER TABLE environment_projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE environment_projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE environment_projects ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE environment_projects ADD COLUMN index_status TEXT NOT NULL DEFAULT 'indexing';
        ALTER TABLE environment_projects ADD COLUMN indexed_at INTEGER;
        CREATE TABLE project_index_files (
          project_id TEXT NOT NULL REFERENCES environment_projects(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          parent_path TEXT NOT NULL,
          name TEXT NOT NULL,
          mtime_ms REAL NOT NULL,
          size INTEGER NOT NULL,
          PRIMARY KEY(project_id, relative_path)
        ) STRICT;
        CREATE INDEX project_index_parent ON project_index_files(project_id, parent_path, name);
        CREATE INDEX project_index_name ON project_index_files(project_id, name);
        PRAGMA user_version = 3;
        COMMIT;
      `)
    }
  }

  private importLegacyWorkspaceHistory(): void {
    const workspaces = this.db
      .prepare('SELECT path, last_opened_at FROM recent_workspaces ORDER BY last_opened_at DESC')
      .all() as Array<{ path: string; last_opened_at: number }>
    if (workspaces.length === 0 || this.listEnvironments().length > 0) return

    const environmentId = randomUUID()
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('INSERT INTO environments (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        environmentId,
        'Personal',
        now,
        now
      )
      let selectedFileId: string | undefined
      for (const workspace of workspaces) {
        const projectId = randomUUID()
        this.db
          .prepare('INSERT INTO environment_projects (id, environment_id, path, name, last_opened_at) VALUES (?, ?, ?, ?, ?)')
          .run(projectId, environmentId, workspace.path, basename(workspace.path), workspace.last_opened_at)
        const state = this.db
          .prepare('SELECT selected_file, expanded_paths FROM workspace_state WHERE workspace_path = ?')
          .get(workspace.path) as { selected_file: string | null; expanded_paths: string } | undefined
        this.db
          .prepare('INSERT INTO project_state (project_id, expanded_paths, updated_at) VALUES (?, ?, ?)')
          .run(projectId, state?.expanded_paths ?? '[]', now)
        if (state?.selected_file) {
          const fileId = randomUUID()
          this.db
            .prepare('INSERT INTO environment_files (id, environment_id, project_id, path, last_opened_at, missing) VALUES (?, ?, ?, ?, ?, 0)')
            .run(fileId, environmentId, projectId, join(workspace.path, state.selected_file), workspace.last_opened_at)
          selectedFileId ??= fileId
        }
      }
      this.db
        .prepare('INSERT INTO environment_state (environment_id, open_file_ids, active_file_id, updated_at) VALUES (?, ?, ?, ?)')
        .run(environmentId, JSON.stringify(selectedFileId ? [selectedFileId] : []), selectedFileId ?? null, now)
      this.setSetting('active_environment_id', environmentId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
    const settings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      if (row.key === 'theme' && ['light', 'dark', 'system'].includes(row.value)) settings.theme = row.value as AppSettings['theme']
      if (row.key === 'accent' && ['indigo', 'blue', 'emerald', 'amber', 'rose'].includes(row.value)) settings.accent = row.value as AppSettings['accent']
      if (row.key === 'sidebar_width') {
        const width = Number(row.value)
        if (Number.isInteger(width) && width >= 248 && width <= 420) settings.sidebarWidth = width
      }
      if (row.key === 'sidebar_collapsed' && ['true', 'false'].includes(row.value)) {
        settings.sidebarCollapsed = row.value === 'true'
      }
    }
    return settings
  }

  setSettings(settings: AppSettings): AppSettings {
    this.setSetting('theme', settings.theme)
    this.setSetting('accent', settings.accent)
    this.setSetting('sidebar_width', String(settings.sidebarWidth))
    this.setSetting('sidebar_collapsed', String(settings.sidebarCollapsed))
    return settings
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, value, Date.now())
  }

  listEnvironments(): EnvironmentSummary[] {
    return this.db
      .prepare('SELECT id, name, created_at, updated_at FROM environments ORDER BY updated_at DESC, name COLLATE NOCASE')
      .all()
      .map((row) => {
        const value = row as { id: string; name: string; created_at: number; updated_at: number }
        return { id: value.id, name: value.name, createdAt: value.created_at, updatedAt: value.updated_at }
      })
  }

  getEnvironment(id: string): EnvironmentSummary | null {
    const row = this.db.prepare('SELECT id, name, created_at, updated_at FROM environments WHERE id = ?').get(id) as
      | { id: string; name: string; created_at: number; updated_at: number }
      | undefined
    return row ? { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  createEnvironment(name: string): EnvironmentSummary {
    if (this.db.prepare('SELECT 1 FROM environments WHERE name = ? COLLATE NOCASE').get(name)) {
      throw new DesktopError('ALREADY_EXISTS', 'An environment with that name already exists.')
    }
    const id = randomUUID()
    const now = Date.now()
    this.db.prepare('INSERT INTO environments (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
    this.db
      .prepare('INSERT INTO environment_state (environment_id, open_file_ids, active_file_id, updated_at) VALUES (?, ?, NULL, ?)')
      .run(id, '[]', now)
    this.setActiveEnvironmentId(id)
    return { id, name, createdAt: now, updatedAt: now }
  }

  renameEnvironment(id: string, name: string): void {
    const duplicate = this.db.prepare('SELECT id FROM environments WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, id)
    if (duplicate) throw new DesktopError('ALREADY_EXISTS', 'An environment with that name already exists.')
    const result = this.db.prepare('UPDATE environments SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That environment no longer exists.')
  }

  removeEnvironment(id: string): void {
    const result = this.db.prepare('DELETE FROM environments WHERE id = ?').run(id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That environment no longer exists.')
    if (this.getActiveEnvironmentId() === id) this.setSetting('active_environment_id', '')
  }

  getActiveEnvironmentId(): string | null {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'active_environment_id'").get() as
      | { value: string }
      | undefined
    return row?.value || null
  }

  setActiveEnvironmentId(id: string): void {
    this.setSetting('active_environment_id', id)
    this.db.prepare('UPDATE environments SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  listProjects(environmentId: string): ProjectRecord[] {
    return (this.db
      .prepare(`SELECT id, environment_id, path, name, last_opened_at, scope_mode, include_paths,
        exclude_patterns, group_name, pinned, archived, file_count, index_status, indexed_at
        FROM environment_projects WHERE environment_id = ?
        ORDER BY pinned DESC, COALESCE(group_name, '') COLLATE NOCASE, name COLLATE NOCASE`)
      .all(environmentId) as unknown as ProjectRow[]).map(projectFromRow)
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db
      .prepare(`SELECT id, environment_id, path, name, last_opened_at, scope_mode, include_paths,
        exclude_patterns, group_name, pinned, archived, file_count, index_status, indexed_at
        FROM environment_projects WHERE id = ?`)
      .get(id) as ProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  addProject(
    environmentId: string,
    path: string,
    name: string,
    options: {
      scopeMode?: ProjectRecord['scopeMode']
      includePaths?: string[]
      excludePatterns?: string[]
      groupName?: string
      pinned?: boolean
    } = {}
  ): ProjectRecord {
    const existing = this.db
      .prepare('SELECT id FROM environment_projects WHERE environment_id = ? AND path = ?')
      .get(environmentId, path)
    if (existing) throw new DesktopError('ALREADY_EXISTS', 'That folder is already a project in this environment.')
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(`INSERT INTO environment_projects (
        id, environment_id, path, name, last_opened_at, scope_mode, include_paths,
        exclude_patterns, group_name, pinned, archived, file_count, index_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'indexing')`)
      .run(
        id,
        environmentId,
        path,
        name,
        now,
        options.scopeMode ?? 'all',
        JSON.stringify(options.includePaths ?? []),
        JSON.stringify(options.excludePatterns ?? []),
        normalizeOptionalText(options.groupName),
        options.pinned ? 1 : 0
      )
    this.db.prepare('INSERT INTO project_state (project_id, expanded_paths, updated_at) VALUES (?, ?, ?)').run(id, '[]', now)
    return this.getProject(id)!
  }

  updateProject(
    id: string,
    options: Pick<ProjectRecord, 'scopeMode' | 'includePaths' | 'excludePatterns' | 'groupName' | 'pinned' | 'archived'>
  ): ProjectRecord {
    const result = this.db
      .prepare(`UPDATE environment_projects SET scope_mode = ?, include_paths = ?, exclude_patterns = ?,
        group_name = ?, pinned = ?, archived = ?, index_status = ?, indexed_at = NULL
        WHERE id = ?`)
      .run(
        options.scopeMode,
        JSON.stringify(options.includePaths),
        JSON.stringify(options.excludePatterns),
        normalizeOptionalText(options.groupName),
        options.pinned ? 1 : 0,
        options.archived ? 1 : 0,
        options.archived ? 'paused' : 'indexing',
        id
      )
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That project no longer exists.')
    return this.getProject(id)!
  }

  setProjectIndexStatus(
    id: string,
    status: ProjectRecord['indexStatus'],
    fileCount?: number,
    indexedAt?: number
  ): void {
    const count = fileCount ?? this.getProject(id)?.fileCount ?? 0
    this.db
      .prepare('UPDATE environment_projects SET index_status = ?, file_count = ?, indexed_at = ? WHERE id = ?')
      .run(status, count, indexedAt ?? null, id)
  }

  replaceProjectIndex(projectId: string, files: ProjectIndexFileRecord[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM project_index_files WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(`INSERT INTO project_index_files
        (project_id, relative_path, parent_path, name, mtime_ms, size) VALUES (?, ?, ?, ?, ?, ?)`)
      for (const file of files) {
        insert.run(projectId, file.relativePath, file.parentPath, file.name, file.mtimeMs, file.size)
      }
      this.db
        .prepare("UPDATE environment_projects SET file_count = ?, index_status = 'ready', indexed_at = ? WHERE id = ?")
        .run(files.length, Date.now(), projectId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listProjectIndex(projectId: string): ProjectIndexFileRecord[] {
    return (this.db
      .prepare(`SELECT project_id, relative_path, parent_path, name, mtime_ms, size
        FROM project_index_files WHERE project_id = ? ORDER BY relative_path COLLATE NOCASE`)
      .all(projectId) as Array<{
        project_id: string
        relative_path: string
        parent_path: string
        name: string
        mtime_ms: number
        size: number
      }>).map((row) => ({
      projectId: row.project_id,
      relativePath: row.relative_path,
      parentPath: row.parent_path,
      name: row.name,
      mtimeMs: row.mtime_ms,
      size: row.size
    }))
  }

  searchProjectIndex(environmentId: string, query: string, limit: number): Array<ProjectIndexFileRecord & {
    projectName: string
  }> {
    const pattern = `%${escapeLike(query)}%`
    return (this.db
      .prepare(`SELECT f.project_id, f.relative_path, f.parent_path, f.name, f.mtime_ms, f.size,
          p.name AS project_name
        FROM project_index_files f
        JOIN environment_projects p ON p.id = f.project_id
        WHERE p.environment_id = ? AND p.archived = 0
          AND (? = '' OR f.name LIKE ? ESCAPE '\\' OR f.relative_path LIKE ? ESCAPE '\\')
        ORDER BY p.pinned DESC, p.last_opened_at DESC, f.name COLLATE NOCASE
        LIMIT ?`)
      .all(environmentId, query, pattern, pattern, limit) as Array<{
        project_id: string
        relative_path: string
        parent_path: string
        name: string
        mtime_ms: number
        size: number
        project_name: string
      }>).map((row) => ({
      projectId: row.project_id,
      relativePath: row.relative_path,
      parentPath: row.parent_path,
      name: row.name,
      mtimeMs: row.mtime_ms,
      size: row.size,
      projectName: row.project_name
    }))
  }

  removeProject(id: string): void {
    const result = this.db.prepare('DELETE FROM environment_projects WHERE id = ?').run(id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That project no longer exists.')
  }

  getProjectExpandedPaths(projectId: string): string[] {
    const row = this.db.prepare('SELECT expanded_paths FROM project_state WHERE project_id = ?').get(projectId) as
      | { expanded_paths: string }
      | undefined
    return parseStringArray(row?.expanded_paths)
  }

  setProjectExpandedPaths(projectId: string, paths: string[]): void {
    this.db
      .prepare(`INSERT INTO project_state (project_id, expanded_paths, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET expanded_paths = excluded.expanded_paths, updated_at = excluded.updated_at`)
      .run(projectId, JSON.stringify(paths), Date.now())
  }

  listTrackedFiles(environmentId: string): TrackedFileRecord[] {
    return (this.db
      .prepare('SELECT id, environment_id, project_id, path, last_opened_at, missing FROM environment_files WHERE environment_id = ? ORDER BY last_opened_at DESC')
      .all(environmentId) as Array<{ id: string; environment_id: string; project_id: string | null; path: string; last_opened_at: number; missing: number }>).map(
      (row) => ({
        id: row.id,
        environmentId: row.environment_id,
        projectId: row.project_id ?? undefined,
        path: row.path,
        lastOpenedAt: row.last_opened_at,
        missing: Boolean(row.missing)
      })
    )
  }

  getTrackedFile(id: string): TrackedFileRecord | null {
    const row = this.db
      .prepare('SELECT id, environment_id, project_id, path, last_opened_at, missing FROM environment_files WHERE id = ?')
      .get(id) as { id: string; environment_id: string; project_id: string | null; path: string; last_opened_at: number; missing: number } | undefined
    return row
      ? { id: row.id, environmentId: row.environment_id, projectId: row.project_id ?? undefined, path: row.path, lastOpenedAt: row.last_opened_at, missing: Boolean(row.missing) }
      : null
  }

  findTrackedFile(environmentId: string, path: string): TrackedFileRecord | null {
    const row = this.db
      .prepare('SELECT id FROM environment_files WHERE environment_id = ? AND path = ?')
      .get(environmentId, path) as { id: string } | undefined
    return row ? this.getTrackedFile(row.id) : null
  }

  upsertTrackedFile(environmentId: string, path: string, projectId?: string): TrackedFileRecord {
    const existing = this.findTrackedFile(environmentId, path)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare('UPDATE environment_files SET project_id = ?, last_opened_at = ?, missing = 0 WHERE id = ?')
        .run(projectId ?? null, now, existing.id)
      return { ...existing, projectId, lastOpenedAt: now, missing: false }
    }
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO environment_files (id, environment_id, project_id, path, last_opened_at, missing) VALUES (?, ?, ?, ?, ?, 0)')
      .run(id, environmentId, projectId ?? null, path, now)
    return { id, environmentId, projectId, path, lastOpenedAt: now, missing: false }
  }

  updateTrackedFile(id: string, path: string, projectId?: string): void {
    const result = this.db
      .prepare('UPDATE environment_files SET path = ?, project_id = ?, missing = 0, last_opened_at = ? WHERE id = ?')
      .run(path, projectId ?? null, Date.now(), id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That file is no longer tracked.')
  }

  setTrackedFileMissing(id: string, missing: boolean): void {
    this.db.prepare('UPDATE environment_files SET missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
  }

  removeTrackedFile(id: string): void {
    const result = this.db.prepare('DELETE FROM environment_files WHERE id = ?').run(id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That file is no longer tracked.')
  }

  getEnvironmentState(environmentId: string): EnvironmentStateRecord {
    const row = this.db
      .prepare('SELECT open_file_ids, active_file_id FROM environment_state WHERE environment_id = ?')
      .get(environmentId) as { open_file_ids: string; active_file_id: string | null } | undefined
    return { openFileIds: parseStringArray(row?.open_file_ids), activeFileId: row?.active_file_id ?? undefined }
  }

  setEnvironmentState(environmentId: string, openFileIds: string[], activeFileId?: string): void {
    this.db
      .prepare(`INSERT INTO environment_state (environment_id, open_file_ids, active_file_id, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(environment_id) DO UPDATE SET open_file_ids = excluded.open_file_ids, active_file_id = excluded.active_file_id, updated_at = excluded.updated_at`)
      .run(environmentId, JSON.stringify(openFileIds), activeFileId ?? null, Date.now())
  }

  getWindowState(): WindowState | null {
    const row = this.db.prepare("SELECT bounds, maximized FROM window_state WHERE window_id = 'main'").get() as
      | { bounds: string; maximized: number }
      | undefined
    if (!row) return null
    try {
      return { ...(JSON.parse(row.bounds) as Omit<WindowState, 'maximized'>), maximized: Boolean(row.maximized) }
    } catch {
      return null
    }
  }

  setWindowState(state: WindowState): void {
    const { maximized, ...bounds } = state
    this.db
      .prepare(`INSERT INTO window_state (window_id, bounds, maximized, updated_at) VALUES ('main', ?, ?, ?)
        ON CONFLICT(window_id) DO UPDATE SET bounds = excluded.bounds, maximized = excluded.maximized, updated_at = excluded.updated_at`)
      .run(JSON.stringify(bounds), maximized ? 1 : 0, Date.now())
  }

  close(): void {
    this.db.close()
  }
}

function parseStringArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : []
  } catch {
    return []
  }
}

interface ProjectRow {
  id: string
  environment_id: string
  path: string
  name: string
  last_opened_at: number
  scope_mode: string
  include_paths: string
  exclude_patterns: string
  group_name: string | null
  pinned: number
  archived: number
  file_count: number
  index_status: string
  indexed_at: number | null
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  const scopeMode: ProjectRecord['scopeMode'] = row.scope_mode === 'selected' ? 'selected' : 'all'
  const indexStatus: ProjectRecord['indexStatus'] =
    row.index_status === 'ready' || row.index_status === 'error' || row.index_status === 'paused'
      ? row.index_status
      : 'indexing'
  return {
    id: row.id,
    environmentId: row.environment_id,
    path: row.path,
    name: row.name,
    lastOpenedAt: row.last_opened_at,
    scopeMode,
    includePaths: parseStringArray(row.include_paths),
    excludePatterns: parseStringArray(row.exclude_patterns),
    groupName: row.group_name ?? undefined,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    fileCount: row.file_count,
    indexStatus,
    indexedAt: row.indexed_at ?? undefined
  }
}

function normalizeOptionalText(value?: string): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
