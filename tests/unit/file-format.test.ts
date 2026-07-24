// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decodeMarkdown, encodeMarkdown, sha256 } from '@main/services/file-format'

describe('Markdown file encoding', () => {
  it('detects and preserves a UTF-8 BOM and CRLF line endings', () => {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Hello\r\n\r\nWorld\r\n')])
    const decoded = decodeMarkdown(original)

    expect(decoded).toEqual({ content: '# Hello\r\n\r\nWorld\r\n', lineEnding: 'CRLF', hasBom: true })
    expect(encodeMarkdown(decoded.content, decoded.lineEnding, decoded.hasBom)).toEqual(original)
  })

  it('normalizes editor input to the original line ending', () => {
    expect(encodeMarkdown('a\r\nb\rc\n', 'LF', false).toString()).toBe('a\nb\nc\n')
    expect(encodeMarkdown('a\nb\n', 'CRLF', false).toString()).toBe('a\r\nb\r\n')
  })

  it('rejects binary input and returns stable hashes', () => {
    expect(() => decodeMarkdown(Buffer.from([0, 1, 2]))).toThrow(/binary/i)
    expect(sha256(Buffer.from('aladdeen'))).toMatch(/^[a-f0-9]{64}$/)
    expect(sha256(Buffer.from('aladdeen'))).toBe(sha256(Buffer.from('aladdeen')))
  })
})
