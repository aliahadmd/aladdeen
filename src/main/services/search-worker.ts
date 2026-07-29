import { isAbsolute, relative, sep } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { Unzip, UnzipInflate } from 'fflate'
import { decodeMarkdown } from './file-format'
import { searchMarkdownSource } from './search-engine'
import { inspectDocxBuffer, inspectPptxBuffer, requireZipEntryWithinBudget } from './zip-guard'
import { inspectXlsxBuffer } from './zip-guard'
import type {
  GlobalSearchMatch,
  PresentationTextLocator,
  PresentationSearchEntry,
  SpreadsheetCellLocator,
  SpreadsheetSearchCell
} from '@shared/contracts'
import { loadWorkbook } from '@office-kit/xlsx/io'
import { fromBuffer } from '@office-kit/xlsx/node'
import { cellValueAsString, getCoordinate, getFormulaText } from '@office-kit/xlsx/cell'
import { iterCells } from '@office-kit/xlsx/worksheet'
import {
  SEARCH_FILE_SIZE_LIMIT,
  SEARCH_MATCH_LIMIT,
  SEARCH_MATCHES_PER_FILE_LIMIT,
  type SearchWorkerCandidate,
  type SearchWorkerEvent,
  type SearchWorkerRequest
} from './search-worker-protocol'
import { MAX_PPTX_DOCUMENT_BYTES, MAX_XLSX_DOCUMENT_BYTES } from '@shared/limits'

const SEARCH_CONCURRENCY = 6
const BATCH_SIZE = 25
const SEARCH_DOCX_XML_LIMIT = 32 * 1024 * 1024
const SEARCH_DOCX_COMPRESSION_RATIO_LIMIT = 200
const SEARCH_PDF_PAGE_LIMIT = 500
const SEARCH_PDF_EXTRACTION_TIMEOUT_MS = 15_000

if (parentPort) {
  parentPort.once('message', (request: SearchWorkerRequest) => {
    void runSearch(request).catch((error: unknown) => {
      post({
        type: 'error',
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : 'The search worker stopped unexpectedly.'
      })
      parentPort?.close()
    })
  })
}

async function runSearch(request: SearchWorkerRequest): Promise<void> {
  let nextCandidateIndex = 0
  let scannedFiles = 0
  let skippedFiles = 0
  let totalMatches = 0
  let matchedFiles = 0
  let truncated = false
  let pendingMatches: GlobalSearchMatch[] = []
  const totalFiles = request.candidates.length

  const flush = (): void => {
    if (pendingMatches.length === 0) return
    post({
      type: 'batch',
      sessionId: request.sessionId,
      matches: pendingMatches,
      scannedFiles,
      totalFiles,
      skippedFiles
    })
    pendingMatches = []
  }

  const scanNext = async (): Promise<void> => {
    while (nextCandidateIndex < totalFiles && totalMatches < SEARCH_MATCH_LIMIT) {
      const candidate = request.candidates[nextCandidateIndex]
      nextCandidateIndex += 1
      if (!candidate) continue

      const extracted = await readCandidate(candidate)
      scannedFiles += 1
      if (extracted === null) {
        skippedFiles += 1
      } else {
        const remaining = SEARCH_MATCH_LIMIT - totalMatches
        const result = searchMarkdownSource({
          key: candidate.key,
          target: candidate.target,
          name: candidate.name,
          location: candidate.location,
          content: extracted.content
        }, {
          query: request.query,
          matchCase: request.matchCase,
          wholeWord: request.wholeWord,
          limit: Math.min(SEARCH_MATCHES_PER_FILE_LIMIT, remaining)
        })
        const matches = result.matches.map((match) => {
          match.documentKind = candidate.documentKind
          if (extracted.sourceSegments) {
            const sourceRange = mapExtractedSourceRange(
              extracted.sourceSegments,
              match.sourceOffsetStart,
              match.sourceOffsetEnd
            )
            if (sourceRange) {
              match.sourceOffsetStart = sourceRange.start
              match.sourceOffsetEnd = sourceRange.end
            }
          }
          if (extracted.pageRanges) {
            const page = extracted.pageRanges.find((range) =>
              match.sourceOffsetStart >= range.start && match.sourceOffsetStart < range.end
            )
            match.pageIndex = page?.pageIndex
          }
          if (candidate.documentKind === 'docx') match.documentPosition = match.sourceOffsetStart
          if (extracted.spreadsheetSegments) {
            const segment = extracted.spreadsheetSegments.find((candidate) =>
              match.sourceOffsetStart >= candidate.start && match.sourceOffsetStart < candidate.end
            )
            if (segment) {
              match.spreadsheetCell = segment.locator
              match.location = `${match.location} › ${segment.locator.sheetName}!${segment.locator.address}`
            }
          }
          if (extracted.presentationSegments) {
            const segment = extracted.presentationSegments.find((candidate) =>
              match.sourceOffsetStart >= candidate.start && match.sourceOffsetStart < candidate.end
            )
            if (segment) {
              match.presentationText = segment.locator
              const label = segment.locator.source === 'notes'
                ? `Slide ${segment.locator.slideNumber} notes`
                : `Slide ${segment.locator.slideNumber}`
              match.location = `${match.location} › ${label}`
            }
          }
          return match
        })
        if (matches.length > 0) {
          matchedFiles += 1
          totalMatches += matches.length
          pendingMatches.push(...matches)
        }
        truncated ||= result.truncated
      }

      if (pendingMatches.length >= BATCH_SIZE || scannedFiles % BATCH_SIZE === 0) flush()
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(SEARCH_CONCURRENCY, totalFiles) },
    () => scanNext()
  ))
  if (nextCandidateIndex < totalFiles) truncated = true
  flush()
  post({
    type: 'complete',
    sessionId: request.sessionId,
    summary: {
      scannedFiles,
      totalFiles,
      matchedFiles,
      totalMatches,
      skippedFiles,
      truncated
    }
  })
  parentPort?.close()
}

