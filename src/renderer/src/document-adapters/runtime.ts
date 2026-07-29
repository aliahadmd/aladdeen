import type {
  BinarySearchRevealContext,
  DocumentTransaction,
  GlobalSearchMatch,
  PresentationSearchEntry,
  SpreadsheetSearchCell
} from '@shared/contracts'
import type { SpreadsheetDocumentApi } from './spreadsheet-api'
import type { PresentationDocumentApi } from './presentation-api'

export interface BinaryDocumentRuntime {
  serialize(adapterRevision?: number): Promise<ArrayBuffer>
  completeSave?(committed: boolean, adapterRevision: number): void
  extractText?(): string | Promise<string>
  extractSpreadsheetCells?(): SpreadsheetSearchCell[] | Promise<SpreadsheetSearchCell[]>
  extractPresentationEntries?(): PresentationSearchEntry[] | Promise<PresentationSearchEntry[]>
  reveal?(match: GlobalSearchMatch, context: BinarySearchRevealContext): boolean | void
  undo?(): void
  redo?(): void
  focus?(): void
  spreadsheet?: SpreadsheetDocumentApi
  presentation?: PresentationDocumentApi
  autosaveAllowed?(): boolean
  requiresSaveAs?(): boolean
  readOnly?(): boolean
  cleanup(): void
}

const runtimes = new Map<string, BinaryDocumentRuntime>()
const transactions = new Map<string, DocumentTransaction[]>()

export function registerDocumentRuntime(
  fileId: string,
  runtime: BinaryDocumentRuntime
): () => void {
  runtimes.get(fileId)?.cleanup()
  runtimes.set(fileId, runtime)
  return () => {
    if (runtimes.get(fileId) === runtime) runtimes.delete(fileId)
  }
}

export function getDocumentRuntime(fileId: string): BinaryDocumentRuntime | undefined {
  return runtimes.get(fileId)
}

export function cleanupDocumentRuntime(fileId: string): void {
  runtimes.get(fileId)?.cleanup()
  runtimes.delete(fileId)
  transactions.delete(fileId)
}

export function recordDocumentTransaction(transaction: DocumentTransaction): void {
  const history = transactions.get(transaction.fileId) ?? []
  history.push(transaction)
  if (history.length > 500) history.splice(0, history.length - 500)
  transactions.set(transaction.fileId, history)
}

export function getDocumentTransactions(fileId: string): readonly DocumentTransaction[] {
  return transactions.get(fileId) ?? []
}
