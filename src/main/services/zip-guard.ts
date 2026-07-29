import { open, readFile } from 'node:fs/promises'
import { Unzip, UnzipInflate } from 'fflate'
import type { PresentationCompatibility } from '@shared/contracts'
import {
  MAX_PPTX_ELEMENTS,
  MAX_PPTX_SLIDES,
  MAX_XLSX_EXPANDED_BYTES,
  MAX_XLSX_POPULATED_CELLS
} from '@shared/limits'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const MAX_END_SEARCH_BYTES = 65_557
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000
const MAX_EXPANDED_BYTES = MAX_XLSX_EXPANDED_BYTES

export interface ZipEntrySummary {
  name: string
  flags: number
  compressedSize: number
  uncompressedSize: number
}

export interface XlsxPackageInspection {
  entries: ZipEntrySummary[]
  populatedCells: number
  worksheetParts: string[]
}

export interface PptxPackageInspection {
  entries: ZipEntrySummary[]
  slideParts: string[]
  elementCount: number
  signed: boolean
  restricted: boolean
  compatibility: PresentationCompatibility
}

export function requireZipEntryWithinBudget(
  entries: readonly ZipEntrySummary[],
  requestedName: string,
  options: { maxUncompressedBytes: number; maxCompressionRatio: number }
): ZipEntrySummary {
  const normalizedName = requestedName.replaceAll('\\', '/')
  const entry = entries.find((candidate) => candidate.name.replaceAll('\\', '/') === normalizedName)
  if (!entry) throw new Error(`The ZIP package is missing ${normalizedName}.`)
  if (entry.uncompressedSize > options.maxUncompressedBytes) {
    throw new Error(`${normalizedName} expands beyond the permitted size.`)
  }
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > options.maxCompressionRatio)
  ) {
    throw new Error(`${normalizedName} has an unsafe compression ratio.`)
  }
  return entry
}

export async function inspectZipArchive(path: string): Promise<ZipEntrySummary[]> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 22) throw new Error('The ZIP package is incomplete.')
    const header = Buffer.alloc(8)
    await handle.read(header, 0, header.length, 0)
    assertNotEncryptedCompoundFile(header)
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

export async function inspectXlsxPackage(path: string): Promise<XlsxPackageInspection> {
  const entries = await inspectZipArchive(path)
  assertXlsxParts(entries)
  return inspectXlsxContents(new Uint8Array(await readFile(path)), entries)
}

export async function inspectPptxPackage(path: string): Promise<PptxPackageInspection> {
  const entries = await inspectZipArchive(path)
  assertPptxParts(entries)
  return inspectPptxContents(new Uint8Array(await readFile(path)), entries)
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

export function inspectXlsxBuffer(data: Uint8Array): XlsxPackageInspection {
  const entries = inspectZipBuffer(data)
  assertXlsxParts(entries)
  return inspectXlsxContents(data, entries)
}

export function inspectPptxBuffer(data: Uint8Array): PptxPackageInspection {
  const entries = inspectZipBuffer(data)
  assertPptxParts(entries)
  return inspectPptxContents(data, entries)
}

export function inspectZipBuffer(data: Uint8Array): ZipEntrySummary[] {
  const archive = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  assertNotEncryptedCompoundFile(archive.subarray(0, 8))
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
  return parseDirectoryEntries(directory, descriptor.entryCount)
}

function assertDocxParts(entries: ZipEntrySummary[]): void {
  const names = new Set(entries.map((entry) => entry.name.replaceAll('\\', '/')))
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw new Error('This file is not a valid DOCX document.')
  }
}

function assertXlsxParts(entries: ZipEntrySummary[]): void {
  const names = new Set(entries.map(normalizeZipName))
  if (
    !names.has('[Content_Types].xml') ||
    !names.has('xl/workbook.xml') ||
    !names.has('xl/_rels/workbook.xml.rels')
  ) {
    throw new Error('This file is not a valid XLSX workbook.')
  }
}

