// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateEntryName } from '@main/services/workspace'
import { isPathInside, resolveExistingPath, resolveSyntacticPath } from '@main/services/path-guard'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('workspace safety', () => {
  it('accepts portable entry names', () => {
    expect(validateEntryName('Project notes.md')).toBe('Project notes.md')
  })

  it('rejects path separators and unsafe characters', () => {
    expect(() => validateEntryName('../secret.md')).toThrow()
    expect(() => validateEntryName('folder/name.md')).toThrow()
    expect(() => validateEntryName('bad:name.md')).toThrow()
  })

  it('contains resolved paths inside the root', () => {
    const root = '/tmp/aladdeen-workspace'
    expect(resolveSyntacticPath(root, 'notes/today.md')).toBe('/tmp/aladdeen-workspace/notes/today.md')
    expect(isPathInside(root, '/tmp/aladdeen-workspace/notes')).toBe(true)
    expect(() => resolveSyntacticPath(root, '../outside.md')).toThrow(/outside/i)
  })

  it('rejects symlinked files even when their target stays inside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aladdeen-path-'))
    created.push(root)
    await mkdir(join(root, 'notes'))
    await writeFile(join(root, 'notes', 'target.md'), '# Target\n')
    await symlink(join(root, 'notes', 'target.md'), join(root, 'linked.md'))
    await expect(resolveExistingPath(root, 'linked.md')).rejects.toThrow(/symbolic/i)
  })
})
