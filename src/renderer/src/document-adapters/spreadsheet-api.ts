import type { ICellData, IWorkbookData } from '@univerjs/core'
import type { FUniver } from '@univerjs/core/lib/facade'
import type { DocumentActor, SpreadsheetSearchCell } from '@shared/contracts'
import { recordDocumentTransaction } from './runtime'

export type SpreadsheetValue = string | number | boolean | null

export interface SpreadsheetRangeData {
  values: SpreadsheetValue[][]
  formulas: string[][]
}

export interface SpreadsheetSheetSummary {
  id: string
  name: string
}

export interface SpreadsheetDocumentApi {
  listSheets(): SpreadsheetSheetSummary[]
  getRange(sheetName: string, range: string): SpreadsheetRangeData
  setValues(sheetName: string, range: string, values: SpreadsheetValue[][], actor?: DocumentActor): void
  setFormulas(sheetName: string, range: string, formulas: string[][], actor?: DocumentActor): void
  clearRange(sheetName: string, range: string, actor?: DocumentActor): void
  selectRange(sheetName: string, range: string): void
  createSheet(name: string, index?: number, actor?: DocumentActor): SpreadsheetSheetSummary
  renameSheet(sheetName: string, nextName: string, actor?: DocumentActor): void
  deleteSheet(sheetName: string, actor?: DocumentActor): void
  reorderSheet(sheetName: string, index: number, actor?: DocumentActor): void
}

export class UniverSpreadsheetDocumentApi implements SpreadsheetDocumentApi {
  private internalMutationDepth = 0

  constructor(
    private readonly univerAPI: FUniver,
    private readonly fileId: string,
    private readonly baseRevision: () => string,
    private readonly onMutation: () => void,
    private readonly canMutate: () => boolean = () => true
  ) {}

  listSheets(): SpreadsheetSheetSummary[] {
    return this.workbook().getSheets().map((sheet) => ({
      id: sheet.getSheetId(),
      name: sheet.getSheetName()
    }))
  }

  getRange(sheetName: string, range: string): SpreadsheetRangeData {
    const target = this.range(sheetName, range)
    return {
      values: target.getValues() as SpreadsheetValue[][],
      formulas: target.getFormulas()
    }
  }

  setValues(
    sheetName: string,
    range: string,
    values: SpreadsheetValue[][],
    actor: DocumentActor = 'agent'
  ): void {
    assertRectangularMatrix(values, 'values')
    this.mutate(actor, `set-values:${sheetName}!${range}`, () => {
      const target = this.range(sheetName, range)
      target.setValues(values as Parameters<typeof target.setValues>[0])
    })
  }

  setFormulas(
    sheetName: string,
    range: string,
    formulas: string[][],
    actor: DocumentActor = 'agent'
  ): void {
    assertRectangularMatrix(formulas, 'formulas')
    if (formulas.some((row) => row.some((formula) => formula && !formula.startsWith('=')))) {
      throw new Error('Spreadsheet formulas must begin with =.')
    }
    this.mutate(actor, `set-formulas:${sheetName}!${range}`, () => {
      this.range(sheetName, range).setFormulas(formulas)
    })
  }

  clearRange(sheetName: string, range: string, actor: DocumentActor = 'agent'): void {
    this.mutate(actor, `clear-range:${sheetName}!${range}`, () => {
      this.range(sheetName, range).clear({ contentsOnly: true })
    })
  }

  selectRange(sheetName: string, range: string): void {
    const sheet = this.sheet(sheetName)
    sheet.activate()
    sheet.setActiveRange(sheet.getRange(assertA1Range(range)))
  }

  createSheet(
    name: string,
    index?: number,
    actor: DocumentActor = 'agent'
  ): SpreadsheetSheetSummary {
    const normalized = assertSheetName(name)
    const sheet = this.mutate(actor, `create-sheet:${normalized}`, () =>
      this.workbook().insertSheet(normalized, index === undefined ? undefined : { index })
    )
    return { id: sheet.getSheetId(), name: sheet.getSheetName() }
  }

  renameSheet(sheetName: string, nextName: string, actor: DocumentActor = 'agent'): void {
    this.mutate(actor, `rename-sheet:${sheetName}`, () => {
      this.sheet(sheetName).setName(assertSheetName(nextName))
    })
  }