function assertPptxParts(entries: ZipEntrySummary[]): void {
  const names = new Set(entries.map(normalizeZipName))
  if (
    !names.has('[Content_Types].xml') ||
    !names.has('ppt/presentation.xml') ||
    !names.has('ppt/_rels/presentation.xml.rels')
  ) {
    throw new Error('This file is not a valid PPTX presentation.')
  }
}

function inspectPptxContents(
  data: Uint8Array,
  entries: readonly ZipEntrySummary[]
): PptxPackageInspection {
  const names = new Set(entries.map(normalizeZipName))
  const candidateSlides = entries
    .map(normalizeZipName)
    .filter((name) => /^ppt\/slides\/[^/]+\.xml$/i.test(name))
  if (candidateSlides.length === 0) throw new Error('The PPTX presentation contains no slides.')
  if (candidateSlides.length > MAX_PPTX_SLIDES) {
    throw new Error(`The PPTX presentation contains more than ${MAX_PPTX_SLIDES.toLocaleString()} slides.`)
  }

  const relationshipParts = entries
    .map(normalizeZipName)
    .filter((name) => /^ppt\/(?:slides\/_rels\/[^/]+|_rels\/presentation\.xml)\.rels$/i.test(name))
  const requested = new Set([
    '[Content_Types].xml',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    ...candidateSlides,
    ...relationshipParts
  ])
  for (const name of requested) {
    requireZipEntryWithinBudget(entries, name, {
      maxUncompressedBytes: name.startsWith('ppt/slides/') ? 32 * 1024 * 1024 : 16 * 1024 * 1024,
      maxCompressionRatio: 200
    })
  }
  const xml = extractZipTextEntries(data, requested)
  const presentationXml = xml.get('ppt/presentation.xml')
  const relationshipsXml = xml.get('ppt/_rels/presentation.xml.rels')
  const contentTypesXml = xml.get('[Content_Types].xml')
  if (!presentationXml || !relationshipsXml || !contentTypesXml) {
    throw new Error('The PPTX presentation metadata could not be read.')
  }

  const slideRelationshipIds = [...presentationXml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?sldId\b[^>]*\br:id=["']([^"']+)["'][^>]*\/?\s*>/gi
  )].map((match) => match[1]!)
  if (slideRelationshipIds.length === 0) throw new Error('The PPTX presentation declares no slides.')
  if (slideRelationshipIds.length > MAX_PPTX_SLIDES) {
    throw new Error(`The PPTX presentation declares more than ${MAX_PPTX_SLIDES.toLocaleString()} slides.`)
  }

  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1] ?? ''
    const id = /\bId=["']([^"']+)["']/i.exec(attributes)?.[1]
    const target = /\bTarget=["']([^"']+)["']/i.exec(attributes)?.[1]
    const type = /\bType=["']([^"']+)["']/i.exec(attributes)?.[1]
    const targetMode = /\bTargetMode=["']([^"']+)["']/i.exec(attributes)?.[1]
    if (id && target && type?.endsWith('/slide')) {
      if (targetMode?.toLowerCase() === 'external') {
        throw new Error(`The PPTX slide relationship ${id} cannot be external.`)
      }
      if (relationships.has(id)) throw new Error(`The PPTX slide relationship ${id} is duplicated.`)
      relationships.set(id, target)
    }
  }
  const slideParts = slideRelationshipIds.map((id) => {
    const target = relationships.get(id)
    if (!target) throw new Error(`The PPTX slide relationship ${id} is missing or invalid.`)
    const normalizedTarget = normalizePptxSlideTarget(target)
    if (!names.has(normalizedTarget) || !xml.has(normalizedTarget)) {
      throw new Error(`The PPTX slide relationship ${id} points to a missing part.`)
    }
    return normalizedTarget
  })
  if (new Set(slideParts).size !== slideParts.length) {
    throw new Error('The PPTX presentation references the same slide more than once.')
  }

  let elementCount = 0
  for (const slidePart of slideParts) {
    const slideXml = xml.get(slidePart) ?? ''
    elementCount += slideXml.match(
      /<(?:[A-Za-z_][\w.-]*:)?(?:sp|pic|graphicFrame|cxnSp|grpSp|contentPart)(?:\s|>)/g
    )?.length ?? 0
    if (elementCount > MAX_PPTX_ELEMENTS) {
      throw new Error(`The PPTX presentation contains more than ${MAX_PPTX_ELEMENTS.toLocaleString()} elements.`)
    }
  }

  const normalizedNames = [...names]
  const signed = normalizedNames.some((name) => name.startsWith('_xmlsignatures/'))
  const macroBearing = names.has('ppt/vbaProject.bin') || /macroEnabled\.main\+xml/i.test(contentTypesXml)
  const restricted = /<(?:[A-Za-z_][\w.-]*:)?modifyVerifier\b/i.test(presentationXml)
  const readOnlyReasons: string[] = []
  if (signed) readOnlyReasons.push('digital signatures')
  if (macroBearing) readOnlyReasons.push('macro content')
  if (restricted) readOnlyReasons.push('modify protection')

  const preserveReasons: string[] = []
  if (normalizedNames.some((name) => name.startsWith('ppt/embeddings/'))) preserveReasons.push('embedded OLE content')
  if (normalizedNames.some((name) => name.startsWith('ppt/activeX/'))) preserveReasons.push('ActiveX controls')
  if (normalizedNames.some((name) => name.startsWith('customXml/'))) preserveReasons.push('custom XML')
  if (normalizedNames.some((name) => name.startsWith('ppt/diagrams/'))) preserveReasons.push('SmartArt')
  if ([...xml.entries()].some(([name, value]) => name.endsWith('.rels') && /\bTargetMode=["']External["']/i.test(value))) {
    preserveReasons.push('external or linked content')
  }

  const reasons = readOnlyReasons.length > 0 ? readOnlyReasons : [...new Set(preserveReasons)]
  const level = readOnlyReasons.length > 0 ? 'read-only' : reasons.length > 0 ? 'preserve-only' : 'supported'
  return {
    entries: [...entries],
    slideParts,
    elementCount,
    signed,
    restricted: restricted || macroBearing,
    compatibility: {
      level,
      reasons,
      requiresSaveAs: level === 'preserve-only'
    }
  }
}

function extractZipTextEntries(data: Uint8Array, requested: ReadonlySet<string>): Map<string, string> {
  const chunks = new Map<string, string[]>()
  const decoders = new Map<string, TextDecoder>()
  const completed = new Set<string>()
  let failure: Error | null = null
  const unzipper = new Unzip((file) => {
    const name = normalizeZipName(file.name)
    if (!requested.has(name)) return
    chunks.set(name, [])
    decoders.set(name, new TextDecoder())
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) {
        failure = error
        file.terminate()
        return
      }
      chunks.get(name)!.push(decoders.get(name)!.decode(chunk, { stream: !final }))
      if (final) completed.add(name)
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  const sourceChunkBytes = 64 * 1024
  for (let offset = 0; offset < data.byteLength && !failure; offset += sourceChunkBytes) {
    const end = Math.min(data.byteLength, offset + sourceChunkBytes)
    unzipper.push(data.subarray(offset, end), end === data.byteLength)
  }
  if (failure) throw failure
  for (const name of requested) {
    if (!completed.has(name)) throw new Error(`The ZIP package is missing ${name}.`)
  }
  return new Map([...chunks].map(([name, values]) => [name, values.join('')]))
}

function inspectXlsxContents(
  data: Uint8Array,
  entries: readonly ZipEntrySummary[]
): XlsxPackageInspection {
  const workbookPart = requireZipEntryWithinBudget(entries, 'xl/workbook.xml', {
    maxUncompressedBytes: 16 * 1024 * 1024,
    maxCompressionRatio: 200
  })
  const relationshipsPart = requireZipEntryWithinBudget(entries, 'xl/_rels/workbook.xml.rels', {
    maxUncompressedBytes: 16 * 1024 * 1024,
    maxCompressionRatio: 200
  })
  const names = new Set(entries.map(normalizeZipName))
  const candidateWorksheetParts = entries
    .map(normalizeZipName)
    .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))
  if (candidateWorksheetParts.length === 0) throw new Error('The XLSX package contains no worksheets.')
  for (const name of candidateWorksheetParts) {
    requireZipEntryWithinBudget(entries, name, {
      maxUncompressedBytes: 512 * 1024 * 1024,
      maxCompressionRatio: 200
    })
  }

  const requested = new Set([
    workbookPart.name,
    relationshipsPart.name,
    ...candidateWorksheetParts
  ].map(normalizeZipName))
  const worksheetCandidates = new Set(candidateWorksheetParts)
  const textParts = new Map<string, string[]>()
  const textDecoders = new Map<string, TextDecoder>()
  const worksheetCellCounts = new Map<string, number>()
  const worksheetCarries = new Map<string, string>()
  const worksheetDecoders = new Map<string, TextDecoder>()
  const completed = new Set<string>()
  let populatedCells = 0
  let failure: Error | null = null
  const unzipper = new Unzip((file) => {
    const name = normalizeZipName(file.name)
    if (!requested.has(name)) return
    const isWorksheet = worksheetCandidates.has(name)
    if (!isWorksheet) {
      textParts.set(name, [])
      textDecoders.set(name, new TextDecoder())
    }
    else worksheetDecoders.set(name, new TextDecoder())
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) {
        failure = error
        file.terminate()
        return
      }
      if (isWorksheet) {
        const decoder = worksheetDecoders.get(name)!
        const decoded = decoder.decode(chunk, { stream: !final })
        const combined = `${worksheetCarries.get(name) ?? ''}${decoded}`
        const matches = combined.match(/<(?:[A-Za-z_][\w.-]*:)?c(?:\s|>)/g)
        const addedCells = matches?.length ?? 0
        const nextCount = (worksheetCellCounts.get(name) ?? 0) + addedCells
        worksheetCellCounts.set(name, nextCount)
        populatedCells += addedCells
        if (populatedCells > MAX_XLSX_POPULATED_CELLS) {
          failure = new Error('The XLSX workbook contains more than two million populated cells.')
          file.terminate()
          return
        }
        const lastOpen = combined.lastIndexOf('<')
        const lastClose = combined.lastIndexOf('>')
        worksheetCarries.set(name, lastOpen > lastClose ? combined.slice(lastOpen) : '')
      } else {
        textParts.get(name)!.push(textDecoders.get(name)!.decode(chunk, { stream: !final }))
      }
      if (final) completed.add(name)
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  const sourceChunkBytes = 64 * 1024
  for (let offset = 0; offset < data.byteLength && !failure; offset += sourceChunkBytes) {
    const end = Math.min(data.byteLength, offset + sourceChunkBytes)
    unzipper.push(data.subarray(offset, end), end === data.byteLength)
  }
  if (failure) throw failure
  if (!completed.has('xl/workbook.xml') || !completed.has('xl/_rels/workbook.xml.rels')) {
    throw new Error('The XLSX workbook metadata could not be read.')
  }

  const workbookXml = textParts.get('xl/workbook.xml')!.join('')
  const relationshipsXml = textParts.get('xl/_rels/workbook.xml.rels')!.join('')
  const worksheetRelationshipIds = [...workbookXml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?sheet\b[^>]*\br:id=["']([^"']+)["'][^>]*\/?\s*>/gi
  )].map((match) => match[1]!)
  if (worksheetRelationshipIds.length === 0) throw new Error('The XLSX workbook declares no worksheets.')
  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1] ?? ''
    const id = /\bId=["']([^"']+)["']/i.exec(attributes)?.[1]
    const target = /\bTarget=["']([^"']+)["']/i.exec(attributes)?.[1]
    const type = /\bType=["']([^"']+)["']/i.exec(attributes)?.[1]
    const targetMode = /\bTargetMode=["']([^"']+)["']/i.exec(attributes)?.[1]
    if (id && target && type?.endsWith('/worksheet')) {
      if (targetMode?.toLowerCase() === 'external') {
        throw new Error(`The XLSX worksheet relationship ${id} cannot be external.`)
      }
      if (relationships.has(id)) throw new Error(`The XLSX worksheet relationship ${id} is duplicated.`)
      relationships.set(id, target)
    }
  }
  const worksheetParts = worksheetRelationshipIds.map((id) => {
    const target = relationships.get(id)
    if (!target) throw new Error(`The XLSX worksheet relationship ${id} is missing or invalid.`)
    const normalizedTarget = normalizeWorksheetTarget(target)
    if (!names.has(normalizedTarget) || !completed.has(normalizedTarget)) {
      throw new Error(`The XLSX worksheet relationship ${id} points to a missing part.`)
    }
    return normalizedTarget
  })
  return {
    entries: [...entries],
    worksheetParts,
    populatedCells: worksheetParts.reduce(
      (total, name) => total + (worksheetCellCounts.get(name) ?? 0),
      0
    )
  }
}

