// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  extractDocxText,
  extractTextForKind,
  mapExtractedSourceRange
} from '@main/services/search-worker'

describe('search worker text extraction', () => {
  it('maps decoded HTML entities back to their complete source ranges', () => {
    const source = '<p>A &amp; B &#x1f680;</p>'
    const extracted = extractTextForKind(source, 'html')
    expect(extracted.content).toContain('A & B 🚀')

    const ampersand = extracted.content.indexOf('&')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      ampersand,
      ampersand + 1
    )).toEqual({
      start: source.indexOf('&amp;'),
      end: source.indexOf('&amp;') + '&amp;'.length
    })

    const rocket = extracted.content.indexOf('🚀')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      rocket,
      rocket + '🚀'.length
    )).toEqual({
      start: source.indexOf('&#x1f680;'),
      end: source.indexOf('&#x1f680;') + '&#x1f680;'.length
    })
  })

  it('keeps ordinary visible HTML text on linear source offsets', () => {
    const source = '<div>ordinary text</div>'
    const extracted = extractTextForKind(source, 'html')
    const start = extracted.content.indexOf('text')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      start,
      start + 4
    )).toEqual({ start: source.indexOf('text'), end: source.indexOf('text') + 4 })
  })

  it('streams the searchable DOCX part through the bounded extractor', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Bounded Word search</w:t></w:r></w:p></w:body></w:document>'
      )
    })
    expect(extractDocxText(Buffer.from(archive))?.content).toContain('Bounded Word search')
  })
})
