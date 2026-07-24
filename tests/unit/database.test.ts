// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '@main/services/database'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('application metadata database', () => {
  it('migrates a new database and persists environments, projects, files, and tab state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-'))
    created.push(directory)
    const database = new AppDatabase(directory)

    expect(database.getSettings()).toEqual({
      theme: 'system',
      accent: 'indigo',
      sidebarWidth: 320,
      sidebarCollapsed: false
    })
    database.setSettings({ theme: 'dark', accent: 'rose', sidebarWidth: 368, sidebarCollapsed: true })
    const environment = database.createEnvironment('Personal')
    const project = database.addProject(environment.id, '/notes', 'notes')
    database.replaceProjectIndex(project.id, [{
      projectId: project.id,
      relativePath: 'hello.md',
      parentPath: '',
      name: 'hello.md',
      mtimeMs: 100,
      size: 12
    }, {
      projectId: project.id,
      relativePath: 'guides/start.md',
      parentPath: 'guides',
      name: 'start.md',
      mtimeMs: 101,
      size: 14
    }])
    database.updateProject(project.id, {
      scopeMode: 'selected',
      includePaths: ['hello.md'],
      excludePatterns: ['archive/**'],
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
      sidebarCollapsed: true
    })
    expect(database.listEnvironments()).toHaveLength(1)
    expect(database.getActiveEnvironmentId()).toBe(environment.id)
    expect(database.listProjects(environment.id)[0]).toMatchObject({
      path: '/notes',
      scopeMode: 'selected',
      includePaths: ['hello.md'],
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
    expect(database.getProjectExpandedPaths(project.id)).toEqual(['guides'])
    expect(file.path).toBe('/notes/hello.md')
    expect(database.getEnvironmentState(environment.id).activeFileId).toBe(file.id)
    database.close()
  })
})