  deleteSheet(sheetName: string, actor: DocumentActor = 'agent'): void {
    const workbook = this.workbook()
    if (workbook.getSheets().length <= 1) throw new Error('A workbook must contain at least one worksheet.')
    this.mutate(actor, `delete-sheet:${sheetName}`, () => {
      if (!workbook.deleteSheet(this.sheet(sheetName))) throw new Error(`Could not delete worksheet “${sheetName}”.`)
    })
  }

  reorderSheet(sheetName: string, index: number, actor: DocumentActor = 'agent'): void {
    const workbook = this.workbook()
    const boundedIndex = Math.max(0, Math.min(Math.trunc(index), workbook.getSheets().length - 1))
    this.mutate(actor, `reorder-sheet:${sheetName}`, () => {
      workbook.moveSheet(this.sheet(sheetName), boundedIndex)
    })
  }

  isApplyingInternalMutation(): boolean {
    return this.internalMutationDepth > 0
  }

  snapshot(): IWorkbookData {
    return this.workbook().save()
  }

  extractSearchCells(): SpreadsheetSearchCell[] {
    const snapshot = this.snapshot()
    const output: SpreadsheetSearchCell[] = []
    for (const sheetId of snapshot.sheetOrder) {
      const sheet = snapshot.sheets[sheetId]
      if (!sheet?.name) continue
      for (const [rowKey, columns] of Object.entries(sheet.cellData ?? {})) {
        const row = Number(rowKey) + 1
        for (const [columnKey, cell] of Object.entries(
          (columns ?? {}) as Record<string, ICellData | undefined>
        )) {
          if (!cell) continue
          const column = Number(columnKey) + 1
          const value = spreadsheetCellText(cell)
          if (!value && !cell.f) continue
          output.push({
            sheetName: sheet.name,
            address: `${columnName(column)}${row}`,
            row,
            column,
            value,
            ...(cell.f ? { formula: cell.f } : {})
          })
        }
      }
    }
    return output
  }

  private workbook() {
    const workbook = this.univerAPI.getActiveWorkbook()
    if (!workbook) throw new Error('The spreadsheet editor is not ready.')
    return workbook
  }

  private sheet(name: string) {
    const sheet = this.workbook().getSheetByName(assertSheetName(name))
    if (!sheet) throw new Error(`Worksheet “${name}” does not exist.`)
    return sheet
  }

  private range(sheetName: string, range: string) {
    return this.sheet(sheetName).getRange(assertA1Range(range))
  }

  private record(actor: DocumentActor, undoGroup: string): void {
    recordDocumentTransaction({
      id: crypto.randomUUID(),
      fileId: this.fileId,
      documentKind: 'xlsx',
      actor,
      baseRevision: this.baseRevision(),
      undoGroup,
      createdAt: Date.now()
    })
  }

  private mutate<T>(actor: DocumentActor, undoGroup: string, action: () => T): T {
    if (!this.canMutate()) throw new Error('This workbook is read-only.')
    this.internalMutationDepth += 1
    try {
      const result = action()
      this.record(actor, undoGroup)
      this.onMutation()
      return result
    } finally {
      this.internalMutationDepth -= 1
    }
  }
}

function assertSheetName(name: string): string {
  const normalized = name.trim()
  if (!normalized || normalized.length > 31 || /[:\\/?*[\]]/.test(normalized)) {
    throw new Error('Worksheet names must be 1–31 characters and cannot contain : \\ / ? * [ or ].')
  }
  if (normalized.startsWith("'") || normalized.endsWith("'") || normalized.toLowerCase() === 'history') {
    throw new Error('That worksheet name is reserved by Excel.')
  }
  return normalized
}

function assertA1Range(range: string): string {
  const normalized = range.trim().toUpperCase()
  const cell = '[A-Z]{1,3}[1-9]\\d{0,6}'
  if (!new RegExp(`^${cell}(?::${cell})?$`).test(normalized)) {
    throw new Error('Use a bounded A1 range such as A1 or A1:D20.')
  }
  return normalized
}

function assertRectangularMatrix<T>(matrix: T[][], label: string): void {
  if (matrix.length === 0 || matrix[0]?.length === 0) throw new Error(`Spreadsheet ${label} cannot be empty.`)
  const width = matrix[0]!.length
  if (matrix.some((row) => row.length !== width)) throw new Error(`Spreadsheet ${label} must be rectangular.`)
}

function spreadsheetCellText(cell: ICellData): string {
  if (cell.v === null || cell.v === undefined) return ''
  return typeof cell.v === 'boolean' ? (cell.v ? 'TRUE' : 'FALSE') : String(cell.v)
}

function columnName(column: number): string {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}
