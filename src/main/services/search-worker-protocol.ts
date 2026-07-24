import type {
  DocumentTarget,
  GlobalSearchMatch,
  GlobalSearchSummary
} from '@shared/contracts'

export const SEARCH_FILE_SIZE_LIMIT = 10 * 1024 * 1024
export const SEARCH_MATCH_LIMIT = 500
export const SEARCH_MATCHES_PER_FILE_LIMIT = 50

export interface SearchWorkerCandidate {
  key: string
  target: DocumentTarget
  name: string
  location: string
  path: string
  authorityRoot: string
  standalone: boolean
  contentOverride?: string
}

export interface SearchWorkerRequest {
  sessionId: string
  query: string
  matchCase: boolean
  wholeWord: boolean
  candidates: SearchWorkerCandidate[]
}

export type SearchWorkerEvent =
  | {
      type: 'batch'
      sessionId: string
      matches: GlobalSearchMatch[]
      scannedFiles: number
      totalFiles: number
      skippedFiles: number
    }
  | { type: 'complete'; sessionId: string; summary: GlobalSearchSummary }
  | { type: 'error'; sessionId: string; message: string }