export interface ExtractedSearchContent {
  content: string
  sourceSegments?: SourceOffsetSegment[]
  pageRanges?: Array<{ pageIndex: number; start: number; end: number }>
  spreadsheetSegments?: Array<{ start: number; end: number; locator: SpreadsheetCellLocator }>
  presentationSegments?: Array<{ start: number; end: number; locator: PresentationTextLocator }>
}

export interface SourceOffsetSegment {
  outputStart: number
  outputEnd: number
  sourceStart: number
  sourceEnd: number
  linear: boolean
}

async function readCandidate(candidate: SearchWorkerCandidate): Promise<ExtractedSearchContent | null> {
  if (candidate.contentOverride !== undefined) {
    if (candidate.contentOverride.kind === 'spreadsheet') {
      return candidate.documentKind === 'xlsx'
        ? extractSpreadsheetCells(candidate.contentOverride.cells)
        : null
    }
    if (candidate.contentOverride.kind === 'presentation') {
      return candidate.documentKind === 'pptx'
        ? extractPresentationEntries(candidate.contentOverride.entries)
        : null
    }
    return Buffer.byteLength(candidate.contentOverride.content, 'utf8') <= SEARCH_FILE_SIZE_LIMIT
      ? extractTextForKind(candidate.contentOverride.content, candidate.documentKind)
      : null
  }

  try {
    const pathStats = await lstat(candidate.path)
    if (pathStats.isSymbolicLink()) return null
    const canonical = await realpath(candidate.path)
    if (canonical !== candidate.path) return null
    const relation = relative(candidate.authorityRoot, canonical)
    const allowed = candidate.standalone
      ? relation === ''
      : relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
    if (!allowed) return null
    const fileStats = await stat(canonical)
    const fileLimit = candidate.documentKind === 'xlsx'
      ? MAX_XLSX_DOCUMENT_BYTES
      : candidate.documentKind === 'pptx'
        ? MAX_PPTX_DOCUMENT_BYTES
        : SEARCH_FILE_SIZE_LIMIT
    if (!fileStats.isFile() || fileStats.size > fileLimit) return null
    const buffer = await readFile(canonical)
    if (buffer.byteLength > fileLimit) return null
    if (candidate.documentKind === 'markdown' || candidate.documentKind === 'html') {
      return extractTextForKind(decodeMarkdown(buffer).content, candidate.documentKind)
    }
    if (candidate.documentKind === 'docx') return extractDocxText(buffer)
    if (candidate.documentKind === 'xlsx') return extractXlsxText(buffer)
    if (candidate.documentKind === 'pptx') return extractPptxText(buffer)
    return extractPdfText(buffer)
  } catch {
    return null
  }
}

