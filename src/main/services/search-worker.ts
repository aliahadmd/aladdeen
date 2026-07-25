import { isAbsolute, relative, sep } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { decodeMarkdown } from './file-format'
import { searchMarkdownSource } from './search-engine'
import type { GlobalSearchMatch } from '@shared/contracts'
import {
  SEARCH_FILE_SIZE_LIMIT,
  SEARCH_MATCH_LIMIT,
  SEARCH_MATCHES_PER_FILE_LIMIT,
  type SearchWorkerCandidate,
  type SearchWorkerEvent,
  type SearchWorkerRequest
} from './search-worker-protocol'

const SEARCH_CONCURRENCY = 6
const BATCH_SIZE = 25

if (!parentPort) throw new Error('Global search worker requires a parent port.')

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
          if (extracted.sourceOffsets) {
            const sourceStart = extracted.sourceOffsets[match.sourceOffsetStart]
            const sourceEnd = extracted.sourceOffsets[Math.max(0, match.sourceOffsetEnd - 1)]
            if (sourceStart !== undefined) match.sourceOffsetStart = sourceStart
            if (sourceEnd !== undefined) match.sourceOffsetEnd = sourceEnd + 1
          }
          if (extracted.pageRanges) {
            const page = extracted.pageRanges.find((range) =>
              match.sourceOffsetStart >= range.start && match.sourceOffsetStart < range.end
            )
            match.pageIndex = page?.pageIndex
          }
          if (candidate.documentKind === 'docx') match.documentPosition = match.sourceOffsetStart
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

interface ExtractedSearchContent {
  content: string
  sourceOffsets?: number[]
  pageRanges?: Array<{ pageIndex: number; start: number; end: number }>
}

async function readCandidate(candidate: SearchWorkerCandidate): Promise<ExtractedSearchContent | null> {
  if (candidate.contentOverride !== undefined) {
    return Buffer.byteLength(candidate.contentOverride, 'utf8') <= SEARCH_FILE_SIZE_LIMIT
      ? extractTextForKind(candidate.contentOverride, candidate.documentKind)
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
    if (!fileStats.isFile() || fileStats.size > SEARCH_FILE_SIZE_LIMIT) return null
    const buffer = await readFile(canonical)
    if (buffer.byteLength > SEARCH_FILE_SIZE_LIMIT) return null
    if (candidate.documentKind === 'markdown' || candidate.documentKind === 'html') {
      return extractTextForKind(decodeMarkdown(buffer).content, candidate.documentKind)
    }
    if (candidate.documentKind === 'docx') return extractDocxText(buffer)
    return extractPdfText(buffer)
  } catch {
    return null
  }
}

function extractTextForKind(
  content: string,
  documentKind: SearchWorkerCandidate['documentKind']
): ExtractedSearchContent {
  if (documentKind !== 'html') return { content }
  const output: string[] = []
  const sourceOffsets: number[] = []
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
        sourceOffsets.push(sourceStart)
      }
      continue
    }
    if (blockedDepth > 0) continue
    const decoded = decodeHtmlEntities(token)
    for (let index = 0; index < decoded.length; index += 1) {
      output.push(decoded[index]!)
      sourceOffsets.push(Math.min(sourceStart + index, sourceStart + token.length - 1))
    }
  }
  return { content: output.join(''), sourceOffsets }
}

function extractDocxText(buffer: Buffer): ExtractedSearchContent | null {
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (entry) => entry.name === 'word/document.xml'
  })
  const document = entries['word/document.xml']
  if (!document) return null
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

async function extractPdfText(buffer: Buffer): Promise<ExtractedSearchContent | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false
  })
  const document = await loading.promise
  const pages: string[] = []
  const pageRanges: Array<{ pageIndex: number; start: number; end: number }> = []
  let offset = 0
  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1)
      const textContent = await page.getTextContent()
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
      const pageText = `${text}\n`
      pageRanges.push({ pageIndex, start: offset, end: offset + pageText.length })
      pages.push(pageText)
      offset += pageText.length
      page.cleanup()
    }
    return { content: pages.join(''), pageRanges }
  } finally {
    await document.cleanup()
    await loading.destroy()
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