function normalizeZipName(entry: ZipEntrySummary | string): string {
  return (typeof entry === 'string' ? entry : entry.name).replaceAll('\\', '/')
}

function normalizeWorksheetTarget(target: string): string {
  const decoded = decodeURIComponent(target).replaceAll('\\', '/')
  const candidate = decoded.startsWith('/') ? decoded.slice(1) : `xl/${decoded}`
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error('The XLSX workbook contains an unsafe relationship target.')
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const normalized = parts.join('/')
  if (!normalized.startsWith('xl/worksheets/')) {
    throw new Error('The XLSX workbook contains a worksheet relationship outside xl/worksheets/.')
  }
  return normalized
}

function normalizePptxSlideTarget(target: string): string {
  const decoded = decodeURIComponent(target).replaceAll('\\', '/')
  const candidate = decoded.startsWith('/') ? decoded.slice(1) : `ppt/${decoded}`
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error('The PPTX presentation contains an unsafe relationship target.')
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const normalized = parts.join('/')
  if (!/^ppt\/slides\/[^/]+\.xml$/i.test(normalized)) {
    throw new Error('The PPTX presentation contains a slide relationship outside ppt/slides/.')
  }
  return normalized
}

function assertNotEncryptedCompoundFile(header: Uint8Array): void {
  const compoundMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  if (compoundMagic.every((byte, index) => header[index] === byte)) {
    throw new Error('Encrypted OOXML packages are not supported.')
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
  const commentLength = tail.readUInt16LE(eocd + 20)
  const eocdOffset = archiveSize - tail.length + eocd
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
  if (eocdOffset + 22 + commentLength !== archiveSize) {
    throw new Error('The ZIP end record is inconsistent with its comment length.')
  }
  if (directoryOffset + directorySize > eocdOffset) {
    throw new Error('The ZIP directory points outside the source file.')
  }
  return { entryCount, directorySize, directoryOffset }
}

function parseDirectoryEntries(
  directory: Buffer,
  entryCount: number
): ZipEntrySummary[] {
  const entries: ZipEntrySummary[] = []
  const names = new Set<string>()
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
    if ((flags & 0x1) !== 0) throw new Error('Encrypted OOXML packages are not supported.')
    const normalizedName = name.replaceAll('\\', '/')
    if (names.has(normalizedName)) throw new Error('The ZIP package contains duplicate filenames.')
    names.add(normalizedName)
    expandedBytes += uncompressedSize
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new Error('The OOXML package expands beyond the safety limit.')
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
