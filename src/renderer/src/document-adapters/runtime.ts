import type {
  BinarySearchRevealContext,
  DocumentTransaction,
  GlobalSearchMatch
} from '@shared/contracts'

export interface BinaryDocumentRuntime {
  serialize(): Promise<ArrayBuffer>
  extractText?(): string | Promise<string>
  reveal?(match: GlobalSearchMatch, context: BinarySearchRevealContext): boolean | void
  undo?(): void
  redo?(): void
  focus?(): void
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
