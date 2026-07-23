import { createHash } from 'node:crypto'
import type { FileRevision } from '@shared/contracts'

export interface DecodedMarkdown {
  content: string
  lineEnding: FileRevision['lineEnding']
  hasBom: boolean
}

export function decodeMarkdown(buffer: Buffer): DecodedMarkdown {
  if (buffer.includes(0)) throw new Error('This file appears to be binary, not Markdown.')
  const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const body = hasBom ? buffer.subarray(3) : buffer
  const content = new TextDecoder('utf-8', { fatal: true }).decode(body)
  return {
    content,
    lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
    hasBom
  }
}

export function encodeMarkdown(content: string, lineEnding: FileRevision['lineEnding'], hasBom: boolean): Buffer {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const withLineEndings = lineEnding === 'CRLF' ? normalized.replaceAll('\n', '\r\n') : normalized
  const body = Buffer.from(withLineEndings, 'utf8')
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
