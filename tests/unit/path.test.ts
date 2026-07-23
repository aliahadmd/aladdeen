import { describe, expect, it } from 'vitest'
import { basenamePosix, dirnamePosix, resolveRelativePath, toAssetUrl, toPosixPath } from '@shared/path'

describe('shared path helpers', () => {
  it('normalizes platform separators', () => {
    expect(toPosixPath('notes\\daily\\today.md')).toBe('notes/daily/today.md')
    expect(dirnamePosix('notes/daily/today.md')).toBe('notes/daily')
    expect(basenamePosix('notes/daily/today.md')).toBe('today.md')
  })

  it('resolves document-relative links without leaving the workspace', () => {
    expect(resolveRelativePath('guides/start.md', '../images/cover.png')).toBe('images/cover.png')
    expect(resolveRelativePath('start.md', '../secret.png')).toBeNull()
    expect(resolveRelativePath('start.md', 'https://example.com/image.png')).toBeNull()
  })

  it('creates an encoded local asset URL', () => {
    expect(toAssetUrl('11111111-1111-4111-8111-111111111111', '../images/hello world.png')).toBe(
      'fluidmd-asset://document/11111111-1111-4111-8111-111111111111?path=..%2Fimages%2Fhello%20world.png'
    )
  })
})
