// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '@main/services/database'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('application metadata database', () => {
  it('migrates a new database and persists environments, projects, files, and tab state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-'))
    created.push(directory)
    const database = new AppDatabase(directory)
    const migrated = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    expect(
      (migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    ).toBe(8)
    migrated.close()

    expect(database.getSettings()).toEqual({
      theme: 'system',
      accent: 'indigo',
      sidebarWidth: 320,
      sidebarCollapsed: false,
      completedOnboardingVersion: 0,
      ...DEFAULT_READING_SETTINGS
    })
    database.setSettings({
      theme: 'dark',
      accent: 'rose',
      sidebarWidth: 368,
      sidebarCollapsed: true,
      completedOnboardingVersion: 1,
      readingFont: 'iowan',
      readingFontSize: 19,
      readingLineHeight: 'relaxed',
      readingColumnWidth: 'narrow',
      readingSurface: 'paper'
    })
    const environment = database.createEnvironment('Personal')
    const project = database.addProject(environment.id, '/notes', 'notes')
    expect(project.enabledDocumentKinds).toEqual(['markdown'])
    database.replaceProjectIndex(project.id, [{
      projectId: project.id,
      relativePath: 'hello.md',
      parentPath: '',
      name: 'hello.md',
      documentKind: 'markdown',
      mtimeMs: 100,
      size: 12
    }, {
      projectId: project.id,
      relativePath: 'guides/start.md',
      parentPath: 'guides',
      name: 'start.md',
      documentKind: 'markdown',
      mtimeMs: 101,
      size: 14
    }])
    database.updateProject(project.id, {
      scopeMode: 'selected',
      includePaths: ['hello.md'],
      excludePatterns: ['archive/**'],
      enabledDocumentKinds: ['markdown', 'html'],
      groupName: 'Writing',
      pinned: true,
      archived: false
    })
    const file = database.upsertTrackedFile(environment.id, '/notes/hello.md', project.id)
    database.setProjectExpandedPaths(project.id, ['guides'])
    database.setEnvironmentState(environment.id, [file.id], file.id)

    expect(database.getSettings()).toEqual({
      theme: 'dark',
      accent: 'rose',
      sidebarWidth: 368,
      sidebarCollapsed: true,
      completedOnboardingVersion: 1,
      readingFont: 'iowan',
      readingFontSize: 19,
      readingLineHeight: 'relaxed',
      readingColumnWidth: 'narrow',
      readingSurface: 'paper'
    })
    expect(database.listEnvironments()).toHaveLength(1)
    expect(database.getActiveEnvironmentId()).toBe(environment.id)
    expect(database.listProjects(environment.id)[0]).toMatchObject({
      path: '/notes',
      scopeMode: 'selected',
      includePaths: ['hello.md'],
      enabledDocumentKinds: ['markdown', 'html'],
      groupName: 'Writing',
      pinned: true
    })
    expect(database.listProjectIndex(project.id).map((entry) => entry.relativePath)).toEqual(['guides/start.md', 'hello.md'])
    expect(database.listProjectChildren(project.id, '', 0, 1)).toEqual({
      total: 2,
      entries: [{
        id: 'guides',
        path: 'guides',
        name: 'guides',
        kind: 'directory',
        descendantCount: 1
      }]
    })
    expect(database.listProjectChildren(project.id, 'guides', 0, 10).entries[0]).toMatchObject({
      path: 'guides/start.md',
      kind: 'file'
    })
    const lastValidIndexTime = database.getProject(project.id)?.indexedAt
    database.setProjectIndexStatus(project.id, 'indexing')
    database.setProjectIndexStatus(project.id, 'error')
    expect(database.getProject(project.id)).toMatchObject({
      indexStatus: 'error',
      indexedAt: lastValidIndexTime
    })
    expect(database.listProjectIndex(project.id)).toHaveLength(2)
    expect(database.searchProjectIndex(environment.id, 'hello', 10)[0]?.projectName).toBe('notes')
    expect(database.listTrackedFiles(environment.id)[0]?.id).toBe(file.id)
    expect(database.getProjectExpandedPaths(project.id)).toEqual(['guides'])
    expect(database.getEnvironmentState(environment.id)).toEqual({ openFileIds: [file.id], activeFileId: file.id })
    database.close()
  })

  it('falls back safely when persisted reading preferences are invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-reading-'))
    created.push(directory)
    const database = new AppDatabase(directory)
    database.close()

    const raw = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    const insert = raw.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    insert.run('reading_font', 'downloaded-font', Date.now())
    insert.run('reading_font_size', '80', Date.now())
    insert.run('reading_line_height', 'extra-relaxed', Date.now())
    insert.run('reading_column_width', 'unlimited', Date.now())
    insert.run('reading_surface', 'custom', Date.now())
    raw.close()

    const reopened = new AppDatabase(directory)
    expect(reopened.getSettings()).toMatchObject(DEFAULT_READING_SETTINGS)
    reopened.close()
  })

  it('enforces case-insensitive unique environment names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-'))
    created.push(directory)
    const database = new AppDatabase(directory)
    database.createEnvironment('Writing')
    expect(() => database.createEnvironment('writing')).toThrow(/already exists/i)
    database.close()
  })

  it('paginates direct SQL children without loading a 50,000-file index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-large-'))
    created.push(directory)
    const database = new AppDatabase(directory)
    const environment = database.createEnvironment('Large library')
    const project = database.addProject(environment.id, '/library', 'library')
    database.replaceProjectIndex(project.id, Array.from({ length: 50_000 }, (_, index) => {
      const folder = `section-${String(Math.floor(index / 500)).padStart(3, '0')}`
      const name = `document-${String(index).padStart(5, '0')}.md`
      return {
        projectId: project.id,
        relativePath: `${folder}/${name}`,
        parentPath: folder,
        name,
        documentKind: 'markdown',
        mtimeMs: index,
        size: 100
      }
    }))

    const roots = database.listProjectChildren(project.id, '', 20, 10)
    expect(roots.total).toBe(100)
    expect(roots.entries).toHaveLength(10)
    expect(roots.entries[0]).toMatchObject({
      path: 'section-020',
      kind: 'directory',
      descendantCount: 500
    })
    const files = database.listProjectChildren(project.id, 'section-020', 125, 25)
    expect(files.total).toBe(500)
    expect(files.entries).toHaveLength(25)
    expect(files.entries[0]).toMatchObject({
      path: 'section-020/document-10125.md',
      kind: 'file'
    })
    database.close()
  }, 15_000)

  it('imports legacy workspace metadata into a Personal environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-'))
    created.push(directory)
    const previousDatabaseName = ['fl', 'uid', 'md.sqlite'].join('')
    const legacy = new DatabaseSync(join(directory, previousDatabaseName))
    legacy.exec(`
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE recent_workspaces (path TEXT PRIMARY KEY, last_opened_at INTEGER NOT NULL) STRICT;
      CREATE TABLE workspace_state (workspace_path TEXT PRIMARY KEY, selected_file TEXT, expanded_paths TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE window_state (window_id TEXT PRIMARY KEY, bounds TEXT NOT NULL, maximized INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL) STRICT;
      INSERT INTO recent_workspaces VALUES ('/notes', 100);
      INSERT INTO workspace_state VALUES ('/notes', 'hello.md', '["guides"]', 100);
      PRAGMA user_version = 1;
    `)
    legacy.close()

    const database = new AppDatabase(directory)
    const environment = database.listEnvironments()[0]!
    const project = database.listProjects(environment.id)[0]!
    const file = database.listTrackedFiles(environment.id)[0]!
    expect(environment.name).toBe('Personal')
    expect(project.path).toBe('/notes')
    expect(project.enabledDocumentKinds).toEqual(['markdown', 'html', 'docx', 'pdf'])
    expect(database.getProjectExpandedPaths(project.id)).toEqual(['guides'])
    expect(file.path).toBe('/notes/hello.md')
    expect(database.getEnvironmentState(environment.id).activeFileId).toBe(file.id)
    database.close()
  })

  it('repairs legacy history left behind by an interrupted version-two migration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-repair-'))
    created.push(directory)
    const initial = new AppDatabase(directory)
    initial.close()

    const raw = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    raw.exec(`
      DELETE FROM environments;
      CREATE TABLE recent_workspaces (path TEXT PRIMARY KEY, last_opened_at INTEGER NOT NULL) STRICT;
      CREATE TABLE workspace_state (
        workspace_path TEXT PRIMARY KEY,
        selected_file TEXT,
        expanded_paths TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO recent_workspaces VALUES ('/recovered-notes', 200);
      INSERT INTO workspace_state VALUES ('/recovered-notes', 'evidence.md', '[]', 200);
    `)
    raw.close()

    const repaired = new AppDatabase(directory)
    expect(repaired.listEnvironments()[0]?.name).toBe('Personal')
    expect(repaired.listTrackedFiles(repaired.listEnvironments()[0]!.id)[0]?.path).toBe(
      '/recovered-notes/evidence.md'
    )
    repaired.close()

    const verified = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    expect(verified.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recent_workspaces'"
    ).get()).toBeUndefined()
    verified.close()
  })

  it('migrates removed Research Notes metadata without losing application data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-research-notes-'))
    created.push(directory)
    const initial = new AppDatabase(directory)
    const environment = initial.createEnvironment('Research')
    const project = initial.addProject(environment.id, '/research', 'research')
    const file = initial.upsertTrackedFile(environment.id, '/research/evidence.md', project.id)
    initial.close()

    const legacy = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    legacy.exec(`
      CREATE TABLE environment_note_locations (
        environment_id TEXT PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES environment_projects(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE research_notes (
        note_file_id TEXT PRIMARY KEY REFERENCES environment_files(id) ON DELETE CASCADE,
        environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE research_note_links (
        note_file_id TEXT NOT NULL REFERENCES research_notes(note_file_id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
        source_file_id TEXT REFERENCES environment_files(id) ON DELETE SET NULL,
        source_kind TEXT NOT NULL,
        source_revision_hash TEXT NOT NULL,
        display_label TEXT NOT NULL,
        marker_offset INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'exact',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(note_file_id, block_id)
      ) STRICT;
      INSERT INTO environment_note_locations
        VALUES ('${environment.id}', '${project.id}', '', 1, 1);
      INSERT INTO research_notes VALUES ('${file.id}', '${environment.id}', 1, 1);
      INSERT INTO research_note_links
        VALUES ('${file.id}', 'block-1', '${file.id}', 'markdown', 'revision', 'Evidence', 0, 'exact', 1, 1);
      PRAGMA user_version = 7;
    `)
    legacy.close()

    const migrated = new AppDatabase(directory)
    expect(migrated.listEnvironments()).toEqual([expect.objectContaining({ id: environment.id })])
    expect(migrated.listProjects(environment.id)).toEqual([expect.objectContaining({ id: project.id })])
    expect(migrated.listTrackedFiles(environment.id)).toEqual([expect.objectContaining({ id: file.id })])
    migrated.close()

    const verified = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    expect(
      (verified.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    ).toBe(8)
    for (const table of ['environment_note_locations', 'research_notes', 'research_note_links']) {
      expect(verified.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table)).toBeUndefined()
    }
    verified.close()
  })

  it('refuses a database created by a newer schema without downgrading it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-future-'))
    created.push(directory)
    const raw = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    raw.exec('PRAGMA user_version = 99;')
    raw.close()

    expect(() => new AppDatabase(directory)).toThrow(/newer application version/i)
    const verified = new DatabaseSync(join(directory, 'aladdeen.sqlite'))
    expect((verified.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(99)
    verified.close()
  })
})
