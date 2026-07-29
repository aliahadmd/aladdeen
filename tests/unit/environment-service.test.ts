// @vitest-environment node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@main/services/database'
import { WorkspaceService } from '@main/services/workspace'
import { loadWorkbook } from '@office-kit/xlsx/io'
import { fromBuffer } from '@office-kit/xlsx/node'
import { PptxHandler } from 'pptx-viewer-core'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('environment service', () => {
  it('updates the project index immediately after rename and Save As', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-index-consistency-'))
    created.push(profile, projectPath)
    await writeFile(join(projectPath, 'draft.md'), '# Draft\n', 'utf8')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const project = (await service.addProjectPath(projectPath)).projects[0]!
    const opened = await service.openDocument({
      kind: 'project',
      projectId: project.id,
      relativePath: 'draft.md'
    })

    await service.renameEntry({ projectId: project.id, path: 'draft.md', newName: 'renamed.md' })
    expect(database.listProjectIndex(project.id).map((file) => file.relativePath)).toEqual(['renamed.md'])

    if (opened.documentKind !== 'markdown') throw new Error('Expected a Markdown snapshot.')
    const tracked = database.getTrackedFile(opened.id)!
    const renamed = await service.readDocument(tracked.id)
    if (renamed.documentKind !== 'markdown') throw new Error('Expected a Markdown snapshot.')
    await service.saveTextDocumentAs({
      fileId: renamed.id,
      content: '# Saved copy\n',
      expectedRevision: renamed.revision
    }, join(projectPath, 'saved-copy.md'))
    expect(database.listProjectIndex(project.id).map((file) => file.relativePath)).toEqual([
      'renamed.md',
      'saved-copy.md'
    ])

    await service.close()
    database.close()
  })

  it('opens HTML, DOCX, PDF, XLSX, and PPTX in place with format-specific sessions', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const documentsPath = await mkdtemp(join(tmpdir(), 'aladdeen-formats-'))
    created.push(profile, documentsPath)
    await writeFile(join(documentsPath, 'page.html'), '<!doctype html><h1>Local page</h1>', 'utf8')
    await writeFile(join(documentsPath, 'proof.pdf'), '%PDF-1.4\n%%EOF\n', 'latin1')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const html = await service.openAbsoluteDocument(join(documentsPath, 'page.html'))
    const docx = await service.createStandaloneFile(join(documentsPath, 'proposal.docx'), 'docx')
    const xlsx = await service.createStandaloneFile(join(documentsPath, 'workbook.xlsx'), 'xlsx')
    const pptx = await service.createStandaloneFile(join(documentsPath, 'briefing.pptx'), 'pptx')
    const pdf = await service.openAbsoluteDocument(join(documentsPath, 'proof.pdf'))

    expect(html).toMatchObject({
      documentKind: 'html',
      content: '<!doctype html><h1>Local page</h1>'
    })
    expect(docx).toMatchObject({
      documentKind: 'docx',
      session: { url: expect.stringMatching(/^aladdeen-document:\/\/session\//) }
    })
    expect(pdf).toMatchObject({
      documentKind: 'pdf',
      session: { url: expect.stringMatching(/^aladdeen-document:\/\/session\//) }
    })
    expect(xlsx).toMatchObject({
      documentKind: 'xlsx',
      session: { url: expect.stringMatching(/^aladdeen-document:\/\/session\//) }
    })
    expect(pptx).toMatchObject({
      documentKind: 'pptx',
      session: { url: expect.stringMatching(/^aladdeen-document:\/\/session\//) }
    })
    expect((await service.getSnapshot()).files.map((file) => file.documentKind).sort()).toEqual([
      'docx',
      'html',
      'pdf',
      'pptx',
      'xlsx'
    ])

    if (docx.documentKind === 'docx') {
      expect((await service.resolveBinarySession(docx.session.id)).mimeType).toContain('wordprocessingml')
    }
    if (pdf.documentKind === 'pdf') {
      expect((await service.resolveBinarySession(pdf.session.id)).mimeType).toBe('application/pdf')
    }
    if (xlsx.documentKind === 'xlsx') {
      expect((await service.resolveBinarySession(xlsx.session.id)).mimeType).toContain('spreadsheetml')
      const workbook = await loadWorkbook(fromBuffer(await readFile(join(documentsPath, 'workbook.xlsx'))))
      expect(workbook.sheets.map((sheet) => sheet.sheet.title)).toEqual(['Sheet1'])
    }
    if (pptx.documentKind === 'pptx') {
      expect((await service.resolveBinarySession(pptx.session.id)).mimeType).toContain('presentationml')
      const bytes = await readFile(join(documentsPath, 'briefing.pptx'))
      const handler = new PptxHandler()
      try {
        const presentation = await handler.load(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          { allowExternalImages: false }
        )
        expect(presentation.slides).toHaveLength(1)
      } finally {
        handler.dispose()
      }
    }
    await service.close()
    database.close()
  })

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

  it('archives and removes only project metadata without touching disk content', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-safe-removal-'))
    const documentPath = join(projectPath, 'README.md')
    created.push(profile, projectPath)
    await writeFile(documentPath, '# Keep me\n', 'utf8')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const project = (await service.addProjectPath(projectPath)).projects[0]!
    await service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: [],
      enabledDocumentKinds: ['markdown'],
      pinned: false,
      archived: true
    })
    await expect(access(documentPath)).resolves.toBeUndefined()

    const removed = await service.removeProject(project.id)
    expect(removed.projects).toEqual([])
    await expect(access(documentPath)).resolves.toBeUndefined()

    await service.close()
    database.close()
  })

  it('discovers only enabled project formats while directly opened filtered files remain tracked', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'aladdeen-profile-'))
    const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-format-policy-'))
    created.push(profile, projectPath)
    await writeFile(join(projectPath, 'README.md'), '# Notes\n', 'utf8')
    await writeFile(join(projectPath, 'page.html'), '<h1>Local page</h1>', 'utf8')
    await writeFile(join(projectPath, 'report.docx'), 'not opened by this test')
    await writeFile(join(projectPath, 'proof.pdf'), '%PDF-1.4\n%%EOF\n', 'latin1')

    const database = new AppDatabase(profile)
    const environment = database.createEnvironment('Personal')
    const service = new WorkspaceService(database, vi.fn())
    await service.activateEnvironment(environment.id)
    const initial = await service.addProjectPath(projectPath)
    const project = initial.projects[0]!

    expect(project.enabledDocumentKinds).toEqual(['markdown'])
    expect(project.fileCount).toBe(1)
    expect(service.listProjectChildren(project.id, '').entries.map((entry) => entry.name)).toEqual(['README.md'])
    expect(service.searchProjectFiles('page')).toEqual([])

    const preview = await service.inspectProjectScope(project.id)
    expect(preview.kindCounts).toEqual({ markdown: 1, html: 1, docx: 1, pdf: 1, xlsx: 0, pptx: 0 })

    const directlyOpened = await service.openAbsoluteDocument(join(projectPath, 'page.html'))
    expect((await service.getSnapshot()).files.find((file) => file.id === directlyOpened.id)).toMatchObject({
      projectId: project.id,
      documentKind: 'html'
    })
    expect(service.searchProjectFiles('page')).toEqual([])

    const withHtml = await service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: [],
      enabledDocumentKinds: ['markdown', 'html'],
      pinned: false,
      archived: false
    })
    expect(withHtml.projects[0]).toMatchObject({
      enabledDocumentKinds: ['markdown', 'html'],
      fileCount: 2
    })
    expect(service.searchProjectFiles('page')[0]?.documentKind).toBe('html')

    const markdownOnly = await service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: [],
      enabledDocumentKinds: ['markdown'],
      pinned: false,
      archived: false
    })
    expect(markdownOnly.projects[0]?.fileCount).toBe(1)
    expect(markdownOnly.files.find((file) => file.id === directlyOpened.id)).toMatchObject({
      projectId: project.id,
      documentKind: 'html'
    })
    expect(service.searchProjectFiles('page')).toEqual([])
    await expect(service.createEntry({
      projectId: project.id,
      parentPath: '',
      name: 'another.html',
      documentKind: 'html'
    })).rejects.toThrow(/Project settings/i)
    await expect(service.renameEntry({
      projectId: project.id,
      path: 'README.md',
      newName: 'README.html'
    })).rejects.toThrow(/Project settings/i)

    await rm(projectPath, { recursive: true, force: true })
    await expect(service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: [],
      enabledDocumentKinds: ['html'],
      pinned: false,
      archived: false
    })).rejects.toThrow()
    expect(database.getProject(project.id)?.enabledDocumentKinds).toEqual(['markdown'])
    expect(database.listProjectIndex(project.id).map((file) => file.name)).toEqual(['README.md'])

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
      enabledDocumentKinds: ['markdown'],
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
      enabledDocumentKinds: ['markdown'],
      groupName: 'Writing',
      pinned: true,
      archived: false
    })
    expect(expanded.projects[0]?.fileCount).toBe(3)
    await service.close()
    database.close()
  })
})
