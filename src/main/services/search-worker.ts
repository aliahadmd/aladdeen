import { isAbsolute, relative, sep } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
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

      const content = await readCandidate(candidate)
      scannedFiles += 1
      if (content === null) {
        skippedFiles += 1
      } else {
        const remaining = SEARCH_MATCH_LIMIT - totalMatches
        const result = searchMarkdownSource({
          key: candidate.key,
          target: candidate.target,
          name: candidate.name,
          location: candidate.location,
          content
        }, {
          query: request.query,
          matchCase: request.matchCase,
          wholeWord: request.wholeWord,
          limit: Math.min(SEARCH_MATCHES_PER_FILE_LIMIT, remaining)
        })
        if (result.matches.length > 0) {
          matchedFiles += 1
          totalMatches += result.matches.length
          pendingMatches.push(...result.matches)
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

async function readCandidate(candidate: SearchWorkerCandidate): Promise<string | null> {
  if (candidate.contentOverride !== undefined) {
    return Buffer.byteLength(candidate.contentOverride, 'utf8') <= SEARCH_FILE_SIZE_LIMIT
      ? candidate.contentOverride
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
    return decodeMarkdown(buffer).content
  } catch {
    return null
  }
}

function post(event: SearchWorkerEvent): void {
  parentPort?.postMessage(event)
}