export function extractTextForKind(
  content: string,
  documentKind: SearchWorkerCandidate['documentKind']
): ExtractedSearchContent {
  if (documentKind !== 'html') return { content }
  const output: string[] = []
  const sourceSegments: SourceOffsetSegment[] = []
  let outputOffset = 0
  let cursor = 0
  let blockedDepth = 0
  const tokenExpression = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>|[^<]+/gi
  for (const match of content.matchAll(tokenExpression)) {
    const token = match[0]
    const sourceStart = match.index ?? cursor
    cursor = sourceStart + token.length
    const tag = match[1]?.toLowerCase()
    if (token.startsWith('<')) {
      if (tag && ['script', 'style', 'template', 'noscript'].includes(tag)) {
        blockedDepth += token.startsWith('</') ? -1 : token.endsWith('/>') ? 0 : 1
        blockedDepth = Math.max(0, blockedDepth)
      }
      if (
        blockedDepth === 0 &&
        tag &&
        ['address', 'article', 'aside', 'blockquote', 'br', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'p', 'section', 'table', 'tr'].includes(tag)
      ) {
        output.push('\n')
        sourceSegments.push({
          outputStart: outputOffset,
          outputEnd: outputOffset + 1,
          sourceStart,
          sourceEnd: sourceStart + token.length,
          linear: false
        })
        outputOffset += 1
      }
      continue
    }
    if (blockedDepth > 0) continue
    const decoded = decodeHtmlTextWithSegments(token, sourceStart, outputOffset)
    output.push(decoded.content)
    sourceSegments.push(...decoded.segments)
    outputOffset += decoded.content.length
  }
  return { content: output.join(''), sourceSegments }
}

function decodeHtmlTextWithSegments(
  value: string,
  sourceStart: number,
  outputStart: number
): { content: string; segments: SourceOffsetSegment[] } {
  const output: string[] = []
  const segments: SourceOffsetSegment[] = []
  const expression = /&#(?:\d+|x[\da-f]+);|&(nbsp|amp|lt|gt|quot|apos);/gi
  let sourceCursor = 0
  let outputCursor = outputStart
  const appendLiteral = (end: number): void => {
    if (end <= sourceCursor) return
    const literal = value.slice(sourceCursor, end)
    output.push(literal)
    segments.push({
      outputStart: outputCursor,
      outputEnd: outputCursor + literal.length,
      sourceStart: sourceStart + sourceCursor,
      sourceEnd: sourceStart + end,
      linear: true
    })
    outputCursor += literal.length
  }
  for (const match of value.matchAll(expression)) {
    const entityStart = match.index ?? sourceCursor
    appendLiteral(entityStart)
    const decoded = decodeHtmlEntities(match[0])
    output.push(decoded)
    segments.push({
      outputStart: outputCursor,
      outputEnd: outputCursor + decoded.length,
      sourceStart: sourceStart + entityStart,
      sourceEnd: sourceStart + entityStart + match[0].length,
      linear: false
    })
    outputCursor += decoded.length
    sourceCursor = entityStart + match[0].length
  }
  appendLiteral(value.length)
  return { content: output.join(''), segments }
}

export function mapExtractedSourceRange(
  segments: readonly SourceOffsetSegment[],
  outputStart: number,
  outputEnd: number
): { start: number; end: number } | null {
  const startSegment = findSourceSegment(segments, outputStart)
  const endSegment = findSourceSegment(segments, Math.max(outputStart, outputEnd - 1))
  if (!startSegment || !endSegment) return null
  return {
    start: startSegment.linear
      ? startSegment.sourceStart + outputStart - startSegment.outputStart
      : startSegment.sourceStart,
    end: endSegment.linear
      ? endSegment.sourceStart + Math.max(outputStart, outputEnd - 1) - endSegment.outputStart + 1
      : endSegment.sourceEnd
  }
}

