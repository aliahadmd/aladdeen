// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { searchMarkdownSource } from '@main/services/search-engine'
import { findNearestLiteralMatch, matchesLiteral } from '@shared/search'

const target = {
  kind: 'project' as const,
  projectId: '11111111-1111-4111-8111-111111111111',
  relativePath: 'notes/search.md'
}

function search(
  content: string,
  query: string,
  options: Partial<{ matchCase: boolean; wholeWord: boolean; limit: number }> = {}
) {
  return searchMarkdownSource({
    key: 'search-fixture',
    target,
    name: 'search.md',
    location: 'Notes › notes/search.md',
    content
  }, {
    query,
    matchCase: options.matchCase ?? false,
    wholeWord: options.wholeWord ?? false,
    limit: options.limit ?? 50
  })
}

describe('Markdown source search', () => {
  it('finds case-insensitive literal punctuation and reports source coordinates', () => {
    const result = search('# Intro\r\n\r\nUse a+b in Markdown.\r\nA+B works too.', 'a+b')

    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({
      target,
      lineNumber: 3,
      columnStart: 5,
      columnEnd: 8,
      snippet: 'Use a+b in Markdown.',
      snippetMatchStart: 4,
      snippetMatchEnd: 7,
      fileTruncated: false
    })
    expect(result.matches[1]?.lineNumber).toBe(4)
  })

  it('supports Unicode-aware whole-word and match-case controls', () => {
    const wholeWord = search('café caféine CAFÉ _café_', 'café', { wholeWord: true })
    expect(wholeWord.matches.map((match) => match.columnStart)).toEqual([1, 14])

    const matchCase = search('Heading heading HEADING', 'Heading', { matchCase: true })
    expect(matchCase.matches).toHaveLength(1)
    expect(matchCase.matches[0]?.columnStart).toBe(1)
  })

  it('searches Markdown source that is not reader-visible', () => {
    const content = `---
draft: true
---

\`\`\`ts
const hiddenFromPreview = true
\`\`\`

[Link](private-target.md)`
    expect(search(content, 'draft: true').matches).toHaveLength(1)
    expect(search(content, 'hiddenFromPreview').matches).toHaveLength(1)
    expect(search(content, 'private-target.md').matches).toHaveLength(1)
  })

  it('caps per-file matches and marks the file as truncated', () => {
    const result = search('match '.repeat(80), 'match', { limit: 50 })
    expect(result.matches).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.matches.every((match) => match.fileTruncated)).toBe(true)
  })

  it('crops long source lines while preserving highlight offsets', () => {
    const result = search(`${'before '.repeat(40)}needle${' after'.repeat(40)}`, 'needle')
    const match = result.matches[0]!
    expect(match.snippet.length).toBeLessThanOrEqual(182)
    expect(match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)).toBe('needle')
    expect(match.snippet.startsWith('…')).toBe(true)
    expect(match.snippet.endsWith('…')).toBe(true)
  })

  it('validates stale offsets and finds the nearest current occurrence', () => {
    const original = 'first needle\nsecond needle'
    const match = search(original, 'needle').matches[1]!
    expect(matchesLiteral(original, match.sourceOffsetStart, match.sourceOffsetEnd, 'needle', false, false)).toBe(true)

    const changed = 'preface\nfirst needle\nsecond needle'
    expect(matchesLiteral(changed, match.sourceOffsetStart, match.sourceOffsetEnd, 'needle', false, false)).toBe(false)
    const nearest = findNearestLiteralMatch(changed, 'needle', false, false, match.sourceOffsetStart)
    expect(changed.slice(nearest?.from, nearest?.to)).toBe('needle')
  })
})
