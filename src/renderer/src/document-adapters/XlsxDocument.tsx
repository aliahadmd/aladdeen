import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, LoaderCircle, ShieldAlert } from 'lucide-react'
import {
  type IWorkbookData,
  LocaleType,
  mergeLocales
} from '@univerjs/core'
import type { FUniver } from '@univerjs/core/lib/facade'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import UniverPresetSheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US'
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort'
import UniverPresetSheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US'
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import UniverPresetSheetsFindReplaceEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US'
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation'
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link'
import UniverPresetSheetsHyperLinkEnUS from '@univerjs/preset-sheets-hyper-link/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-hyper-link/lib/index.css'
import type { SpreadsheetCompatibility } from '@shared/contracts'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useAppStore } from '@renderer/store/app-store'
import type { DocumentAdapterProps } from './registry'
import {
  recordDocumentTransaction,
  registerDocumentRuntime,
  type BinaryDocumentRuntime
} from './runtime'
import { UniverSpreadsheetDocumentApi } from './spreadsheet-api'
import { XlsxWorkerClient } from './xlsx-worker-client'
import { createLocalUniver } from './univer-bootstrap'
import { isWorkbookMutationCommand } from './xlsx-mutations'

export function XlsxDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const univerRef = useRef<FUniver | null>(null)
  const dark = useEffectiveDarkMode()
  const initialDark = useRef(dark)
  const initialName = useRef(document.name)
  const initialRevision = useRef(document.revision.sha256)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [compatibility, setCompatibility] = useState<SpreadsheetCompatibility | null>(null)
  const [requiresSaveAs, setRequiresSaveAs] = useState(false)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)
  const sessionUrl = document.documentKind === 'xlsx' ? document.session.url : ''

  useEffect(() => {
    univerRef.current?.toggleDarkMode(dark)
  }, [dark])

  useEffect(() => {
    if (document.documentKind !== 'xlsx' || !host.current) return
    let disposed = false
    let cleanupRuntime: (() => void) | undefined
    let commandListener: { dispose(): void } | undefined
    const worker = new XlsxWorkerClient()
    let localRequiresSaveAs = false
    let runtime: BinaryDocumentRuntime | undefined

    const cleanup = (): void => {
      if (disposed) return
      disposed = true
      commandListener?.dispose()
      cleanupRuntime?.()
      univerRef.current?.dispose()
      univerRef.current = null
      worker.dispose()
    }

    const initialize = async (): Promise<void> => {
      try {
        const response = await fetch(sessionUrl, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Could not load the workbook (${response.status}).`)
        const loaded = await worker.load(await response.arrayBuffer(), initialName.current)
        if (disposed || !host.current) return
        localRequiresSaveAs = loaded.compatibility.requiresSaveAs
        setRequiresSaveAs(localRequiresSaveAs)
        setCompatibility(loaded.compatibility)

        const { univerAPI } = createLocalUniver({
          locale: LocaleType.EN_US,
          locales: {
            [LocaleType.EN_US]: mergeLocales(
              UniverPresetSheetsCoreEnUS,
              UniverPresetSheetsFilterEnUS,
              UniverPresetSheetsSortEnUS,
              UniverPresetSheetsFindReplaceEnUS,
              UniverPresetSheetsDataValidationEnUS,
              UniverPresetSheetsConditionalFormattingEnUS,
              UniverPresetSheetsHyperLinkEnUS
            )
          },
          darkMode: initialDark.current,
          presets: [
            UniverSheetsCorePreset({
              container: host.current,
              header: true,
              toolbar: true,
              ribbonType: 'simple',
              formulaBar: true,
              footer: { sheetBar: true }
            }),
            UniverSheetsFilterPreset(),
            UniverSheetsSortPreset(),
            UniverSheetsFindReplacePreset(),
            UniverSheetsDataValidationPreset({ showEditOnDropdown: true, showSearchOnDropdown: true }),
            UniverSheetsConditionalFormattingPreset(),
            UniverSheetsHyperLinkPreset({
              urlHandler: {
                navigateToOtherWebsite: (url) => void window.aladdeen.system.openExternal(url)
              }
            })
          ]
        })
        univerRef.current = univerAPI
        univerAPI.createWorkbook(loaded.snapshot)
        await hydrateHyperlinks(univerAPI, loaded.snapshot)
        const spreadsheet = new UniverSpreadsheetDocumentApi(
          univerAPI,
          document.id,
          () => useAppStore.getState().documents.find((item) => item.id === document.id)?.revision.sha256
            ?? initialRevision.current,
          () => useAppStore.getState().markBinaryDirty(document.id),
          () => loaded.compatibility.level !== 'read-only'
        )

        runtime = {
          serialize: () => {
            const snapshot = spreadsheet.snapshot()
            captureHyperlinks(univerAPI, snapshot)
            return worker.serialize(snapshot)
          },
          completeSave: (committed) => {
            if (committed && localRequiresSaveAs) {
              localRequiresSaveAs = false
              setRequiresSaveAs(false)
            }
          },
          extractSpreadsheetCells: () => spreadsheet.extractSearchCells(),
          reveal: (match) => {
            if (!match.spreadsheetCell) return false
            spreadsheet.selectRange(match.spreadsheetCell.sheetName, match.spreadsheetCell.address)
            return true
          },
          undo: () => { void univerAPI.undo() },
          redo: () => { void univerAPI.redo() },
          focus: () => host.current?.focus(),
          spreadsheet,
          autosaveAllowed: () => !localRequiresSaveAs && loaded.compatibility.level !== 'read-only',
          requiresSaveAs: () => localRequiresSaveAs,
          readOnly: () => loaded.compatibility.level === 'read-only',
          cleanup
        }
        cleanupRuntime = registerDocumentRuntime(document.id, runtime)
        commandListener = univerAPI.onCommandExecuted((command) => {
          if (
            !isWorkbookMutationCommand(command.id) ||
            loaded.compatibility.level === 'read-only' ||
            spreadsheet.isApplyingInternalMutation()
          ) return
          recordDocumentTransaction({
            id: crypto.randomUUID(),
            fileId: document.id,
            documentKind: 'xlsx',
            actor: 'user',
            baseRevision: useAppStore.getState().documents.find((item) => item.id === document.id)?.revision.sha256
              ?? initialRevision.current,
            undoGroup: command.id,
            createdAt: Date.now()
          })
          useAppStore.getState().markBinaryDirty(document.id)
        })
        setLoading(false)
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : 'The workbook could not be opened.')
          setLoading(false)
        }
      }
    }
    void initialize()
    return cleanup
  }, [document.documentKind, document.id, sessionUrl])

  if (document.documentKind !== 'xlsx') return <div />
  return (
    <div className="aladdeen-xlsx-host relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-elevated">
      {compatibility && compatibility.level !== 'supported' && (
        <div className={compatibility.level === 'read-only' ? 'xlsx-compatibility is-read-only' : 'xlsx-compatibility'}>
          {compatibility.level === 'read-only' ? <ShieldAlert size={15} /> : <AlertTriangle size={15} />}
          <span>
            {compatibility.level === 'read-only'
              ? `Read-only: Aladdeen cannot safely honor ${compatibility.reasons.join(', ')}.`
              : requiresSaveAs
                ? `Compatibility copy required to preserve ${compatibility.reasons.join(', ')}.`
                : `Compatibility features preserved in this editable copy: ${compatibility.reasons.join(', ')}.`}
          </span>
          {compatibility.level === 'preserve-only' && requiresSaveAs && (
            <button type="button" onClick={() => void saveDocumentAs(document.id)}>Save editable copy…</button>
          )}
        </div>
      )}
      <div
        ref={host}
        className={compatibility?.level === 'read-only' ? 'xlsx-univer-container is-read-only' : 'xlsx-univer-container'}
        tabIndex={-1}
      />
      {loading && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-surface-elevated text-[12px] text-foreground-muted">
          <span className="flex items-center gap-2"><LoaderCircle className="spinner" size={16} /> Loading workbook…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-surface-elevated p-8 text-center">
          <div className="max-w-md"><FileSpreadsheet className="mx-auto text-danger" size={25} /><strong className="mt-3 block text-[14px]">Could not open workbook</strong><span className="mt-1.5 block text-[11px] text-foreground-muted">{error}</span></div>
        </div>
      )}
    </div>
  )
}

interface WorkbookHyperlink {
  row: number
  column: number
  ref: string
  url: string
  label: string
  tooltip?: string
}

async function hydrateHyperlinks(univerAPI: FUniver, snapshot: IWorkbookData): Promise<void> {
  const workbook = univerAPI.getActiveWorkbook()
  if (!workbook) return
  for (const sheetId of snapshot.sheetOrder) {
    const data = snapshot.sheets[sheetId]
    const sheet = data && typeof data.name === 'string' ? workbook.getSheetByName(data.name) : null
    if (!data || !sheet) continue
    const hyperlinks = ((data.custom as { xlsx?: { hyperlinks?: WorkbookHyperlink[] } } | undefined)
      ?.xlsx?.hyperlinks ?? []).filter(isWorkbookHyperlink)
    for (const hyperlink of hyperlinks) {
      await sheet.getRange(hyperlink.row, hyperlink.column).setHyperLink(hyperlink.url, hyperlink.label)
    }
  }
}

function captureHyperlinks(univerAPI: FUniver, snapshot: IWorkbookData): void {
  const workbook = univerAPI.getActiveWorkbook()
  if (!workbook) return
  for (const sheetId of snapshot.sheetOrder) {
    const data = snapshot.sheets[sheetId]
    const sheet = data && typeof data.name === 'string' ? workbook.getSheetByName(data.name) : null
    if (!data || !sheet) continue
    const previous = ((data.custom as { xlsx?: { hyperlinks?: WorkbookHyperlink[] } } | undefined)
      ?.xlsx?.hyperlinks ?? []).filter(isWorkbookHyperlink)
    const previousByCell = new Map(previous.map((link) => [`${link.row}:${link.column}`, link]))
    const hyperlinks = sheet.getRange(
      0,
      0,
      Math.max(1, data.rowCount ?? 1),
      Math.max(1, data.columnCount ?? 1)
    ).getHyperLinks().map((link) => {
      const original = previousByCell.get(`${link.row}:${link.column}`)
      const unchanged = original?.url === link.url
      return {
        row: link.row,
        column: link.column,
        ref: unchanged ? original.ref : cellAddress(link.row, link.column),
        url: link.url,
        label: link.label,
        ...(unchanged && original.tooltip ? { tooltip: original.tooltip } : {})
      }
    })
    const custom = (data.custom && typeof data.custom === 'object' ? data.custom : {}) as {
      xlsx?: Record<string, unknown>
    }
    data.custom = { ...custom, xlsx: { ...custom.xlsx, hyperlinks } }
  }
}

function isWorkbookHyperlink(value: unknown): value is WorkbookHyperlink {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkbookHyperlink>
  return Number.isInteger(candidate.row) && Number.isInteger(candidate.column) &&
    typeof candidate.ref === 'string' && typeof candidate.url === 'string' && typeof candidate.label === 'string'
}

function cellAddress(zeroBasedRow: number, zeroBasedColumn: number): string {
  let column = zeroBasedColumn + 1
  let letters = ''
  while (column > 0) {
    column -= 1
    letters = String.fromCharCode(65 + (column % 26)) + letters
    column = Math.floor(column / 26)
  }
  return `${letters}${zeroBasedRow + 1}`
}