function findSourceSegment(
  segments: readonly SourceOffsetSegment[],
  outputOffset: number
): SourceOffsetSegment | undefined {
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]!
    if (outputOffset < segment.outputStart) high = middle - 1
    else if (outputOffset >= segment.outputEnd) low = middle + 1
    else return segment
  }
  return undefined
}

export function extractDocxText(buffer: Buffer): ExtractedSearchContent | null {
  const summaries = inspectDocxBuffer(buffer)
  requireZipEntryWithinBudget(summaries, 'word/document.xml', {
    maxUncompressedBytes: SEARCH_DOCX_XML_LIMIT,
    maxCompressionRatio: SEARCH_DOCX_COMPRESSION_RATIO_LIMIT
  })
  const document = extractZipEntryWithinBudget(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    'word/document.xml',
    SEARCH_DOCX_XML_LIMIT
  )
  const xml = new TextDecoder().decode(document)
  const content = decodeHtmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
  return { content }
}

export async function extractXlsxText(buffer: Buffer): Promise<ExtractedSearchContent | null> {
  inspectXlsxBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  const workbook = await loadWorkbook(fromBuffer(buffer))
  const cells: SpreadsheetSearchCell[] = []
  for (const reference of workbook.sheets) {
    if (reference.kind !== 'worksheet') continue
    for (const cell of iterCells(reference.sheet)) {
      const rawFormula = getFormulaText(cell)
      const formula = rawFormula ? `=${rawFormula.replace(/^=/, '')}` : undefined
      const value = cellValueAsString(cell.value)
      if (!value && !formula) continue
      cells.push({
        sheetName: reference.sheet.title,
        address: getCoordinate(cell),
        row: cell.row,
        column: cell.col,
        value,
        ...(formula ? { formula } : {})
      })
    }
  }
  return extractSpreadsheetCells(cells)
}

export function extractSpreadsheetCells(
  cells: readonly SpreadsheetSearchCell[]
): ExtractedSearchContent {
  const chunks: string[] = []
  const spreadsheetSegments: NonNullable<ExtractedSearchContent['spreadsheetSegments']> = []
  let offset = 0
  let utf8Bytes = 0
  for (const cell of cells) {
    const fields = [cell.value, cell.formula].filter((field): field is string => Boolean(field))
    for (const field of fields) {
      const nextBytes = Buffer.byteLength(`${field}\n`, 'utf8')
      if (utf8Bytes + nextBytes > SEARCH_FILE_SIZE_LIMIT) {
        return { content: chunks.join(''), spreadsheetSegments }
      }
      chunks.push(field, '\n')
      spreadsheetSegments.push({
        start: offset,
        end: offset + field.length,
        locator: {
          sheetName: cell.sheetName,
          address: cell.address,
          row: cell.row,
          column: cell.column
        }
      })
      offset += field.length + 1
      utf8Bytes += nextBytes
    }
  }
  return { content: chunks.join(''), spreadsheetSegments }
}

export function extractPptxText(buffer: Buffer): ExtractedSearchContent | null {
  const archive = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const inspection = inspectPptxBuffer(archive)
  const slideRelationshipParts = inspection.slideParts.map((slidePart) => {
    const name = slidePart.slice(slidePart.lastIndexOf('/') + 1)
    return `ppt/slides/_rels/${name}.rels`
  })
  const notesParts = inspection.entries
    .map((entry) => entry.name.replaceAll('\\', '/'))
    .filter((name) => /^ppt\/notesSlides\/[^/]+\.xml$/i.test(name))
  const requested = new Set([
    ...inspection.slideParts,
    ...slideRelationshipParts.filter((name) => inspection.entries.some((entry) => entry.name.replaceAll('\\', '/') === name)),
    ...notesParts
  ])
  const extracted = extractZipEntriesWithinBudget(archive, requested, SEARCH_FILE_SIZE_LIMIT * 4)
  const entries: PresentationSearchEntry[] = []
  inspection.slideParts.forEach((slidePart, slideIndex) => {
    const slideNumber = slideIndex + 1
    const slideId = slidePart
    const slideXml = new TextDecoder().decode(extracted.get(slidePart) ?? new Uint8Array())
    for (const element of extractPptxElementText(slideXml)) {
      entries.push({
        slideIndex,
        slideNumber,
        slideId,
        source: 'slide',
        text: element.text,
        ...(element.id ? { elementId: element.id } : {}),
        ...(element.name ? { elementName: element.name } : {})
      })
    }
    const slideName = slidePart.slice(slidePart.lastIndexOf('/') + 1)
    const relPart = `ppt/slides/_rels/${slideName}.rels`
    const relXml = new TextDecoder().decode(extracted.get(relPart) ?? new Uint8Array())
    const notesTarget = relationshipTarget(relXml, '/notesSlide')
    if (!notesTarget) return
    const notesPart = normalizeRelatedPart(slidePart, notesTarget)
    const notesXml = new TextDecoder().decode(extracted.get(notesPart) ?? new Uint8Array())
    const notes = extractDrawingText(notesXml)
    if (notes) entries.push({ slideIndex, slideNumber, slideId, source: 'notes', text: notes })
  })
  return extractPresentationEntries(entries)
}

