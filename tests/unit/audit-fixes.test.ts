// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@main/services/database'
import { WorkspaceService } from '@main/services/workspace'
import { decodeHtmlEntities, extractTextForKind } from '@main/services/search-worker'
import { inspectXlsxBuffer } from '@main/services/zip-guard'
import { localReferenceToPath, toAssetUrl } from '@shared/path'
import {
  displayPointMapper,
  toStandardFontText
} from '@renderer/document-adapters/pdf-annotation-geometry'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function workspaceWithProject(kinds: Array<'markdown' | 'docx' | 'xlsx'> = ['markdown']) {
  const profile = await mkdtemp(join(tmpdir(), 'aladdeen-audit-profile-'))
  const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-audit-project-'))
  created.push(profile, projectPath)
  const database = new AppDatabase(profile)
  const environment = database.createEnvironment('Audit')
  const service = new WorkspaceService(database, vi.fn())
  await service.activateEnvironment(environment.id)
  return {
    database,
    service,
    projectPath,
    async addProject() {
      return (await service.addProjectPath(projectPath, {
        scopeMode: 'all',
        includePaths: [],
        excludePatterns: [],
        enabledDocumentKinds: kinds,
        pinned: false
      })).projects[0]!
    },
    async close() {
      await service.close()
      database.close()
    }
  }
}

describe('project exclude patterns', () => {
  it('excludes everything below a folder pattern that ends with a slash', async () => {
    const context = await workspaceWithProject()
    await mkdir(join(context.projectPath, 'drafts', 'deep'), { recursive: true })
    await writeFile(join(context.projectPath, 'keep.md'), '# keep\n')
    await writeFile(join(context.projectPath, 'drafts', 'secret.md'), '# secret\n')
    await writeFile(join(context.projectPath, 'drafts', 'deep', 'note.md'), '# note\n')
    const project = await context.addProject()

    await context.service.updateProject({
      projectId: project.id,
      scopeMode: 'all',
      includePaths: [],
      excludePatterns: ['drafts/'],
      enabledDocumentKinds: ['markdown'],
      pinned: false,
      archived: false
    })

    expect(context.database.listProjectIndex(project.id).map((file) => file.relativePath)).toEqual(['keep.md'])
    await context.close()
  })
})

describe('project entry guards', () => {
  it('refuses to trash a project root', async () => {
    const context = await workspaceWithProject()
    await writeFile(join(context.projectPath, 'a.md'), '# a\n')
    const project = await context.addProject()

    await expect(context.service.getProjectEntryPath(project.id, '', { allowRoot: false })).rejects.toThrow(/Remove the project/)
    await expect(context.service.getProjectEntryPath(project.id, 'a.md', { allowRoot: false })).resolves.toMatch(/a\.md$/)
    await context.close()
  })

  it('does not let a rename change the document format', async () => {
    const context = await workspaceWithProject(['markdown', 'docx'])
    await writeFile(join(context.projectPath, 'notes.md'), '# notes\n')
    const project = await context.addProject()

    await expect(context.service.renameEntry({ projectId: project.id, path: 'notes.md', newName: 'notes.docx' }))
      .rejects.toThrow(/cannot change a document’s format/)
    await context.service.renameEntry({ projectId: project.id, path: 'notes.md', newName: 'notes.markdown' })
    expect(await readFile(join(context.projectPath, 'notes.markdown'), 'utf8')).toBe('# notes\n')
    await context.close()
  })

  it('allows renames that only change letter case', async () => {
    const context = await workspaceWithProject()
    await writeFile(join(context.projectPath, 'Readme.md'), '# r\n')
    await writeFile(join(context.projectPath, 'other.md'), '# o\n')
    const project = await context.addProject()

    const result = await context.service.renameEntry({ projectId: project.id, path: 'Readme.md', newName: 'README.md' })
    expect(result.newPath).toBe('README.md')
    await expect(context.service.renameEntry({ projectId: project.id, path: 'README.md', newName: 'other.md' }))
      .rejects.toThrow(/already exists/)
    await context.close()
  })
})

describe('binary copies', () => {
  it('writes a copy without moving the tracked document to it', async () => {
    const context = await workspaceWithProject()
    const original = join(context.projectPath, 'book.xlsx')
    const opened = await context.service.createStandaloneFile(original, 'xlsx')
    const bytes = new Uint8Array(await readFile(original))
    const copyPath = join(context.projectPath, 'book copy.xlsx')

    await context.service.saveBinaryDocument({
      requestId: crypto.randomUUID(),
      fileId: opened.id,
      expectedRevision: opened.revision,
      byteLength: bytes.byteLength,
      force: true,
      copy: true
    }, bytes, copyPath)

    expect((await stat(copyPath)).size).toBe(bytes.byteLength)
    expect(context.database.getTrackedFile(opened.id)!.path).toBe(await realpath(original))
    await context.close()
  })
})

