import type {
  DocumentKind,
  DocumentTarget,
  GlobalSearchMatch,
  GlobalSearchSummary
} from '@shared/contracts'
import { MAX_SEARCH_DOCUMENT_BYTES } from '@shared/limits'

export const SEARCH_FILE_SIZE_LIMIT = MAX_SEARCH_DOCUMENT_BYTES
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
  documentKind: DocumentKind
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
