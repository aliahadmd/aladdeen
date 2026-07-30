import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DesktopError } from '@main/errors'
import type {
  AppSettings,
  AgentModel,
  AgentProviderId,
  AgentProviderProfile,
  DocumentKind,
  EnvironmentSummary,
  WorkspaceTreeNode
} from '@shared/contracts'
import {
  ALL_PROJECT_DOCUMENT_KINDS,
  DEFAULT_PROJECT_DOCUMENT_KINDS,
  documentKindFromName,
  isDocumentKind
} from '@shared/documents'
import {
  DEFAULT_READING_SETTINGS,
  READING_COLUMN_WIDTHS,
  READING_FONTS,
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN,
  READING_LINE_HEIGHTS,
  READING_SURFACES
} from '@shared/reading'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false,
  completedOnboardingVersion: 0,
  agentEnabled: false,
  agentProvider: 'anthropic',
  agentModelId: 'claude-sonnet-4-5',
  agentThinkingLevel: 'medium',
  agentPanelWidth: 380,
  agentPanelCollapsed: false,
  ...DEFAULT_READING_SETTINGS
}

const DATABASE_FILENAME = 'aladdeen.sqlite'
const PREVIOUS_DATABASE_FILENAME = ['fl', 'uid', 'md.sqlite'].join('')
// Version 7 was briefly used by the removed Research Notes feature. Keep that
// migration number reserved and migrate its metadata away instead of treating a
// user's existing profile as a database from an unknown future release.
const CURRENT_DATABASE_VERSION = 12

interface AgentModelCacheEnvelope {
  version: 1
  models: AgentModel[]
  runtimeEntry?: unknown
}

function agentModelsFromRuntimeEntry(providerId: AgentProviderId, entry: unknown): AgentModel[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const models = (entry as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const seen = new Set<string>()
  return models.flatMap((value): AgentModel[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const model = value as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id : ''
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [{
      provider: providerId,
      id,
      name: typeof model.name === 'string' && model.name ? model.name : id,
      supportsThinking: model.reasoning === true,
      ...(typeof model.api === 'string' ? { protocol: model.api as AgentModel['protocol'] } : {}),
      ...(Array.isArray(model.input) ? { supportsVision: model.input.includes('image') } : {}),
      ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
      ...(typeof model.maxTokens === 'number' ? { maxOutputTokens: model.maxTokens } : {}),
      source: 'pi'
    }]
  })
}

function parseAgentModelCache(providerId: AgentProviderId, value: string): AgentModelCacheEnvelope {
  const parsed = JSON.parse(value) as unknown
  if (Array.isArray(parsed)) {
    return { version: 1, models: parsed as AgentModel[] }
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as { version?: unknown }).version === 1 &&
    Array.isArray((parsed as { models?: unknown }).models)
  ) return parsed as AgentModelCacheEnvelope
  return {
    version: 1,
    models: agentModelsFromRuntimeEntry(providerId, parsed),
    runtimeEntry: parsed
  }
}

