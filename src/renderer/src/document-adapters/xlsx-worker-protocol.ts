import type { IWorkbookData } from '@univerjs/core'
import type { SpreadsheetCompatibility } from '@shared/contracts'

export interface XlsxLoadResult {
  snapshot: IWorkbookData
  compatibility: SpreadsheetCompatibility
}

export type XlsxWorkerRequest =
  | { id: number; type: 'load'; data: ArrayBuffer; name: string }
  | { id: number; type: 'serialize'; snapshot: IWorkbookData }

export type XlsxWorkerResponse =
  | { id: number; ok: true; type: 'load'; value: XlsxLoadResult }
  | { id: number; ok: true; type: 'serialize'; value: ArrayBuffer }
  | { id: number; ok: false; error: string }
