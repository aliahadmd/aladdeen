import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { inspectDocxBuffer } from '../../src/main/services/zip-guard'

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
})
