import { open } from 'node:fs/promises'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const MAX_END_SEARCH_BYTES = 65_557
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024

export interface ZipEntrySummary {
  name: string
  flags: number
  compressedSize: number
  uncompressedSize: number
}

export async function inspectZipArchive(path: string): Promise<ZipEntrySummary[]> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 22) throw new Error('The ZIP package is incomplete.')
    const tailLength = Math.min(size, MAX_END_SEARCH_BYTES)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, size - tailLength)
    const eocd = findSignatureBackwards(tail, END_OF_CENTRAL_DIRECTORY)
    if (eocd < 0 || eocd + 22 > tail.length) throw new Error('The ZIP directory is missing.')

    const descriptor = readDirectoryDescriptor(tail, eocd, size)

    const directory = Buffer.alloc(descriptor.directorySize)
    await handle.read(
      directory,
      0,
      descriptor.directorySize,
      descriptor.directoryOffset
    )
    return parseDirectoryEntries(directory, descriptor.entryCount)
  } finally {
    await handle.close()
  }
}

export async function inspectDocxPackage(path: string): Promise<ZipEntrySummary[]> {
  const entries = await inspectZipArchive(path)
  assertDocxParts(entries)
  return entries
}

export function inspectDocxBuffer(data: Uint8Array): ZipEntrySummary[] {
  const archive = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (archive.length < 22) throw new Error('The ZIP package is incomplete.')
  const tailOffset = Math.max(0, archive.length - MAX_END_SEARCH_BYTES)
  const tail = archive.subarray(tailOffset)
  const eocd = findSignatureBackwards(tail, END_OF_CENTRAL_DIRECTORY)
  if (eocd < 0 || eocd + 22 > tail.length) throw new Error('The ZIP directory is missing.')
  const descriptor = readDirectoryDescriptor(tail, eocd, archive.length)
  const directory = archive.subarray(
    descriptor.directoryOffset,
    descriptor.directoryOffset + descriptor.directorySize
  )
  const entries = parseDirectoryEntries(directory, descriptor.entryCount)
  assertDocxParts(entries)
  return entries
}

function assertDocxParts(entries: ZipEntrySummary[]): void {
  const names = new Set(entries.map((entry) => entry.name.replaceAll('\\', '/')))
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw new Error('This file is not a valid DOCX document.')
  }
}

function readDirectoryDescriptor(
  tail: Buffer,
  eocd: number,
  archiveSize: number
): { entryCount: number; directorySize: number; directoryOffset: number } {
  const disk = tail.readUInt16LE(eocd + 4)
  const directoryDisk = tail.readUInt16LE(eocd + 6)
  const entriesOnDisk = tail.readUInt16LE(eocd + 8)
  const entryCount = tail.readUInt16LE(eocd + 10)
  const directorySize = tail.readUInt32LE(eocd + 12)
  const directoryOffset = tail.readUInt32LE(eocd + 16)
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error('Multi-disk and ZIP64 packages are not supported.')
  }
  if (entryCount > MAX_ZIP_ENTRIES || directorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new Error('The ZIP package contains too many entries.')
  }
  if (directoryOffset + directorySize > archiveSize) {
    throw new Error('The ZIP directory points outside the source file.')
  }
  return { entryCount, directorySize, directoryOffset }
}

function parseDirectoryEntries(
  directory: Buffer,
  entryCount: number
): ZipEntrySummary[] {
  const entries: ZipEntrySummary[] = []
  let expandedBytes = 0
  let offset = 0
  while (offset < directory.length && entries.length < entryCount) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('The ZIP directory contains an invalid entry.')
    }
    const flags = directory.readUInt16LE(offset + 8)
    const compressedSize = directory.readUInt32LE(offset + 20)
    const uncompressedSize = directory.readUInt32LE(offset + 24)
    const nameLength = directory.readUInt16LE(offset + 28)
    const extraLength = directory.readUInt16LE(offset + 30)
    const commentLength = directory.readUInt16LE(offset + 32)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      next > directory.length
    ) {
      throw new Error('The ZIP entry requires unsupported ZIP64 fields.')
    }
    const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (
      !name ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.startsWith('\\') ||
      /^[a-z]:/i.test(name) ||
      name.split(/[\\/]/).some((part) => part === '..')
    ) {
      throw new Error('The ZIP package contains an unsafe filename.')
    }
    if ((flags & 0x1) !== 0) throw new Error('Encrypted DOCX packages are not supported.')
    expandedBytes += uncompressedSize
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new Error('The DOCX package expands beyond the safety limit.')
    }
    entries.push({ name, flags, compressedSize, uncompressedSize })
    offset = next
  }
  if (entries.length !== entryCount) throw new Error('The ZIP entry count is inconsistent.')
  return entries
}

function findSignatureBackwards(buffer: Buffer, signature: number): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset
  }
  return -1
}
