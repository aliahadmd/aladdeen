import { describe, expect, it } from 'vitest'
import type { TrackedFileSummary } from '@shared/contracts'
import { markdownDisplayName, trackedFileDisplayLocation } from '@renderer/lib/display'

function trackedFile(overrides: Partial<TrackedFileSummary> = {}): TrackedFileSummary {
  return {
    id: 'a4fb31e9-94e4-49c9-b565-946a7a8475db',
    environmentId: '6e0b9178-d10c-46c9-a3cb-e75d8e67c64a',
    name: 'readme.md',
    location: 'Notes › guides/readme.md',
    fullPath: '/Users/example/Notes/guides/readme.md',
    relativePath: 'guides/readme.md',
    projectId: '04832f7e-e23c-4722-8b4a-945bf8c5a405',
    lastOpenedAt: 1,
    missing: false,
    ...overrides
  }
}

describe('sidebar display helpers', () => {
  it('removes Markdown extensions without changing other suffixes', () => {
    expect(markdownDisplayName('readme.md')).toBe('readme')
    expect(markdownDisplayName('notes.markdown')).toBe('notes')
    expect(markdownDisplayName('archive.md.txt')).toBe('archive.md.txt')
  })

  it('shows a project file parent without repeating the filename', () => {
    expect(trackedFileDisplayLocation(trackedFile())).toBe('Notes › guides')
    expect(trackedFileDisplayLocation(trackedFile({
      location: 'Notes › readme.md',
      relativePath: 'readme.md'
    }))).toBe('Notes')
  })

  it('preserves standalone parent locations', () => {
    expect(trackedFileDisplayLocation(trackedFile({
      projectId: undefined,
      relativePath: undefined,
      location: '~/Desktop'
    }))).toBe('~/Desktop')
  })
})