describe('incremental project index', () => {
  it('keeps directory counts and file counts in step for single-file changes', async () => {
    const context = await workspaceWithProject()
    await mkdir(join(context.projectPath, 'a'))
    await writeFile(join(context.projectPath, 'a', 'one.md'), '# 1\n')
    const project = await context.addProject()
    const record = (relativePath: string) => ({
      projectId: project.id,
      relativePath,
      parentPath: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '',
      name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
      mtimeMs: 1,
      size: 1,
      documentKind: 'markdown' as const
    })

    context.database.upsertProjectIndexFile(project.id, record('a/b/two.md'))
    context.database.upsertProjectIndexFile(project.id, record('a/b/two.md'))
    expect(context.database.getProject(project.id)!.fileCount).toBe(2)
    expect(context.database.listProjectChildren(project.id, '', 0, 10).entries)
      .toEqual([expect.objectContaining({ path: 'a', descendantCount: 2 })])

    context.database.removeProjectIndexFile(project.id, 'a/b/two.md')
    expect(context.database.getProject(project.id)!.fileCount).toBe(1)
    expect(context.database.listProjectChildren(project.id, 'a', 0, 10).entries.map((entry) => entry.path))
      .toEqual(['a/one.md'])
    await context.close()
  })
})

describe('watched project changes', () => {
  it('indexes files that appear and disappear on disk without a full rescan', async () => {
    const context = await workspaceWithProject()
    await mkdir(join(context.projectPath, 'notes'))
    await writeFile(join(context.projectPath, 'notes', 'first.md'), '# first\n')
    const project = await context.addProject()
    const indexed = () => context.database.listProjectIndex(project.id).map((file) => file.relativePath)
    // Let chokidar finish its initial scan before touching the folder.
    await new Promise((resolve) => setTimeout(resolve, 300))

    await writeFile(join(context.projectPath, 'notes', 'second.md'), '# second\n')
    await vi.waitFor(() => expect(indexed()).toEqual(['notes/first.md', 'notes/second.md']), { timeout: 5_000, interval: 50 })
    expect(context.database.getProject(project.id)!.fileCount).toBe(2)

    await rm(join(context.projectPath, 'notes', 'second.md'))
    await vi.waitFor(() => expect(indexed()).toEqual(['notes/first.md']), { timeout: 5_000, interval: 50 })
    expect(context.database.getProject(project.id)!.fileCount).toBe(1)
    await context.close()
  })
})

describe('search text extraction', () => {
  it('decodes out-of-range numeric entities instead of failing', () => {
    expect(() => extractTextForKind('<p>ok &#99999999; end</p>', 'html')).not.toThrow()
    expect(decodeHtmlEntities('a&#99999999;b&#xD800;c')).toBe('a�b�c')
  })

  it('decodes entities in one pass', () => {
    expect(decodeHtmlEntities('&amp;lt; &#38;amp; &lt;b&gt;')).toBe('&lt; &amp; <b>')
  })
})

describe('OOXML inflation budgets', () => {
  it('rejects a part whose declared size understates what it inflates to', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': new Uint8Array(20 * 1024 * 1024),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships/>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet/>')
    })
    understateCentralDirectorySize(archive, 'xl/workbook.xml', 1_000)

    expect(() => inspectXlsxBuffer(archive)).toThrow(/expands beyond the permitted size/)
  })
})

function understateCentralDirectorySize(archive: Uint8Array, name: string, declaredSize: number): void {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const encodedName = strToU8(name)
  for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    const nameLength = view.getUint16(offset + 28, true)
    const candidate = archive.subarray(offset + 46, offset + 46 + nameLength)
    if (candidate.length === encodedName.length && candidate.every((byte, index) => byte === encodedName[index])) {
      view.setUint32(offset + 24, declaredSize, true)
      return
    }
  }
  throw new Error(`Central directory entry ${name} not found.`)
}

describe('local image references', () => {
  it('decodes percent-encoded names before they reach the file system', () => {
    expect(localReferenceToPath('my%20pic.png?v=2#top')).toBe('my pic.png')
    expect(localReferenceToPath('r%C3%A9sum%C3%A9.png')).toBe('résumé.png')
    expect(localReferenceToPath('100%.png')).toBe('100%.png')
    const url = new URL(toAssetUrl('11111111-1111-4111-8111-111111111111', 'images/my%20pic.png')!)
    expect(url.searchParams.get('path')).toBe('images/my pic.png')
  })

  it('reads an image whose name contains a space', async () => {
    const context = await workspaceWithProject()
    await writeFile(join(context.projectPath, 'page.md'), '![x](my%20pic.png)\n')
    await writeFile(join(context.projectPath, 'my pic.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const project = await context.addProject()
    const opened = await context.service.openDocument({ kind: 'project', projectId: project.id, relativePath: 'page.md' })

    const asset = await context.service.readAsset(opened.id, localReferenceToPath('my%20pic.png'))
    expect(asset.mimeType).toBe('image/png')
    await context.close()
  })
})

describe('PDF annotation helpers', () => {
  it('replaces characters the standard font cannot encode', () => {
    expect(toStandardFontText('Approved ✓ café – “ok”')).toBe('Approved ? café – “ok”')
    expect(toStandardFontText('签名')).toBe('??')
  })

  it('maps displayed positions through the crop box and page rotation', () => {
    const box = { x: 10, y: 20, width: 600, height: 800 }
    expect(displayPointMapper(box, 0, 0, 0)(0, 0)).toEqual({ x: 10, y: 820 })
    expect(displayPointMapper(box, 0, 0.5, 0.5)(0, 0)).toEqual({ x: 310, y: 420 })
    // Rotated 90° clockwise, the displayed top-left is the box's lower-left corner.
    expect(displayPointMapper(box, 90, 0, 0)(0, 0)).toEqual({ x: 10, y: 20 })
    expect(displayPointMapper(box, 180, 0, 0)(0, 0)).toEqual({ x: 610, y: 20 })
    expect(displayPointMapper(box, 270, 0, 0)(0, 0)).toEqual({ x: 610, y: 820 })
  })
})
