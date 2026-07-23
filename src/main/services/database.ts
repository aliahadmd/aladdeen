import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FluidError } from '@main/errors'
import type { AppSettings, EnvironmentSummary } from '@shared/contracts'

const DEFAULT_SETTINGS: AppSettings = { theme: 'system', accent: 'indigo' }

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

  constructor(userDataPath: string) {
    const databasePath = join(userDataPath, 'fluidmd.sqlite')
    mkdirSync(dirname(databasePath), { recursive: true })
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
    }
    return settings
  }

  setSettings(settings: AppSettings): AppSettings {
    this.setSetting('theme', settings.theme)
    this.setSetting('accent', settings.accent)
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
      throw new FluidError('ALREADY_EXISTS', 'An environment with that name already exists.')
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
    if (duplicate) throw new FluidError('ALREADY_EXISTS', 'An environment with that name already exists.')
    const result = this.db.prepare('UPDATE environments SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
    if (result.changes === 0) throw new FluidError('NOT_FOUND', 'That environment no longer exists.')
  }

  removeEnvironment(id: string): void {
    const result = this.db.prepare('DELETE FROM environments WHERE id = ?').run(id)
    if (result.changes === 0) throw new FluidError('NOT_FOUND', 'That environment no longer exists.')
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
      .prepare('SELECT id, environment_id, path, name, last_opened_at FROM environment_projects WHERE environment_id = ? ORDER BY name COLLATE NOCASE')
      .all(environmentId) as Array<{ id: string; environment_id: string; path: string; name: string; last_opened_at: number }>).map(
      (row) => ({ id: row.id, environmentId: row.environment_id, path: row.path, name: row.name, lastOpenedAt: row.last_opened_at })
    )
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db
      .prepare('SELECT id, environment_id, path, name, last_opened_at FROM environment_projects WHERE id = ?')
      .get(id) as { id: string; environment_id: string; path: string; name: string; last_opened_at: number } | undefined
    return row ? { id: row.id, environmentId: row.environment_id, path: row.path, name: row.name, lastOpenedAt: row.last_opened_at } : null
  }

  addProject(environmentId: string, path: string, name: string): ProjectRecord {
    const existing = this.db
      .prepare('SELECT id FROM environment_projects WHERE environment_id = ? AND path = ?')
      .get(environmentId, path)
    if (existing) throw new FluidError('ALREADY_EXISTS', 'That folder is already a project in this environment.')
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare('INSERT INTO environment_projects (id, environment_id, path, name, last_opened_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, environmentId, path, name, now)
    this.db.prepare('INSERT INTO project_state (project_id, expanded_paths, updated_at) VALUES (?, ?, ?)').run(id, '[]', now)
    return { id, environmentId, path, name, lastOpenedAt: now }
  }

  removeProject(id: string): void {
    const result = this.db.prepare('DELETE FROM environment_projects WHERE id = ?').run(id)
    if (result.changes === 0) throw new FluidError('NOT_FOUND', 'That project no longer exists.')
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
    if (result.changes === 0) throw new FluidError('NOT_FOUND', 'That file is no longer tracked.')
  }

  setTrackedFileMissing(id: string, missing: boolean): void {
    this.db.prepare('UPDATE environment_files SET missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
  }

  removeTrackedFile(id: string): void {
    const result = this.db.prepare('DELETE FROM environment_files WHERE id = ?').run(id)
    if (result.changes === 0) throw new FluidError('NOT_FOUND', 'That file is no longer tracked.')
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
