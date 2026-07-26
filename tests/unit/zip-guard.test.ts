import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  inspectDocxBuffer,
  requireZipEntryWithinBudget
} from '../../src/main/services/zip-guard'

function createPackage(extraEntries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types />'),
    'word/document.xml': strToU8('<w:document />'),
    ...extraEntries
  })
}

describe('DOCX package guard', () => {
  it('accepts the required OOXML parts from an in-memory save', () => {
    const entries = inspectDocxBuffer(createPackage())
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'word/document.xml'])
    )
  })

  it('enforces a strict extraction budget before inflating a requested part', () => {
    const entries = inspectDocxBuffer(createPackage())
    expect(requireZipEntryWithinBudget(entries, 'word/document.xml', {
      maxUncompressedBytes: 1_024,
      maxCompressionRatio: 200
    }).name).toBe('word/document.xml')
    expect(() => requireZipEntryWithinBudget(entries, 'word/document.xml', {
      maxUncompressedBytes: 1,
      maxCompressionRatio: 200
    })).toThrow(/permitted size/i)
  })

  it('rejects path traversal before an edited package reaches disk', () => {
    expect(() => inspectDocxBuffer(createPackage({
      '../outside.xml': strToU8('<unsafe />')
    }))).toThrow('unsafe filename')
  })

  it('rejects a generic ZIP that is not a DOCX package', () => {
    expect(() => inspectDocxBuffer(zipSync({
      'notes.txt': strToU8('not a document')
    }))).toThrow('not a valid DOCX')
  })

  it('rejects trailing data that makes the ZIP end record ambiguous', () => {
    const source = createPackage()
    const appended = new Uint8Array(source.byteLength + 1)
    appended.set(source)
    appended[source.byteLength] = 1
    expect(() => inspectDocxBuffer(appended)).toThrow(/comment length/i)
  })
})