export function extractPresentationEntries(
  entries: readonly PresentationSearchEntry[]
): ExtractedSearchContent {
  const chunks: string[] = []
  const presentationSegments: NonNullable<ExtractedSearchContent['presentationSegments']> = []
  let offset = 0
  let utf8Bytes = 0
  for (const entry of entries) {
    if (!entry.text) continue
    const nextBytes = Buffer.byteLength(`${entry.text}\n`, 'utf8')
    if (utf8Bytes + nextBytes > SEARCH_FILE_SIZE_LIMIT) break
    chunks.push(entry.text, '\n')
    presentationSegments.push({
      start: offset,
      end: offset + entry.text.length,
      locator: {
        slideIndex: entry.slideIndex,
        slideNumber: entry.slideNumber,
        source: entry.source,
        ...(entry.slideId ? { slideId: entry.slideId } : {}),
        ...(entry.elementId ? { elementId: entry.elementId } : {}),
        ...(entry.elementName ? { elementName: entry.elementName } : {})
      }
    })
    offset += entry.text.length + 1
    utf8Bytes += nextBytes
  }
  return { content: chunks.join(''), presentationSegments }
}

function extractPptxElementText(xml: string): Array<{ id?: string; name?: string; text: string }> {
  const output: Array<{ id?: string; name?: string; text: string }> = []
  const expression = /<(?:[A-Za-z_][\w.-]*:)?(sp|graphicFrame|pic|cxnSp)\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?\1>/gi
  for (const match of xml.matchAll(expression)) {
    const block = match[0]
    const text = extractDrawingText(block)
    if (!text) continue
    const properties = /<(?:[A-Za-z_][\w.-]*:)?cNvPr\b([^>]*)>/i.exec(block)?.[1] ?? ''
    const id = /\bid=["']([^"']+)["']/i.exec(properties)?.[1]
    const name = /\bname=["']([^"']+)["']/i.exec(properties)?.[1]
    output.push({ text, ...(id ? { id } : {}), ...(name ? { name: decodeHtmlEntities(name) } : {}) })
  }
  if (output.length === 0) {
    const text = extractDrawingText(xml)
    if (text) output.push({ text })
  }
  return output
}

function extractDrawingText(xml: string): string {
  return decodeHtmlEntities(
    [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi)]
      .map((match) => match[1] ?? '')
      .filter(Boolean)
      .join('\n')
  ).trim()
}

function relationshipTarget(xml: string, typeSuffix: string): string | undefined {
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1] ?? ''
    const type = /\bType=["']([^"']+)["']/i.exec(attributes)?.[1]
    const targetMode = /\bTargetMode=["']([^"']+)["']/i.exec(attributes)?.[1]
    if (type?.endsWith(typeSuffix) && targetMode?.toLowerCase() !== 'external') {
      return /\bTarget=["']([^"']+)["']/i.exec(attributes)?.[1]
    }
  }
  return undefined
}

