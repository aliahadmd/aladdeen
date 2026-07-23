// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateEntryName } from '@main/services/workspace'
import { isPathInside, resolveSyntacticPath } from '@main/services/path-guard'

describe('workspace safety', () => {
  it('accepts portable entry names', () => {
    expect(validateEntryName('Project notes.md')).toBe('Project notes.md')
  })

  it('rejects separators and Windows reserved names', () => {
    expect(() => validateEntryName('../secret.md')).toThrow()
    expect(() => validateEntryName('CON.md')).toThrow(/reserved/i)
    expect(() => validateEntryName('folder/name.md')).toThrow()
  })

  it('contains resolved paths inside the root', () => {
    const root = '/tmp/fluidmd-workspace'
    expect(resolveSyntacticPath(root, 'notes/today.md')).toBe('/tmp/fluidmd-workspace/notes/today.md')
    expect(isPathInside(root, '/tmp/fluidmd-workspace/notes')).toBe(true)
    expect(() => resolveSyntacticPath(root, '../outside.md')).toThrow(/outside/i)
  })
})