function restorePreviousDatabase(destination: string, userDataPath: string, previousUserDataPath?: string): void {
  if (existsSync(destination)) return
  const candidates = [
    join(userDataPath, PREVIOUS_DATABASE_FILENAME),
    previousUserDataPath ? join(previousUserDataPath, PREVIOUS_DATABASE_FILENAME) : undefined
  ]
  for (const candidate of candidates) {
    if (!candidate || candidate === destination || !existsSync(candidate)) continue
    copyFileSync(candidate, destination)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${candidate}${suffix}`)) copyFileSync(`${candidate}${suffix}`, `${destination}${suffix}`)
    }
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
  enabledDocumentKinds: DocumentKind[]
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
  documentKind: DocumentKind
}

type ProjectUpdateOptions = Pick<
  ProjectRecord,
  'scopeMode' | 'includePaths' | 'excludePatterns' | 'enabledDocumentKinds' | 'groupName' | 'pinned' | 'archived'
>

export interface TrackedFileRecord {
  id: string
  environmentId: string
  projectId?: string
  path: string
  lastOpenedAt: number
  missing: boolean
  documentKind: DocumentKind
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
    try {
      this.assertSupportedVersion()
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
      this.migrate()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private assertSupportedVersion(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version > CURRENT_DATABASE_VERSION) {
      throw new DesktopError(
        'INVALID_FILE',
        `This Aladdeen database was created by a newer application version (schema ${row.user_version}).`
      )
    }
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
      `)
      try {
        this.importLegacyWorkspaceHistory()
        this.db.exec(`
          DROP TABLE IF EXISTS workspace_state;
          DROP TABLE IF EXISTS recent_workspaces;
          PRAGMA user_version = 2;
          COMMIT;
        `)
      } catch (error) {
        this.db.exec('ROLLBACK;')
        throw error
      }
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

    if (row.user_version < 4) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE project_index_directories (
          project_id TEXT NOT NULL REFERENCES environment_projects(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          parent_path TEXT NOT NULL,
          name TEXT NOT NULL,
          descendant_count INTEGER NOT NULL,
          PRIMARY KEY(project_id, relative_path)
        ) STRICT;
        CREATE INDEX project_index_directory_parent
          ON project_index_directories(
            project_id,
            parent_path,
            name COLLATE NOCASE,
            relative_path COLLATE NOCASE
          );
        CREATE INDEX project_index_file_parent_page
          ON project_index_files(
            project_id,
            parent_path,
            name COLLATE NOCASE,
            relative_path COLLATE NOCASE
          );
      `)
      try {
        for (const project of this.listProjectsForDirectoryBackfill()) {
          this.insertProjectDirectories(project.id, this.listProjectIndexForDirectoryBackfill(project.id))
        }
        this.db.exec('PRAGMA user_version = 4; COMMIT;')
      } catch (error) {
        this.db.exec('ROLLBACK;')
        throw error
      }
    }

    if (row.user_version < 5) {
      this.db.exec(`
        BEGIN;
        ALTER TABLE environment_files
          ADD COLUMN document_kind TEXT NOT NULL DEFAULT 'markdown';
        ALTER TABLE project_index_files
          ADD COLUMN document_kind TEXT NOT NULL DEFAULT 'markdown';
        UPDATE environment_files
          SET document_kind = CASE
            WHEN lower(path) LIKE '%.html' OR lower(path) LIKE '%.htm' THEN 'html'
            WHEN lower(path) LIKE '%.docx' THEN 'docx'
            WHEN lower(path) LIKE '%.pdf' THEN 'pdf'
            ELSE 'markdown'
          END;
        UPDATE project_index_files
          SET document_kind = CASE
            WHEN lower(relative_path) LIKE '%.html' OR lower(relative_path) LIKE '%.htm' THEN 'html'
            WHEN lower(relative_path) LIKE '%.docx' THEN 'docx'
            WHEN lower(relative_path) LIKE '%.pdf' THEN 'pdf'
            ELSE 'markdown'
          END;
        CREATE INDEX project_index_kind
          ON project_index_files(project_id, document_kind, relative_path COLLATE NOCASE);
        PRAGMA user_version = 5;
        COMMIT;
      `)
    }

    if (row.user_version < 6) {
      this.db.exec(`
        BEGIN;
        ALTER TABLE environment_projects
          ADD COLUMN enabled_document_kinds TEXT NOT NULL
          DEFAULT '["markdown","html","docx","pdf"]';
        UPDATE environment_projects
          SET indexed_at = NULL,
              index_status = CASE WHEN archived = 1 THEN 'paused' ELSE 'indexing' END;
        PRAGMA user_version = 6;
        COMMIT;
      `)
    }

    if (row.user_version < 8) {
      this.db.exec(`
        BEGIN;
        DROP TABLE IF EXISTS research_note_links;
        DROP TABLE IF EXISTS research_notes;
        DROP TABLE IF EXISTS environment_note_locations;
        PRAGMA user_version = 8;
        COMMIT;
      `)
    }

    if (row.user_version < 9) {
      this.db.exec('BEGIN;')
      try {
        const previousCompleteSet = new Set<DocumentKind>(['markdown', 'html', 'docx', 'pdf'])
        const projects = this.db.prepare(
          'SELECT id, enabled_document_kinds FROM environment_projects'
        ).all() as Array<{ id: string; enabled_document_kinds: string }>
        const affectedProjectIds = new Set<string>((this.db.prepare(`
          SELECT DISTINCT project_id AS id
          FROM project_index_files
          WHERE lower(relative_path) LIKE '%.xlsx'
        `).all() as Array<{ id: string }>).map((project) => project.id))
        const updateKinds = this.db.prepare(`
          UPDATE environment_projects
          SET enabled_document_kinds = ?
          WHERE id = ?
        `)
        for (const project of projects) {
          const kinds = parseStringArray(project.enabled_document_kinds).filter(isDocumentKind)
          const isPreviousCompleteSet = kinds.length === previousCompleteSet.size &&
            kinds.every((kind) => previousCompleteSet.has(kind))
          if (!isPreviousCompleteSet) continue
          updateKinds.run(JSON.stringify([...kinds, 'xlsx']), project.id)
          affectedProjectIds.add(project.id)
        }
        this.db.exec(`
          UPDATE environment_files
          SET document_kind = 'xlsx'
          WHERE lower(path) LIKE '%.xlsx';
          UPDATE project_index_files
          SET document_kind = 'xlsx'
          WHERE lower(relative_path) LIKE '%.xlsx';
        `)
        const markForReindex = this.db.prepare(`
          UPDATE environment_projects
          SET indexed_at = NULL,
              index_status = CASE WHEN archived = 1 THEN 'paused' ELSE 'indexing' END
          WHERE id = ?
        `)
        for (const projectId of affectedProjectIds) markForReindex.run(projectId)
        this.db.exec('PRAGMA user_version = 9; COMMIT;')
      } catch (error) {
        this.db.exec('ROLLBACK;')
        throw error
      }
    }

    if (row.user_version < 10) {
      this.db.exec('BEGIN;')
      try {
        const previousCompleteSet = new Set<DocumentKind>(['markdown', 'html', 'docx', 'pdf', 'xlsx'])
        const projects = this.db.prepare(
          'SELECT id, enabled_document_kinds FROM environment_projects'
        ).all() as Array<{ id: string; enabled_document_kinds: string }>
        const affectedProjectIds = new Set<string>((this.db.prepare(`
          SELECT DISTINCT project_id AS id
          FROM project_index_files
          WHERE lower(relative_path) LIKE '%.pptx'
        `).all() as Array<{ id: string }>).map((project) => project.id))
        const updateKinds = this.db.prepare(`
          UPDATE environment_projects
          SET enabled_document_kinds = ?
          WHERE id = ?
        `)
        for (const project of projects) {
          const kinds = parseStringArray(project.enabled_document_kinds).filter(isDocumentKind)
          const isPreviousCompleteSet = kinds.length === previousCompleteSet.size &&
            kinds.every((kind) => previousCompleteSet.has(kind))
          if (!isPreviousCompleteSet) continue
          updateKinds.run(JSON.stringify([...kinds, 'pptx']), project.id)
          affectedProjectIds.add(project.id)
        }
        this.db.exec(`
          UPDATE environment_files
          SET document_kind = 'pptx'
          WHERE lower(path) LIKE '%.pptx';
          UPDATE project_index_files
          SET document_kind = 'pptx'
          WHERE lower(relative_path) LIKE '%.pptx';
        `)
        const markForReindex = this.db.prepare(`
          UPDATE environment_projects
          SET indexed_at = NULL,
              index_status = CASE WHEN archived = 1 THEN 'paused' ELSE 'indexing' END
          WHERE id = ?
        `)
        for (const projectId of affectedProjectIds) markForReindex.run(projectId)
        this.db.exec('PRAGMA user_version = 10; COMMIT;')
      } catch (error) {
        this.db.exec('ROLLBACK;')
        throw error
      }
    }

    if (row.user_version < 11) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS agent_secrets (
          provider TEXT PRIMARY KEY,
          ciphertext BLOB NOT NULL
        ) STRICT;
        PRAGMA user_version = 11;
        COMMIT;
      `)
    }

    if (row.user_version < 12) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS agent_provider_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL,
          base_url TEXT NOT NULL,
          endpoint_scope TEXT NOT NULL,
          auth_scheme TEXT NOT NULL,
          catalog_mode TEXT NOT NULL,
          compatibility_json TEXT NOT NULL,
          models_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS agent_model_cache (
          provider TEXT PRIMARY KEY,
          models_json TEXT NOT NULL,
          checked_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS agent_model_verifications (
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          verified_at INTEGER NOT NULL,
          PRIMARY KEY(provider, model_id)
        ) STRICT;
        PRAGMA user_version = 12;
        COMMIT;
      `)
    }

    this.repairLegacyWorkspaceHistory()
  }

  private repairLegacyWorkspaceHistory(): void {
    if (!this.tableExists('recent_workspaces') || !this.tableExists('workspace_state')) return
    this.db.exec('BEGIN')
    try {
      this.importLegacyWorkspaceHistory()
      this.db.exec('DROP TABLE IF EXISTS workspace_state; DROP TABLE IF EXISTS recent_workspaces; COMMIT;')
    } catch (error) {
      this.db.exec('ROLLBACK;')
      throw error
    }
  }

  private tableExists(name: string): boolean {
    return Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name))
  }

  private listProjectsForDirectoryBackfill(): Array<{ id: string }> {
    return this.db.prepare('SELECT id FROM environment_projects').all() as Array<{ id: string }>
  }

  private listProjectIndexForDirectoryBackfill(projectId: string): ProjectIndexFileRecord[] {
    return (this.db.prepare(`
      SELECT project_id, relative_path, parent_path, name, mtime_ms, size
      FROM project_index_files WHERE project_id = ?
    `).all(projectId) as Array<{
      project_id: string
      relative_path: string
      parent_path: string
      name: string
      mtime_ms: number
      size: number
    }>).map((file) => ({
      projectId: file.project_id,
      relativePath: file.relative_path,
      parentPath: file.parent_path,
      name: file.name,
      mtimeMs: file.mtime_ms,
      size: file.size,
      documentKind: documentKindFromName(file.name) ?? 'markdown'
    }))
  }

  private importLegacyWorkspaceHistory(): void {
    const workspaces = this.db
      .prepare('SELECT path, last_opened_at FROM recent_workspaces ORDER BY last_opened_at DESC')
      .all() as Array<{ path: string; last_opened_at: number }>
    if (workspaces.length === 0 || this.listEnvironments().length > 0) return

    const environmentId = randomUUID()
    const now = Date.now()
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
      if (row.key === 'agent_enabled' && ['true', 'false'].includes(row.value)) {
        settings.agentEnabled = row.value === 'true'
      }
      if (row.key === 'agent_provider' && /^[a-z0-9][a-z0-9._:-]{0,199}$/.test(row.value)) {
        settings.agentProvider = row.value as AppSettings['agentProvider']
      }
      if (row.key === 'agent_model_id' && row.value.length <= 200) {
        settings.agentModelId = row.value
      }
      if (
        row.key === 'agent_thinking_level' &&
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(row.value)
      ) {
        settings.agentThinkingLevel = row.value as AppSettings['agentThinkingLevel']
      }
      if (row.key === 'agent_panel_width') {
        const width = Number(row.value)
        if (Number.isInteger(width) && width >= 300 && width <= 560) settings.agentPanelWidth = width
      }
      if (row.key === 'agent_panel_collapsed' && ['true', 'false'].includes(row.value)) {
        settings.agentPanelCollapsed = row.value === 'true'
      }
      if (row.key === 'completed_onboarding_version') {
        const version = Number(row.value)
        if (Number.isInteger(version) && version >= 0 && version <= 1_000) {
          settings.completedOnboardingVersion = version
        }
      }
      if (row.key === 'reading_font' && READING_FONTS.includes(row.value as AppSettings['readingFont'])) {
        settings.readingFont = row.value as AppSettings['readingFont']
      }
      if (row.key === 'reading_font_size') {
        const size = Number(row.value)
        if (Number.isInteger(size) && size >= READING_FONT_SIZE_MIN && size <= READING_FONT_SIZE_MAX) {
          settings.readingFontSize = size
        }
      }
      if (row.key === 'reading_line_height' && READING_LINE_HEIGHTS.includes(row.value as AppSettings['readingLineHeight'])) {
        settings.readingLineHeight = row.value as AppSettings['readingLineHeight']
      }
      if (row.key === 'reading_column_width' && READING_COLUMN_WIDTHS.includes(row.value as AppSettings['readingColumnWidth'])) {
        settings.readingColumnWidth = row.value as AppSettings['readingColumnWidth']
      }
      if (row.key === 'reading_surface' && READING_SURFACES.includes(row.value as AppSettings['readingSurface'])) {
        settings.readingSurface = row.value as AppSettings['readingSurface']
      }
    }
    return settings
  }

  setSettings(settings: AppSettings): AppSettings {
    this.db.exec('BEGIN')
    try {
      this.setSetting('theme', settings.theme)
      this.setSetting('accent', settings.accent)
      this.setSetting('sidebar_width', String(settings.sidebarWidth))
      this.setSetting('sidebar_collapsed', String(settings.sidebarCollapsed))
      this.setSetting('completed_onboarding_version', String(settings.completedOnboardingVersion))
      this.setSetting('agent_enabled', String(settings.agentEnabled))
      this.setSetting('agent_provider', settings.agentProvider)
      this.setSetting('agent_model_id', settings.agentModelId)
      this.setSetting('agent_thinking_level', settings.agentThinkingLevel)
      this.setSetting('agent_panel_width', String(settings.agentPanelWidth))
      this.setSetting('agent_panel_collapsed', String(settings.agentPanelCollapsed))
      this.setSetting('reading_font', settings.readingFont)
      this.setSetting('reading_font_size', String(settings.readingFontSize))
      this.setSetting('reading_line_height', settings.readingLineHeight)
      this.setSetting('reading_column_width', settings.readingColumnWidth)
      this.setSetting('reading_surface', settings.readingSurface)
      this.db.exec('COMMIT')
      return settings
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, value, Date.now())
  }

  getAgentSecret(provider: AgentProviderId): Buffer | null {
    const row = this.db.prepare('SELECT ciphertext FROM agent_secrets WHERE provider = ?').get(provider) as
      | { ciphertext: Uint8Array }
      | undefined
    return row ? Buffer.from(row.ciphertext) : null
  }

  setAgentSecret(provider: AgentProviderId, ciphertext: Buffer): void {
    this.db.prepare(`INSERT INTO agent_secrets (provider, ciphertext) VALUES (?, ?)
      ON CONFLICT(provider) DO UPDATE SET ciphertext = excluded.ciphertext`)
      .run(provider, ciphertext)
  }

  clearAgentSecret(provider: AgentProviderId): void {
    this.db.prepare('DELETE FROM agent_secrets WHERE provider = ?').run(provider)
  }

  listAgentSecretProviderIds(): AgentProviderId[] {
    return (this.db.prepare('SELECT provider FROM agent_secrets ORDER BY provider').all() as Array<{
      provider: string
    }>).map((row) => row.provider)
  }

  listAgentProviderProfiles(): AgentProviderProfile[] {
    return (this.db.prepare(`
      SELECT id, name, protocol, base_url, endpoint_scope, auth_scheme, catalog_mode,
             compatibility_json, models_json, created_at, updated_at
      FROM agent_provider_profiles
      ORDER BY name COLLATE NOCASE, id
    `).all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      protocol: String(row.protocol) as AgentProviderProfile['protocol'],
      baseUrl: String(row.base_url),
      endpointScope: String(row.endpoint_scope) as AgentProviderProfile['endpointScope'],
      authScheme: String(row.auth_scheme) as AgentProviderProfile['authScheme'],
      catalogMode: String(row.catalog_mode) as AgentProviderProfile['catalogMode'],
      compatibility: JSON.parse(String(row.compatibility_json)) as AgentProviderProfile['compatibility'],
      models: JSON.parse(String(row.models_json)) as AgentModel[],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    }))
  }

  getAgentProviderProfile(providerId: AgentProviderId): AgentProviderProfile | undefined {
    return this.listAgentProviderProfiles().find((profile) => profile.id === providerId)
  }

  saveAgentProviderProfile(profile: AgentProviderProfile): void {
    this.db.prepare(`
      INSERT INTO agent_provider_profiles (
        id, name, protocol, base_url, endpoint_scope, auth_scheme, catalog_mode,
        compatibility_json, models_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        protocol = excluded.protocol,
        base_url = excluded.base_url,
        endpoint_scope = excluded.endpoint_scope,
        auth_scheme = excluded.auth_scheme,
        catalog_mode = excluded.catalog_mode,
        compatibility_json = excluded.compatibility_json,
        models_json = excluded.models_json,
        updated_at = excluded.updated_at
    `).run(
      profile.id,
      profile.name,
      profile.protocol,
      profile.baseUrl,
      profile.endpointScope,
      profile.authScheme,
      profile.catalogMode,
      JSON.stringify(profile.compatibility),
      JSON.stringify(profile.models),
      profile.createdAt,
      profile.updatedAt
    )
  }

  deleteAgentProviderProfile(providerId: AgentProviderId): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM agent_provider_profiles WHERE id = ?').run(providerId)
      this.db.prepare('DELETE FROM agent_model_cache WHERE provider = ?').run(providerId)
      this.db.prepare('DELETE FROM agent_model_verifications WHERE provider = ?').run(providerId)
      this.db.prepare('DELETE FROM agent_secrets WHERE provider = ?').run(providerId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getAgentModelCache(providerId: AgentProviderId): { models: AgentModel[]; checkedAt: number } | undefined {
    const row = this.db.prepare(
      'SELECT models_json, checked_at FROM agent_model_cache WHERE provider = ?'
    ).get(providerId) as { models_json: string; checked_at: number } | undefined
    if (!row) return undefined
    const envelope = parseAgentModelCache(providerId, row.models_json)
    return {
      models: envelope.models,
      checkedAt: row.checked_at
    }
  }

  setAgentModelCache(providerId: AgentProviderId, models: AgentModel[]): void {
    const existing = this.db.prepare(
      'SELECT models_json FROM agent_model_cache WHERE provider = ?'
    ).get(providerId) as { models_json: string } | undefined
    const envelope: AgentModelCacheEnvelope = {
      version: 1,
      models,
      ...(existing
        ? { runtimeEntry: parseAgentModelCache(providerId, existing.models_json).runtimeEntry }
        : {})
    }
    this.db.prepare(`
      INSERT INTO agent_model_cache (provider, models_json, checked_at) VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        models_json = excluded.models_json,
        checked_at = excluded.checked_at
    `).run(providerId, JSON.stringify(envelope), Date.now())
  }

  getAgentRuntimeModelCache(providerId: AgentProviderId): unknown {
    const row = this.db.prepare(
      'SELECT models_json FROM agent_model_cache WHERE provider = ?'
    ).get(providerId) as { models_json: string } | undefined
    return row ? parseAgentModelCache(providerId, row.models_json).runtimeEntry : undefined
  }

  setAgentRuntimeModelCache(providerId: AgentProviderId, runtimeEntry: unknown): void {
    const existing = this.getAgentModelCache(providerId)
    const models = runtimeEntry === undefined
      ? existing?.models ?? []
      : agentModelsFromRuntimeEntry(providerId, runtimeEntry)
    const envelope: AgentModelCacheEnvelope = {
      version: 1,
      models,
      ...(runtimeEntry === undefined ? {} : { runtimeEntry })
    }
    this.db.prepare(`
      INSERT INTO agent_model_cache (provider, models_json, checked_at) VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        models_json = excluded.models_json,
        checked_at = excluded.checked_at
    `).run(providerId, JSON.stringify(envelope), Date.now())
  }

  getAgentModelVerification(
    providerId: AgentProviderId,
    modelId: string
  ): { configHash: string; verifiedAt: number } | undefined {
    const row = this.db.prepare(`
      SELECT config_hash, verified_at
      FROM agent_model_verifications
      WHERE provider = ? AND model_id = ?
    `).get(providerId, modelId) as { config_hash: string; verified_at: number } | undefined
    return row ? { configHash: row.config_hash, verifiedAt: row.verified_at } : undefined
  }

  setAgentModelVerification(providerId: AgentProviderId, modelId: string, configHash: string): void {
    this.db.prepare(`
      INSERT INTO agent_model_verifications (provider, model_id, config_hash, verified_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, model_id) DO UPDATE SET
        config_hash = excluded.config_hash,
        verified_at = excluded.verified_at
    `).run(providerId, modelId, configHash, Date.now())
  }

  clearAgentModelVerifications(providerId: AgentProviderId): void {
    this.db.prepare('DELETE FROM agent_model_verifications WHERE provider = ?').run(providerId)
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
        exclude_patterns, enabled_document_kinds, group_name, pinned, archived, file_count, index_status, indexed_at
        FROM environment_projects WHERE environment_id = ?
        ORDER BY pinned DESC, COALESCE(group_name, '') COLLATE NOCASE, name COLLATE NOCASE`)
      .all(environmentId) as unknown as ProjectRow[]).map(projectFromRow)
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db
      .prepare(`SELECT id, environment_id, path, name, last_opened_at, scope_mode, include_paths,
        exclude_patterns, enabled_document_kinds, group_name, pinned, archived, file_count, index_status, indexed_at
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
      enabledDocumentKinds?: DocumentKind[]
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
        exclude_patterns, enabled_document_kinds, group_name, pinned, archived, file_count, index_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'indexing')`)
      .run(
        id,
        environmentId,
        path,
        name,
        now,
        options.scopeMode ?? 'all',
        JSON.stringify(options.includePaths ?? []),
        JSON.stringify(options.excludePatterns ?? []),
        JSON.stringify(options.enabledDocumentKinds ?? DEFAULT_PROJECT_DOCUMENT_KINDS),
        normalizeOptionalText(options.groupName),
        options.pinned ? 1 : 0
      )
    this.db.prepare('INSERT INTO project_state (project_id, expanded_paths, updated_at) VALUES (?, ?, ?)').run(id, '[]', now)
    return this.getProject(id)!
  }

  updateProject(
    id: string,
    options: ProjectUpdateOptions
  ): ProjectRecord {
    this.updateProjectRow(id, options)
    return this.getProject(id)!
  }

  updateProjectWithIndex(
    id: string,
    options: ProjectUpdateOptions,
    files: ProjectIndexFileRecord[]
  ): ProjectRecord {
    this.db.exec('BEGIN')
    try {
      this.updateProjectRow(id, options)
      this.replaceProjectIndexRows(id, files)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getProject(id)!
  }

  private updateProjectRow(id: string, options: ProjectUpdateOptions): void {
    const result = this.db
      .prepare(`UPDATE environment_projects SET scope_mode = ?, include_paths = ?, exclude_patterns = ?,
        enabled_document_kinds = ?, group_name = ?, pinned = ?, archived = ?, index_status = ?
        WHERE id = ?`)
      .run(
        options.scopeMode,
        JSON.stringify(options.includePaths),
        JSON.stringify(options.excludePatterns),
        JSON.stringify(options.enabledDocumentKinds),
        normalizeOptionalText(options.groupName),
        options.pinned ? 1 : 0,
        options.archived ? 1 : 0,
        options.archived ? 'paused' : 'indexing',
        id
      )
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That project no longer exists.')
  }

  setProjectIndexStatus(
    id: string,
    status: ProjectRecord['indexStatus'],
    fileCount?: number,
    indexedAt?: number
  ): void {
    const current = this.getProject(id)
    const count = fileCount ?? current?.fileCount ?? 0
    this.db
      .prepare('UPDATE environment_projects SET index_status = ?, file_count = ?, indexed_at = ? WHERE id = ?')
      .run(status, count, indexedAt ?? current?.indexedAt ?? null, id)
  }

  replaceProjectIndex(projectId: string, files: ProjectIndexFileRecord[]): void {
    this.db.exec('BEGIN')
    try {
      this.replaceProjectIndexRows(projectId, files)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private replaceProjectIndexRows(projectId: string, files: ProjectIndexFileRecord[]): void {
    this.db.prepare('DELETE FROM project_index_files WHERE project_id = ?').run(projectId)
    this.db.prepare('DELETE FROM project_index_directories WHERE project_id = ?').run(projectId)
    const insert = this.db.prepare(`INSERT INTO project_index_files
      (project_id, relative_path, parent_path, name, mtime_ms, size, document_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    for (const file of files) {
      insert.run(
        projectId,
        file.relativePath,
        file.parentPath,
        file.name,
        file.mtimeMs,
        file.size,
        file.documentKind
      )
    }
    this.insertProjectDirectories(projectId, files)
    this.db
      .prepare("UPDATE environment_projects SET file_count = ?, index_status = 'ready', indexed_at = ? WHERE id = ?")
      .run(files.length, Date.now(), projectId)
  }

  private insertProjectDirectories(projectId: string, files: ProjectIndexFileRecord[]): void {
    const directories = new Map<string, { parentPath: string; name: string; descendantCount: number }>()
    for (const file of files) {
      const parts = file.relativePath.split('/')
      let parentPath = ''
      for (const name of parts.slice(0, -1)) {
        const relativePath = parentPath ? `${parentPath}/${name}` : name
        const existing = directories.get(relativePath)
        if (existing) existing.descendantCount += 1
        else directories.set(relativePath, { parentPath, name, descendantCount: 1 })
        parentPath = relativePath
      }
    }
    const insert = this.db.prepare(`INSERT INTO project_index_directories
      (project_id, relative_path, parent_path, name, descendant_count) VALUES (?, ?, ?, ?, ?)`)
    for (const [relativePath, directory] of directories) {
      insert.run(projectId, relativePath, directory.parentPath, directory.name, directory.descendantCount)
    }
  }

  listProjectChildren(
    projectId: string,
    parentPath: string,
    cursor: number,
    limit: number
  ): { entries: WorkspaceTreeNode[]; total: number } {
    const directoryCount = this.db.prepare(
      'SELECT COUNT(*) AS count FROM project_index_directories WHERE project_id = ? AND parent_path = ?'
    ).get(projectId, parentPath) as { count: number }
    const fileCount = this.db.prepare(
      'SELECT COUNT(*) AS count FROM project_index_files WHERE project_id = ? AND parent_path = ?'
    ).get(projectId, parentPath) as { count: number }
    type ChildRow = {
      relative_path: string
      name: string
      kind: 'file' | 'directory'
      descendant_count: number | null
    }
    const rows: ChildRow[] = []
    let remaining = limit
    if (cursor < directoryCount.count && remaining > 0) {
      const directories = this.db.prepare(`
        SELECT relative_path, name, 'directory' AS kind, descendant_count
        FROM project_index_directories
        WHERE project_id = ? AND parent_path = ?
        ORDER BY name COLLATE NOCASE, relative_path COLLATE NOCASE
        LIMIT ? OFFSET ?
      `).all(projectId, parentPath, remaining, cursor) as ChildRow[]
      rows.push(...directories)
      remaining -= directories.length
    }
    if (remaining > 0) {
      const fileOffset = Math.max(0, cursor - directoryCount.count)
      const files = this.db.prepare(`
        SELECT relative_path, name, 'file' AS kind, NULL AS descendant_count
        FROM project_index_files
        WHERE project_id = ? AND parent_path = ?
        ORDER BY name COLLATE NOCASE, relative_path COLLATE NOCASE
        LIMIT ? OFFSET ?
      `).all(projectId, parentPath, remaining, fileOffset) as ChildRow[]
      rows.push(...files)
    }
    return {
      total: directoryCount.count + fileCount.count,
      entries: rows.map((row) => ({
        id: row.relative_path,
        path: row.relative_path,
        name: row.name,
        kind: row.kind,
        descendantCount: row.descendant_count ?? undefined,
        documentKind: row.kind === 'file' ? documentKindFromName(row.name) ?? undefined : undefined
      }))
    }
  }

  listProjectIndex(projectId: string): ProjectIndexFileRecord[] {
    return (this.db
      .prepare(`SELECT project_id, relative_path, parent_path, name, mtime_ms, size, document_kind
        FROM project_index_files WHERE project_id = ? ORDER BY relative_path COLLATE NOCASE`)
      .all(projectId) as Array<{
        project_id: string
        relative_path: string
        parent_path: string
        name: string
        mtime_ms: number
        size: number
        document_kind: string
      }>).map((row) => ({
      projectId: row.project_id,
      relativePath: row.relative_path,
      parentPath: row.parent_path,
      name: row.name,
      mtimeMs: row.mtime_ms,
      size: row.size,
      documentKind: normalizeDocumentKind(row.document_kind, row.name)
    }))
  }

  searchProjectIndex(environmentId: string, query: string, limit: number): Array<ProjectIndexFileRecord & {
    projectName: string
  }> {
    const pattern = `%${escapeLike(query)}%`
    return (this.db
      .prepare(`SELECT f.project_id, f.relative_path, f.parent_path, f.name, f.mtime_ms, f.size,
          f.document_kind,
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
        document_kind: string
        project_name: string
      }>).map((row) => ({
      projectId: row.project_id,
      relativePath: row.relative_path,
      parentPath: row.parent_path,
      name: row.name,
      mtimeMs: row.mtime_ms,
      size: row.size,
      projectName: row.project_name,
      documentKind: normalizeDocumentKind(row.document_kind, row.name)
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
      .prepare(`SELECT id, environment_id, project_id, path, last_opened_at, missing, document_kind
        FROM environment_files WHERE environment_id = ? ORDER BY last_opened_at DESC`)
      .all(environmentId) as Array<{
        id: string
        environment_id: string
        project_id: string | null
        path: string
        last_opened_at: number
        missing: number
        document_kind: string
      }>).map(
      (row) => ({
        id: row.id,
        environmentId: row.environment_id,
        projectId: row.project_id ?? undefined,
        path: row.path,
        lastOpenedAt: row.last_opened_at,
        missing: Boolean(row.missing),
        documentKind: normalizeDocumentKind(row.document_kind, row.path)
      })
    )
  }

  getTrackedFile(id: string): TrackedFileRecord | null {
    const row = this.db
      .prepare(`SELECT id, environment_id, project_id, path, last_opened_at, missing, document_kind
        FROM environment_files WHERE id = ?`)
      .get(id) as {
        id: string
        environment_id: string
        project_id: string | null
        path: string
        last_opened_at: number
        missing: number
        document_kind: string
      } | undefined
    return row
      ? {
          id: row.id,
          environmentId: row.environment_id,
          projectId: row.project_id ?? undefined,
          path: row.path,
          lastOpenedAt: row.last_opened_at,
          missing: Boolean(row.missing),
          documentKind: normalizeDocumentKind(row.document_kind, row.path)
        }
      : null
  }

  findTrackedFile(environmentId: string, path: string): TrackedFileRecord | null {
    const row = this.db
      .prepare('SELECT id FROM environment_files WHERE environment_id = ? AND path = ?')
      .get(environmentId, path) as { id: string } | undefined
    return row ? this.getTrackedFile(row.id) : null
  }

  upsertTrackedFile(
    environmentId: string,
    path: string,
    projectId?: string,
    documentKind = documentKindFromName(path) ?? 'markdown'
  ): TrackedFileRecord {
    const existing = this.findTrackedFile(environmentId, path)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare(`UPDATE environment_files
          SET project_id = ?, document_kind = ?, last_opened_at = ?, missing = 0 WHERE id = ?`)
        .run(projectId ?? null, documentKind, now, existing.id)
      return { ...existing, projectId, documentKind, lastOpenedAt: now, missing: false }
    }
    const id = randomUUID()
    this.db
      .prepare(`INSERT INTO environment_files
        (id, environment_id, project_id, path, last_opened_at, missing, document_kind)
        VALUES (?, ?, ?, ?, ?, 0, ?)`)
      .run(id, environmentId, projectId ?? null, path, now, documentKind)
    return { id, environmentId, projectId, path, lastOpenedAt: now, missing: false, documentKind }
  }

  updateTrackedFile(
    id: string,
    path: string,
    projectId?: string,
    documentKind = documentKindFromName(path) ?? 'markdown'
  ): void {
    const result = this.db
      .prepare(`UPDATE environment_files
        SET path = ?, project_id = ?, document_kind = ?, missing = 0, last_opened_at = ? WHERE id = ?`)
      .run(path, projectId ?? null, documentKind, Date.now(), id)
    if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'That file is no longer tracked.')
  }

  updateTrackedFiles(changes: Array<{
    id: string
    path: string
    projectId?: string
    documentKind?: DocumentKind
  }>): void {
    this.db.exec('BEGIN')
    try {
      const update = this.db.prepare(
        `UPDATE environment_files
          SET path = ?, project_id = ?, document_kind = ?, missing = 0, last_opened_at = ? WHERE id = ?`
      )
      const now = Date.now()
      for (const change of changes) {
        const result = update.run(
          change.path,
          change.projectId ?? null,
          change.documentKind ?? documentKindFromName(change.path) ?? 'markdown',
          now,
          change.id
        )
        if (result.changes === 0) throw new DesktopError('NOT_FOUND', 'A tracked file no longer exists.')
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
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
  enabled_document_kinds: string
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
    enabledDocumentKinds: parseDocumentKinds(row.enabled_document_kinds),
    groupName: row.group_name ?? undefined,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    fileCount: row.file_count,
    indexStatus,
    indexedAt: row.indexed_at ?? undefined
  }
}

function parseDocumentKinds(value?: string): DocumentKind[] {
  const parsed = parseStringArray(value).filter(isDocumentKind)
  return parsed.length > 0 ? [...new Set(parsed)] : [...ALL_PROJECT_DOCUMENT_KINDS]
}

function normalizeOptionalText(value?: string): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function normalizeDocumentKind(value: string, name: string): DocumentKind {
  if (isDocumentKind(value)) return value
  return documentKindFromName(name) ?? 'markdown'
}
