// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@main/services/database'
import { WorkspaceService } from '@main/services/workspace'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('environment service', () => {
  it('opens project and standalone files together and keeps them tracked', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-project-'))
    const loosePath = await mkdtemp(join(tmpdir(), 'aladdeen-loose-'))
    created.push(profile, projectPath, loosePath)
    await mkdir(join(projectPath, 'guides'))
    await writeFile(join(projectPath, 'guides', 'start.md'), '# Project\n', 'utf8')
    await writeFile(join(projectPath, 'cover.png'), Buffer.from([1, 2, 3]))
    await writeFile(join(loosePath, 'loose.md'), '# Loose\n', 'utf8')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const withProject = await service.addProjectPath(projectPath)
    const project = withProject.projects[0]!

    const projectDocument = await service.openDocument({ kind: 'project', projectId: project.id, relativePath: 'guides/start.md' })
    const looseDocument = await service.openAbsoluteDocument(join(loosePath, 'loose.md'))
    service.persistEnvironmentState([projectDocument.id, looseDocument.id], looseDocument.id)
    const snapshot = await service.getSnapshot()

    expect(service.listProjectChildren(project.id, '').entries[0]?.name).toBe('guides')
    expect(snapshot.files).toHaveLength(2)
    expect(snapshot.files.find((file) => file.id === projectDocument.id)?.projectId).toBe(project.id)
    expect(snapshot.files.find((file) => file.id === looseDocument.id)?.projectId).toBeUndefined()
    expect(snapshot.openFileIds).toEqual([projectDocument.id, looseDocument.id])
    expect((await service.readAsset(projectDocument.id, '../cover.png')).mimeType).toBe('image/png')
    await expect(service.readAsset(looseDocument.id, '../outside.png')).rejects.toThrow(/outside/i)

    await rm(join(loosePath, 'loose.md'))
    const missingSnapshot = await service.activateEnvironment(environment.id)
    expect(missingSnapshot.files.find((file) => file.id === looseDocument.id)?.missing).toBe(true)
    await writeFile(join(loosePath, 'relocated.md'), '# Relocated\n', 'utf8')
    const relocated = await service.locateTrackedFile(looseDocument.id, join(loosePath, 'relocated.md'))
    expect(relocated.id).toBe(looseDocument.id)
    expect(relocated.name).toBe('relocated.md')
    await service.close()
    database.close()
  })

  it('rejects overlapping project roots', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-project-'))
    created.push(profile, projectPath)
    await mkdir(join(projectPath, 'nested'))
    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    await service.addProjectPath(projectPath)
    await expect(service.addProjectPath(join(projectPath, 'nested'))).rejects.toThrow(/already covers/i)
    await service.close()
    database.close()
  })

  it('bulk-adds a project with a selective metadata index and keeps unopened files out of recents', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-scoped-project-'))
    created.push(profile, projectPath)
    await mkdir(join(projectPath, 'docs', 'nested'), { recursive: true })
    await mkdir(join(projectPath, 'archive'))
    await writeFile(join(projectPath, 'README.md'), '# Root\n', 'utf8')
    await writeFile(join(projectPath, 'docs', 'guide.md'), '# Guide\n', 'utf8')
    await writeFile(join(projectPath, 'docs', 'nested', 'draft.md'), '# Draft\n', 'utf8')
    await writeFile(join(projectPath, 'archive', 'old.md'), '# Old\n', 'utf8')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const [preview] = await service.prepareProjectImports([projectPath])
    expect(preview?.fileCount).toBe(4)

    const snapshot = await service.commitProjectImports([{
      token: preview!.token,
      scopeMode: 'selected',
      includePaths: ['docs'],
      excludePatterns: ['**/nested/**'],
      groupName: 'Writing',
      pinned: true
    }])
    const project = snapshot.projects[0]!
    expect(project).toMatchObject({
      fileCount: 1,
      scopeMode: 'selected',
      groupName: 'Writing',
      pinned: true
    })
    expect(snapshot.files).toEqual([])
    expect(service.listProjectChildren(project.id, '').entries.map((entry) => entry.name)).toEqual(['docs'])
    expect(service.listProjectChildren(project.id, 'docs').entries.map((entry) => entry.name)).toEqual(['guide.md'])
    expect(service.searchProjectFiles('guide')[0]?.relativePath).toBe('docs/guide.md')

    const opened = await service.openDocument({ kind: 'project', projectId: project.id, relativePath: 'docs/guide.md' })
    expect((await service.getSnapshot()).files.map((file) => file.id)).toEqual([opened.id])

    const expanded = await service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: ['archive/**'],
      groupName: 'Writing',
      pinned: true,
      archived: false
    })
    expect(expanded.projects[0]?.fileCount).toBe(3)
    await service.close()
    database.close()
  })
})