function normalizeRelatedPart(sourcePart: string, target: string): string {
  const decoded = decodeURIComponent(target).replaceAll('\\', '/')
  const base = sourcePart.slice(0, sourcePart.lastIndexOf('/'))
  const candidate = decoded.startsWith('/') ? decoded.slice(1) : `${base}/${decoded}`
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function extractZipEntriesWithinBudget(
  archive: Uint8Array,
  targetNames: ReadonlySet<string>,
  maxOutputBytes: number
): Map<string, Uint8Array> {
  const output = new Map<string, Uint8Array>()
  const chunks = new Map<string, Uint8Array[]>()
  const sizes = new Map<string, number>()
  let totalBytes = 0
  let failure: Error | null = null
  const unzipper = new Unzip((file) => {
    const name = file.name.replaceAll('\\', '/')
    if (!targetNames.has(name)) return
    chunks.set(name, [])
    sizes.set(name, 0)
    file.ondata = (error, data, final) => {
      if (failure) return
      if (error) {
        failure = error
        file.terminate()
        return
      }
      totalBytes += data.byteLength
      if (totalBytes > maxOutputBytes) {
        failure = new Error('Presentation search content expands beyond the permitted size.')
        file.terminate()
        return
      }
      if (data.byteLength > 0) chunks.get(name)!.push(data)
      sizes.set(name, (sizes.get(name) ?? 0) + data.byteLength)
      if (final) {
        const joined = new Uint8Array(sizes.get(name) ?? 0)
        let offset = 0
        for (const chunk of chunks.get(name) ?? []) {
          joined.set(chunk, offset)
          offset += chunk.byteLength
        }
        output.set(name, joined)
      }
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  const sourceChunkBytes = 64 * 1024
  for (let offset = 0; offset < archive.byteLength && !failure; offset += sourceChunkBytes) {
    const end = Math.min(archive.byteLength, offset + sourceChunkBytes)
    unzipper.push(archive.subarray(offset, end), end === archive.byteLength)
  }
  if (failure) throw failure
  return output
}

function extractZipEntryWithinBudget(
  archive: Uint8Array,
  targetName: string,
  maxOutputBytes: number
): Uint8Array {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let complete = false
  let failure: Error | null = null
  const unzipper = new Unzip((file) => {
    if (file.name.replaceAll('\\', '/') !== targetName) return
    file.ondata = (error, data, final) => {
      if (failure) return
      if (error) {
        failure = error
        file.terminate()
        return
      }
      totalBytes += data.byteLength
      if (totalBytes > maxOutputBytes) {
        failure = new Error(`${targetName} expands beyond the permitted size.`)
        file.terminate()
        return
      }
      if (data.byteLength > 0) chunks.push(data)
      if (final) complete = true
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  const sourceChunkBytes = 64 * 1024
  for (let offset = 0; offset < archive.byteLength && !failure; offset += sourceChunkBytes) {
    const end = Math.min(archive.byteLength, offset + sourceChunkBytes)
    unzipper.push(archive.subarray(offset, end), end === archive.byteLength)
  }
  if (failure) throw failure
  if (!complete) throw new Error(`The ZIP package is missing ${targetName}.`)
  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedSearchContent | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false
  })
  const deadline = Date.now() + SEARCH_PDF_EXTRACTION_TIMEOUT_MS
  const document = await withinDeadline(loading.promise, deadline, 'PDF parsing timed out.')
  const pages: string[] = []
  const pageRanges: Array<{ pageIndex: number; start: number; end: number }> = []
  let offset = 0
  let utf8Bytes = 0
  try {
    if (document.numPages > SEARCH_PDF_PAGE_LIMIT) return null
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await withinDeadline(document.getPage(pageIndex + 1), deadline, 'PDF text extraction timed out.')
      try {
        const textContent = await withinDeadline(page.getTextContent(), deadline, 'PDF text extraction timed out.')
        const text = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
        const pageText = `${text}\n`
        utf8Bytes += Buffer.byteLength(pageText, 'utf8')
        if (utf8Bytes > SEARCH_FILE_SIZE_LIMIT) return null
        pageRanges.push({ pageIndex, start: offset, end: offset + pageText.length })
        pages.push(pageText)
        offset += pageText.length
      } finally {
        page.cleanup()
      }
    }
    return { content: pages.join(''), pageRanges }
  } finally {
    await document.cleanup()
    await loading.destroy()
  }
}

async function withinDeadline<T>(promise: Promise<T>, deadline: number, message: string): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(message)
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), remaining)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', '\u00a0')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

function post(event: SearchWorkerEvent): void {
  parentPort?.postMessage(event)
}
