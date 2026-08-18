import { describe, expect, it } from 'vitest'
import { imageBytesMatchDeclaredType } from '@main/services/export'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
const GIF89 = [...Buffer.from('GIF89a'), 0x01, 0x00]
const GIF87 = [...Buffer.from('GIF87a'), 0x01, 0x00]

// Magic bytes for the three decoders with open, unpatched DoS advisories.
const ICNS = [...Buffer.from('icns'), 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]
const JXL = [0xff, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const HEIF = [0x00, 0x00, 0x00, 0x18, ...Buffer.from('ftypheic'), 0x00, 0x00]

const bytes = (values: number[]): Uint8Array => new Uint8Array(values)

describe('DOCX export image signature guard', () => {
  it('accepts a buffer whose signature matches the declared type', () => {
    expect(imageBytesMatchDeclaredType(bytes(PNG), 'png')).toBe(true)
    expect(imageBytesMatchDeclaredType(bytes(JPEG), 'jpg')).toBe(true)
    expect(imageBytesMatchDeclaredType(bytes(GIF89), 'gif')).toBe(true)
    expect(imageBytesMatchDeclaredType(bytes(GIF87), 'gif')).toBe(true)
  })

  it('rejects the unpatched decoders even when the extension claims a safe type', () => {
    // The real exposure: the export path picks `type` from the file extension, while
    // image-size dispatches on magic bytes. Without this guard a file named
    // `cover.png` holding ICNS/JXL/HEIF bytes reaches the looping parser.
    for (const hostile of [ICNS, JXL, HEIF]) {
      expect(imageBytesMatchDeclaredType(bytes(hostile), 'png')).toBe(false)
      expect(imageBytesMatchDeclaredType(bytes(hostile), 'jpg')).toBe(false)
      expect(imageBytesMatchDeclaredType(bytes(hostile), 'gif')).toBe(false)
    }
  })

  it('rejects a genuine image declared as the wrong one of the supported types', () => {
    expect(imageBytesMatchDeclaredType(bytes(PNG), 'jpg')).toBe(false)
    expect(imageBytesMatchDeclaredType(bytes(JPEG), 'gif')).toBe(false)
    expect(imageBytesMatchDeclaredType(bytes(GIF89), 'png')).toBe(false)
  })

  it('rejects truncated buffers rather than reading past the end', () => {
    expect(imageBytesMatchDeclaredType(bytes([]), 'png')).toBe(false)
    expect(imageBytesMatchDeclaredType(bytes(PNG.slice(0, 4)), 'png')).toBe(false)
    expect(imageBytesMatchDeclaredType(bytes([0xff, 0xd8]), 'jpg')).toBe(false)
    expect(imageBytesMatchDeclaredType(bytes([0x47, 0x49, 0x46]), 'gif')).toBe(false)
  })
})
