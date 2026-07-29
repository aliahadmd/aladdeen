import type {
  ICellData,
  IDataValidationRule,
  IRange,
  IStyleBase,
  IStyleData,
  IWorkbookData,
  IWorksheetData
} from '@univerjs/core'
import type { IConditionFormattingRule } from '@univerjs/preset-sheets-conditional-formatting'
import type { SpreadsheetCompatibility } from '@shared/contracts'
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from '@office-kit/xlsx/io'
import type { Cell, CellValue, FormulaValue } from '@office-kit/xlsx/cell'
import {
  getCachedFormulaValue,
  getFormulaText,
  isDurationValue,
  isErrorValue,
  isFormulaValue,
  isRichTextValue,
  richTextToString,
  setArrayFormula,
  setFormula,
  setSharedFormula
} from '@office-kit/xlsx/cell'
import type { Workbook } from '@office-kit/xlsx/workbook'
import { addWorksheet, removeSheet } from '@office-kit/xlsx/workbook'
import type { ConditionalFormattingRule } from '@office-kit/xlsx/worksheet'
import {
  clearAllCells,
  addConditionalFormatting,
  getFreezePanes,
  getCell,
  getMaxCol,
  getMaxRow,
  iterCells,
  mergeCells,
  makeAutoFilter,
  makeCfRule,
  makeConditionalFormatting,
  makeDataValidation,
  removeAllHyperlinks,
  removeAllConditionalFormatting,
  removeAllMergedRanges,
  setCell,
  setAutoFilter,
  setColumnDimension,
  setFreezePanes,
  setHyperlink,
  setRowDimension
} from '@office-kit/xlsx/worksheet'
import {
  getCellAlignment,
  getCellBorder,
  getCellFill,
  getCellFont,
  getCellNumberFormat,
  setBold,
  setCellBackgroundColor,
  setCellAlignment,
  setCellBorder,
  setCellNumberFormat,
  setFontColor,
  setFontName,
  setFontSize,
  setItalic,
  setStrikethrough,
  setUnderline
} from '@office-kit/xlsx/styles'
import {
  addDxf,
  makeAlignment,
  makeBorder,
  makeDifferentialStyle,
  makeFont,
  makePatternFill,
  makeSide,
  rgbColor
} from '@office-kit/xlsx/styles'
import type { DifferentialStyle, SideStyle } from '@office-kit/xlsx/styles'
import { boundariesToRangeString, coordinateToTuple, dateToExcel, rangeBoundaries } from '@office-kit/xlsx/utils'
import type { XlsxWorkerRequest, XlsxWorkerResponse } from './xlsx-worker-protocol'

interface XlsxCellCustom {
  styleId?: number
  formulaKind?: FormulaValue['t']
  formulaRef?: string
  formulaSharedIndex?: number
}

interface XlsxSheetCustom {
  originalTitle?: string
  originalSheetId?: number
  rowDimensions?: Array<[number, Record<string, unknown>]>
  columnDimensions?: Array<[number, Record<string, unknown>]>
  hyperlinks?: XlsxHyperlinkCustom[]
  hadConditionalFormatting?: boolean
}

interface XlsxHyperlinkCustom {
  row: number
  column: number
  ref: string
  url: string
  label: string
  tooltip?: string
}

type WorksheetReference = Extract<Workbook['sheets'][number], { kind: 'worksheet' }>

let workbook: Workbook | null = null
const worksheetReferences = new WeakMap<Workbook, Map<string, WorksheetReference>>()

const workerScope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<XlsxWorkerRequest>) => void): void
  postMessage(message: XlsxWorkerResponse, transfer?: Transferable[]): void
}

workerScope.addEventListener('message', (event) => {
  void handleRequest(event.data)
})

async function handleRequest(request: XlsxWorkerRequest): Promise<void> {
  try {
    if (request.type === 'load') {
      workbook = await loadWorkbook(fromArrayBuffer(request.data))
      disableExternalRefresh(workbook)
      const response: XlsxWorkerResponse = {
        id: request.id,
        ok: true,
        type: 'load',
        value: {
          snapshot: workbookToUniverSnapshot(workbook, request.name),
          compatibility: classifyWorkbook(workbook)
        }
      }
      workerScope.postMessage(response)
      return
    }
    if (!workbook) throw new Error('The workbook codec has not finished loading.')
    applyUniverSnapshot(workbook, request.snapshot)
    disableExternalRefresh(workbook)
    const bytes = await workbookToBytes(workbook)
    const value = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    workerScope.postMessage({ id: request.id, ok: true, type: 'serialize', value }, [value])
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'The XLSX codec stopped unexpectedly.'
    })
  }
}

export function workbookToUniverSnapshot(source: Workbook, name: string): IWorkbookData {
  const styles: IWorkbookData['styles'] = {}
  const sheets: IWorkbookData['sheets'] = {}
  const sheetOrder: string[] = []
  const referencesByUniverId = new Map<string, WorksheetReference>()
  const filterResources: Record<string, unknown> = {}
  const validationResources: Record<string, IDataValidationRule[]> = {}
  const conditionalFormattingResources: Record<string, IConditionFormattingRule[]> = {}
  const sheetIdsByTitle = new Map(source.sheets
    .filter((reference): reference is WorksheetReference => reference.kind === 'worksheet')
    .map((reference) => [reference.sheet.title, `xlsx-sheet-${reference.sheetId}`]))
  for (const reference of source.sheets) {
    if (reference.kind !== 'worksheet') continue
    const worksheet = reference.sheet
    const sheetId = `xlsx-sheet-${reference.sheetId}`
    referencesByUniverId.set(sheetId, reference)
    sheetOrder.push(sheetId)
    const cellData: NonNullable<IWorksheetData['cellData']> = {}
    for (const cell of iterCells(worksheet)) {
      const row = cell.row - 1
      const column = cell.col - 1
      const styleKey = `xlsx-style-${cell.styleId}`
      if (!styles[styleKey]) styles[styleKey] = officeCellStyleToUniver(source, cell)
      cellData[row] ??= {}
      cellData[row]![column] = officeCellToUniver(source, cell, styleKey)
    }
    const frozen = getFreezePanes(worksheet)
    const split = frozen ? coordinateToTuple(frozen) : { row: 1, col: 1 }
    const rowData: NonNullable<IWorksheetData['rowData']> = {}
    for (const [row, dimension] of worksheet.rowDimensions) {
      rowData[row - 1] = {
        ...(dimension.height !== undefined ? { h: pointsToPixels(dimension.height) } : {}),
        ...(dimension.hidden ? { hd: 1 } : {})
      }
    }
    const columnData: NonNullable<IWorksheetData['columnData']> = {}
    for (const dimension of worksheet.columnDimensions.values()) {
      for (let column = dimension.min; column <= dimension.max; column += 1) {
        columnData[column - 1] = {
          ...(dimension.width !== undefined ? { w: excelWidthToPixels(dimension.width) } : {}),
          ...(dimension.hidden ? { hd: 1 } : {})
        }
      }
    }
    const custom: XlsxSheetCustom = {
      originalTitle: worksheet.title,
      originalSheetId: reference.sheetId,
      rowDimensions: [...worksheet.rowDimensions].map(([row, value]) => [row, { ...value }]),
      columnDimensions: [...worksheet.columnDimensions].map(([column, value]) => [column, { ...value }]),
      hyperlinks: worksheet.hyperlinks.map((hyperlink) => {
        const start = rangeBoundaries(hyperlink.ref)
        return {
          row: start.minRow - 1,
          column: start.minCol - 1,
          ref: hyperlink.ref,
          url: hyperlink.target ?? officeLocationToUniver(hyperlink.location ?? '', sheetIdsByTitle),
          label: hyperlink.display ?? String(
            getCell(worksheet, start.minRow, start.minCol)?.value ?? hyperlink.target ?? hyperlink.location ?? ''
          ),
          ...(hyperlink.tooltip ? { tooltip: hyperlink.tooltip } : {})
        }
      }),
      hadConditionalFormatting: worksheet.conditionalFormatting.length > 0
    }
    if (worksheet.autoFilter) {
      filterResources[sheetId] = {
        ref: officeRangeToUniver(rangeBoundaries(worksheet.autoFilter.ref)),
        filterColumns: worksheet.autoFilter.filterColumns.map((column) => ({
          colId: column.colId,
          filters: {
            filters: [...column.values],
            ...(column.blank ? { blank: true } : {})
          }
        }))
      }
    }
    if (worksheet.dataValidations.length > 0) {
      validationResources[sheetId] = worksheet.dataValidations.map((validation, index) => ({
        uid: `xlsx-validation-${reference.sheetId}-${index}`,
        type: validation.type,
        ranges: validation.sqref.ranges.map(officeRangeToUniver),
        ...(validation.operator ? { operator: validation.operator as IDataValidationRule['operator'] } : {}),
        ...(validation.formula1 !== undefined ? { formula1: validation.formula1 } : {}),
        ...(validation.formula2 !== undefined ? { formula2: validation.formula2 } : {}),
        ...(validation.allowBlank !== undefined ? { allowBlank: validation.allowBlank } : {}),
        ...(validation.showDropDown !== undefined ? { showDropDown: !validation.showDropDown } : {}),
        ...(validation.showInputMessage !== undefined ? { showInputMessage: validation.showInputMessage } : {}),
        ...(validation.showErrorMessage !== undefined ? { showErrorMessage: validation.showErrorMessage } : {}),
        ...(validation.errorTitle ? { errorTitle: validation.errorTitle } : {}),
        ...(validation.error ? { error: validation.error } : {}),
        ...(validation.errorStyle ? { errorStyle: officeValidationErrorStyleToUniver(validation.errorStyle) } : {}),
        ...(validation.promptTitle ? { promptTitle: validation.promptTitle } : {}),
        ...(validation.prompt ? { prompt: validation.prompt } : {})
      }))
    }
    const conditionalFormatting = worksheet.conditionalFormatting.flatMap((formatting) =>
      formatting.rules.flatMap((rule) => {
        const converted = officeConditionalFormattingToUniver(
          source,
          formatting.sqref.ranges.map(officeRangeToUniver),
          rule,
          `xlsx-cf-${reference.sheetId}-${rule.priority}`
        )
        return converted ? [converted] : []
      })
    )
    if (conditionalFormatting.length > 0) conditionalFormattingResources[sheetId] = conditionalFormatting
    sheets[sheetId] = {
      id: sheetId,
      name: worksheet.title,
      rowCount: Math.min(1_048_576, Math.max(1_000, getMaxRow(worksheet) + 100)),
      columnCount: Math.min(16_384, Math.max(26, getMaxCol(worksheet) + 10)),
      cellData,
      rowData,
      columnData,
      mergeData: worksheet.mergedCells.map((range) => ({
        startRow: range.minRow - 1,
        endRow: range.maxRow - 1,
        startColumn: range.minCol - 1,
        endColumn: range.maxCol - 1
      })),
      freeze: {
        xSplit: Math.max(0, split.col - 1),
        ySplit: Math.max(0, split.row - 1),
        startRow: Math.max(0, split.row - 1),
        startColumn: Math.max(0, split.col - 1)
      },
      hidden: reference.state === 'visible' ? 0 : 1,
      showGridlines: worksheet.views[0]?.showGridLines === false ? 0 : 1,
      defaultColumnWidth: excelWidthToPixels(worksheet.defaultColumnWidth ?? 8.43),
      defaultRowHeight: pointsToPixels(worksheet.defaultRowHeight ?? 15),
      rowHeader: { width: 46 },
      columnHeader: { height: 24 },
      rightToLeft: worksheet.views[0]?.rightToLeft ? 1 : 0,
      tabColor: '',
      zoomRatio: (worksheet.views[0]?.zoomScale ?? 100) / 100,
      scrollTop: 0,
      scrollLeft: 0,
      custom: { xlsx: custom }
    }
  }
  if (sheetOrder.length === 0) throw new Error('This workbook contains no editable worksheets.')
  worksheetReferences.set(source, referencesByUniverId)
  return {
    id: `xlsx-workbook-${crypto.randomUUID()}`,
    name,
    appVersion: '0.25.1',
    locale: 'enUS' as IWorkbookData['locale'],
    styles,
    sheetOrder,
    sheets,
    resources: [
      { name: 'SHEET_FILTER_PLUGIN', data: JSON.stringify(filterResources) },
      { name: 'SHEET_DATA_VALIDATION_PLUGIN', data: JSON.stringify(validationResources) },
      { name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data: JSON.stringify(conditionalFormattingResources) }
    ],
    custom: { xlsxDate1904: source.date1904 }
  }
}

function officeCellToUniver(source: Workbook, cell: Cell, styleKey: string): ICellData {
  const custom: XlsxCellCustom = { styleId: cell.styleId }
  if (isFormulaValue(cell.value)) {
    custom.formulaKind = cell.value.t
    custom.formulaRef = cell.value.ref
    custom.formulaSharedIndex = cell.value.si
    const cached = getCachedFormulaValue(cell)
    return {
      ...(cached !== undefined ? primitiveCellValue(cached) : {}),
      f: toUniverFormula(getFormulaText(cell)),
      s: styleKey,
      custom: { xlsx: custom }
    }
  }
  return {
    ...primitiveCellValue(officeValueToPrimitive(source, cell.value)),
    s: styleKey,
    custom: { xlsx: custom }
  }
}

function officeValueToPrimitive(source: Workbook, value: CellValue): string | number | boolean | null {
  if (value instanceof Date) return dateToExcel(value, { epoch: source.date1904 ? 'mac' : 'windows' })
  if (isRichTextValue(value)) return richTextToString(value.runs)
  if (isErrorValue(value)) return value.code
  if (isDurationValue(value)) return value.ms / 86_400_000
  if (isFormulaValue(value)) return value.cachedValue ?? null
  return value
}

function primitiveCellValue(value: string | number | boolean | null): Partial<ICellData> {
  if (value === null) return { v: null }
  return {
    v: value,
    t: typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1
  }
}

function officeCellStyleToUniver(source: Workbook, cell: Cell): IStyleData {
  const font = getCellFont(source, cell)
  const fill = getCellFill(source, cell)
  const alignment = getCellAlignment(source, cell)
  const border = getCellBorder(source, cell)
  const background = fill.kind === 'pattern' && fill.patternType === 'solid' ? colorToHex(fill.fgColor) : undefined
  const borderData = {
    ...(officeBorderSideToUniver(border.top) ? { t: officeBorderSideToUniver(border.top) } : {}),
    ...(officeBorderSideToUniver(border.right) ? { r: officeBorderSideToUniver(border.right) } : {}),
    ...(officeBorderSideToUniver(border.bottom) ? { b: officeBorderSideToUniver(border.bottom) } : {}),
    ...(officeBorderSideToUniver(border.left) ? { l: officeBorderSideToUniver(border.left) } : {})
  }
  return {
    ...(font.name ? { ff: font.name } : {}),
    ...(font.size ? { fs: font.size } : {}),
    ...(font.bold ? { bl: 1 } : {}),
    ...(font.italic ? { it: 1 } : {}),
    ...(font.strike ? { st: { s: 1 } } : {}),
    ...(font.underline ? { ul: { s: 1 } } : {}),
    ...(colorToHex(font.color) ? { cl: { rgb: colorToHex(font.color) } } : {}),
    ...(background ? { bg: { rgb: background } } : {}),
    ...(getCellNumberFormat(source, cell) !== 'General'
      ? { n: { pattern: getCellNumberFormat(source, cell) } }
      : {}),
    ...(alignment.wrapText ? { tb: 3 } : {}),
    ...(alignment.horizontal ? { ht: officeHorizontalAlignmentToUniver(alignment.horizontal) } : {}),
    ...(alignment.vertical ? { vt: officeVerticalAlignmentToUniver(alignment.vertical) } : {}),
    ...(alignment.textRotation !== undefined ? { tr: { a: alignment.textRotation, v: alignment.textRotation === 255 ? 1 : 0 } } : {}),
    ...(Object.keys(borderData).length > 0 ? { bd: borderData } : {})
  }
}

function officeBorderSideToUniver(side: { style?: SideStyle; color?: { rgb?: string } } | undefined): {
  s: number
  cl: { rgb?: string }
} | undefined {
  if (!side?.style || side.style === 'none') return undefined
  return { s: officeBorderStyleToUniver(side.style), cl: { rgb: colorToHex(side.color) ?? '#000000' } }
}

function officeBorderStyleToUniver(style: SideStyle): number {
  return ({
    thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6,
    double: 7, medium: 8, mediumDashed: 9, mediumDashDot: 10,
    mediumDashDotDot: 11, slantDashDot: 12, thick: 13, none: 0
  } satisfies Record<SideStyle, number>)[style]
}

function officeHorizontalAlignmentToUniver(alignment: string): IStyleData['ht'] {
  return ({ left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4, distributed: 6 } as Record<string, IStyleData['ht']>)[alignment] ?? 0
}

function officeVerticalAlignmentToUniver(alignment: string): IStyleData['vt'] {
  return ({ top: 1, center: 2, bottom: 3, justify: 2, distributed: 2 } as Record<string, IStyleData['vt']>)[alignment] ?? 0
}

function colorToHex(color: { rgb?: string } | undefined): string | undefined {
  if (!color?.rgb) return undefined
  const rgb = color.rgb.replace(/^#/, '')
  return `#${rgb.length === 8 ? rgb.slice(2) : rgb}`
}

export function applyUniverSnapshot(target: Workbook, snapshot: IWorkbookData): void {
  const worksheetRefs = target.sheets.filter((reference) => reference.kind === 'worksheet')
  const existingByOriginalId = new Map(worksheetRefs.map((reference) => [reference.sheetId, reference]))
  const referencesByUniverId = worksheetReferences.get(target) ?? new Map<string, WorksheetReference>()
  const desired: Array<{ sheetId: string; data: Partial<IWorksheetData>; reference: WorksheetReference }> = []

  for (const sheetId of snapshot.sheetOrder) {
    const data = snapshot.sheets[sheetId]
    if (!data?.name) continue
    const custom = (data.custom as { xlsx?: XlsxSheetCustom } | undefined)?.xlsx
    let reference = referencesByUniverId.get(sheetId) ?? (custom?.originalSheetId === undefined
      ? undefined
      : existingByOriginalId.get(custom.originalSheetId))
    if (!reference) {
      const worksheet = addWorksheet(target, uniqueWorksheetTitle(target, data.name))
      const createdReference = target.sheets.find((candidate) =>
        candidate.kind === 'worksheet' && candidate.sheet === worksheet
      )
      if (!createdReference || createdReference.kind !== 'worksheet') throw new Error('Could not create the worksheet.')
      reference = createdReference
      referencesByUniverId.set(sheetId, reference)
    }
    desired.push({ sheetId, data, reference })
  }

  const desiredRefs = desired.map(({ reference }) => reference)
  for (const reference of worksheetRefs) {
    if (!desiredRefs.includes(reference)) removeSheet(target, reference.sheet.title)
  }
  for (const [sheetId, reference] of referencesByUniverId) {
    if (!desired.some((entry) => entry.sheetId === sheetId && entry.reference === reference)) {
      referencesByUniverId.delete(sheetId)
    }
  }
  for (const [index, { reference }] of desired.entries()) {
    reference.sheet.title = `__aladdeen_${index + 1}__`
  }
  for (const { data, reference } of desired) {
    reference.sheet.title = data.name!
    reference.state = data.hidden ? 'hidden' : 'visible'
    applyWorksheetSnapshot(target, reference.sheet, data, snapshot.styles)
  }
  applyWorkbookResources(target, snapshot, desired)
  const preservedNonWorksheets = target.sheets.filter((reference) => reference.kind !== 'worksheet')
  target.sheets = [...desiredRefs, ...preservedNonWorksheets]
  worksheetReferences.set(target, referencesByUniverId)
  target.activeSheetIndex = Math.min(target.activeSheetIndex, Math.max(0, target.sheets.length - 1))
  target.calcProperties = {
    ...target.calcProperties,
    calcMode: 'auto',
    fullCalcOnLoad: true,
    calcOnSave: true,
    forceFullCalc: true
  }
}

function applyWorkbookResources(
  target: Workbook,
  snapshot: IWorkbookData,
  desired: Array<{ sheetId: string; data: Partial<IWorksheetData>; reference: WorksheetReference }>
): void {
  const filters = readResource<Record<string, {
    ref?: IRange
    filterColumns?: Array<{
      colId?: number
      filters?: { filters?: string[]; blank?: boolean }
    }>
  }>>(snapshot, 'SHEET_FILTER_PLUGIN')
  const validations = readResource<Record<string, IDataValidationRule[]>>(
    snapshot,
    'SHEET_DATA_VALIDATION_PLUGIN'
  )
  const conditionalFormatting = readResource<Record<string, IConditionFormattingRule[]>>(
    snapshot,
    'SHEET_CONDITIONAL_FORMATTING_PLUGIN'
  )
  for (const { sheetId, reference } of desired) {
    if (filters) {
      const filter = filters[sheetId]
      setAutoFilter(reference.sheet, filter?.ref ? makeAutoFilter({
        ref: univerRangeToOffice(filter.ref),
        filterColumns: (filter.filterColumns ?? []).flatMap((column) =>
          Number.isInteger(column.colId) && column.colId! >= 0
            ? [{
                kind: 'filters' as const,
                colId: column.colId!,
                values: (column.filters?.filters ?? []).map(String),
                ...(column.filters?.blank ? { blank: true } : {})
              }]
            : []
        )
      }) : undefined)
    }
    if (validations) {
      reference.sheet.dataValidations = (validations[sheetId] ?? []).flatMap((rule) => {
        const ranges = Array.isArray(rule.ranges)
          ? rule.ranges.flatMap((range) => isUniverRange(range) ? [univerRangeToBoundaries(range)] : [])
          : []
        if (ranges.length === 0 || !isOfficeValidationType(rule.type)) return []
        return [makeDataValidation({
          type: rule.type,
          sqref: { ranges },
          ...(isOfficeValidationOperator(rule.operator) ? { operator: rule.operator } : {}),
          ...(rule.formula1 !== undefined ? { formula1: rule.formula1 } : {}),
          ...(rule.formula2 !== undefined ? { formula2: rule.formula2 } : {}),
          ...(rule.allowBlank !== undefined ? { allowBlank: rule.allowBlank } : {}),
          ...(rule.showDropDown !== undefined ? { showDropDown: !rule.showDropDown } : {}),
          ...(rule.showInputMessage !== undefined ? { showInputMessage: rule.showInputMessage } : {}),
          ...(rule.showErrorMessage !== undefined ? { showErrorMessage: rule.showErrorMessage } : {}),
          ...(rule.errorTitle ? { errorTitle: rule.errorTitle } : {}),
          ...(rule.error ? { error: rule.error } : {}),
          ...(rule.errorStyle !== undefined ? { errorStyle: univerValidationErrorStyleToOffice(rule.errorStyle) } : {}),
          ...(rule.promptTitle ? { promptTitle: rule.promptTitle } : {}),
          ...(rule.prompt ? { prompt: rule.prompt } : {})
        })]
      })
    }
    const custom = (snapshot.sheets[sheetId]?.custom as { xlsx?: XlsxSheetCustom } | undefined)?.xlsx
    removeAllHyperlinks(reference.sheet)
    for (const hyperlink of custom?.hyperlinks ?? []) {
      if (!isXlsxHyperlinkCustom(hyperlink)) continue
      const internalLocation = univerHyperlinkToOfficeLocation(hyperlink.url, snapshot)
      setHyperlink(reference.sheet, hyperlink.ref, {
        ...(internalLocation ? { location: internalLocation } : { target: hyperlink.url }),
        ...(hyperlink.label ? { display: hyperlink.label } : {}),
        ...(hyperlink.tooltip ? { tooltip: hyperlink.tooltip } : {})
      })
    }
    if (conditionalFormatting && (
      Object.hasOwn(conditionalFormatting, sheetId) || custom?.hadConditionalFormatting
    )) {
      const preserved = reference.sheet.conditionalFormatting.flatMap((formatting) => {
        const rules = formatting.rules.filter((rule) => rule.type === 'iconSet')
        return rules.length > 0 ? [makeConditionalFormatting({
          sqref: formatting.sqref,
          rules,
          pivot: formatting.pivot
        })] : []
      })
      removeAllConditionalFormatting(reference.sheet)
      for (const formatting of preserved) addConditionalFormatting(reference.sheet, formatting)
      for (const [index, rule] of (conditionalFormatting[sheetId] ?? []).entries()) {
        applyUniverConditionalFormatting(target, reference.sheet, rule, index + 1)
      }
    }
  }
}

function officeLocationToUniver(location: string, sheetIdsByTitle: ReadonlyMap<string, string>): string {
  const match = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(location)
  if (!match) return location ? `#rangeid=${encodeURIComponent(location)}` : ''
  const title = (match[1] ?? match[2] ?? '').replaceAll("''", "'")
  const sheetId = sheetIdsByTitle.get(title)
  return sheetId ? `#gid=${sheetId}&range=${match[3]}` : `#rangeid=${encodeURIComponent(location)}`
}

function univerHyperlinkToOfficeLocation(url: string, snapshot: IWorkbookData): string | undefined {
  if (!url.startsWith('#')) return undefined
  const params = new URLSearchParams(url.slice(1))
  const sheetId = params.get('gid')
  const range = params.get('range')
  if (sheetId && range) {
    const title = snapshot.sheets[sheetId]?.name
    return title ? `${quoteSheetTitle(title)}!${range}` : undefined
  }
  const definedName = params.get('rangeid')
  return definedName ? decodeURIComponent(definedName) : undefined
}

function quoteSheetTitle(title: string): string {
  return `'${title.replaceAll("'", "''")}'`
}

function isXlsxHyperlinkCustom(value: unknown): value is XlsxHyperlinkCustom {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<XlsxHyperlinkCustom>
  return Number.isInteger(candidate.row) && Number.isInteger(candidate.column) &&
    typeof candidate.ref === 'string' && typeof candidate.url === 'string' && typeof candidate.label === 'string'
}

function officeConditionalFormattingToUniver(
  source: Workbook,
  ranges: IRange[],
  rule: ConditionalFormattingRule,
  cfId: string
): IConditionFormattingRule | null {
  const style = officeDifferentialStyleToUniver(
    rule.dxfId === undefined ? undefined : getDifferentialStyles(source)[rule.dxfId]
  )
  const base = { ranges, cfId, stopIfTrue: Boolean(rule.stopIfTrue) }
  if (rule.type === 'expression') {
    return asUniverConditionalRule({ ...base, rule: { type: 'highlightCell', subType: 'formula', style, value: toUniverFormula(rule.formulas[0]) ?? '=' } })
  }
  if (rule.type === 'cellIs') {
    const values = rule.formulas.map(parseConditionalValue)
    return asUniverConditionalRule({
      ...base,
      rule: {
        type: 'highlightCell',
        subType: 'number',
        style,
        operator: rule.operator ?? 'equal',
        value: rule.operator === 'between' || rule.operator === 'notBetween'
          ? [values[0] ?? 0, values[1] ?? 0]
          : values[0]
      }
    })
  }
  if (rule.type === 'uniqueValues' || rule.type === 'duplicateValues') {
    return asUniverConditionalRule({ ...base, rule: { type: 'highlightCell', subType: rule.type, style } })
  }
  if (rule.type === 'top10') {
    return asUniverConditionalRule({
      ...base,
      rule: {
        type: 'highlightCell',
        subType: 'rank',
        style,
        isBottom: Boolean(rule.bottom),
        isPercent: Boolean(rule.percent),
        value: rule.rank ?? 10
      }
    })
  }
  if (rule.type === 'aboveAverage') {
    return asUniverConditionalRule({
      ...base,
      rule: {
        type: 'highlightCell',
        subType: 'average',
        style,
        operator: rule.aboveAverage === false
          ? rule.equalAverage ? 'lessThanOrEqual' : 'lessThan'
          : rule.equalAverage ? 'greaterThanOrEqual' : 'greaterThan'
      }
    })
  }
  if (rule.type === 'timePeriod') {
    return asUniverConditionalRule({
      ...base,
      rule: { type: 'highlightCell', subType: 'timePeriod', style, operator: rule.timePeriod ?? 'today' }
    })
  }
  const textOperator = officeTextConditionalOperator(rule)
  if (textOperator) {
    return asUniverConditionalRule({
      ...base,
      rule: {
        type: 'highlightCell',
        subType: 'text',
        style,
        operator: textOperator,
        ...(rule.text ? { value: rule.text } : {})
      }
    })
  }
  if (rule.type === 'colorScale') {
    const config = parseOfficeColorScale(rule.innerXml)
    return config ? asUniverConditionalRule({ ...base, rule: { type: 'colorScale', config } }) : null
  }
  if (rule.type === 'dataBar') {
    const config = parseOfficeDataBar(rule.innerXml)
    return config ? asUniverConditionalRule({ ...base, rule: { type: 'dataBar', ...config } }) : null
  }
  return null
}

function applyUniverConditionalFormatting(
  target: Workbook,
  worksheet: WorksheetReference['sheet'],
  value: IConditionFormattingRule,
  priority: number
): void {
  const rule = value.rule as unknown as Record<string, unknown>
  const ranges = value.ranges.flatMap((range) => isUniverRange(range) ? [univerRangeToBoundaries(range)] : [])
  if (ranges.length === 0 || typeof rule.type !== 'string') return
  if (rule.type === 'colorScale') {
    const config = Array.isArray(rule.config) ? rule.config.filter(isUniverColorScalePoint) : []
    if (config.length < 2) throw new Error('The workbook contains an invalid color-scale rule.')
    const officeRule = makeCfRule({
      type: 'colorScale',
      priority,
      stopIfTrue: value.stopIfTrue,
      formulas: [],
      innerXml: `<colorScale>${config.map((point) => cfvoXml(point.value)).join('')}${config
        .map((point) => `<color rgb="${cssColorToOffice(point.color)}"/>`).join('')}</colorScale>`
    })
    addConditionalFormatting(worksheet, makeConditionalFormatting({ sqref: { ranges }, rules: [officeRule] }))
    return
  }
  if (rule.type === 'dataBar') {
    const config = isObjectRecord(rule.config) ? rule.config : {}
    const min = isConditionalValueConfig(config.min) ? config.min : { type: 'min' as const }
    const max = isConditionalValueConfig(config.max) ? config.max : { type: 'max' as const }
    const color = typeof config.positiveColor === 'string' ? config.positiveColor : '#638EC6'
    const officeRule = makeCfRule({
      type: 'dataBar',
      priority,
      stopIfTrue: value.stopIfTrue,
      formulas: [],
      innerXml: `<dataBar showValue="${rule.isShowValue === false ? '0' : '1'}">${cfvoXml(min)}${cfvoXml(max)}<color rgb="${cssColorToOffice(color)}"/></dataBar>`
    })
    addConditionalFormatting(worksheet, makeConditionalFormatting({ sqref: { ranges }, rules: [officeRule] }))
    return
  }
  if (rule.type !== 'highlightCell' || typeof rule.subType !== 'string') {
    throw new Error('This conditional-formatting rule cannot be saved to XLSX safely.')
  }
  const dxfId = addDxf(target.styles, univerDifferentialStyleToOffice(
    isObjectRecord(rule.style) ? rule.style as IStyleBase : {}
  ))
  let officeRule: ConditionalFormattingRule
  if (rule.subType === 'formula') {
    officeRule = makeCfRule({
      type: 'expression', priority, dxfId, stopIfTrue: value.stopIfTrue,
      formulas: [stripFormulaPrefix(String(rule.value ?? ''))]
    })
  } else if (rule.subType === 'number') {
    const values = Array.isArray(rule.value) ? rule.value : [rule.value]
    officeRule = makeCfRule({
      type: 'cellIs', priority, dxfId, stopIfTrue: value.stopIfTrue,
      operator: String(rule.operator ?? 'equal'),
      formulas: values.filter((item) => item !== undefined).map(String)
    })
  } else if (rule.subType === 'uniqueValues' || rule.subType === 'duplicateValues') {
    officeRule = makeCfRule({ type: rule.subType, priority, dxfId, formulas: [] })
  } else if (rule.subType === 'rank') {
    officeRule = makeCfRule({
      type: 'top10', priority, dxfId, formulas: [],
      bottom: Boolean(rule.isBottom), percent: Boolean(rule.isPercent), rank: Number(rule.value ?? 10)
    })
  } else if (rule.subType === 'average') {
    const operator = String(rule.operator ?? 'greaterThan')
    officeRule = makeCfRule({
      type: 'aboveAverage', priority, dxfId, formulas: [],
      aboveAverage: operator.startsWith('greater'), equalAverage: operator.endsWith('OrEqual')
    })
  } else if (rule.subType === 'timePeriod') {
    officeRule = makeCfRule({
      type: 'timePeriod', priority, dxfId, formulas: [],
      timePeriod: String(rule.operator ?? 'today') as ConditionalFormattingRule['timePeriod']
    })
  } else if (rule.subType === 'text') {
    const { type, operator } = univerTextConditionalOperator(String(rule.operator ?? 'containsText'))
    officeRule = makeCfRule({
      type, priority, dxfId, formulas: [], operator,
      ...(rule.value === undefined ? {} : { text: String(rule.value) })
    })
  } else {
    throw new Error('This conditional-formatting rule cannot be saved to XLSX safely.')
  }
  addConditionalFormatting(worksheet, makeConditionalFormatting({ sqref: { ranges }, rules: [officeRule] }))
}

function officeDifferentialStyleToUniver(
  style: DifferentialStyle | undefined
): IStyleBase {
  if (!style) return {}
  const fill = style.fill?.kind === 'pattern' ? colorToHex(style.fill.fgColor ?? style.fill.bgColor) : undefined
  return {
    ...(style.font?.name ? { ff: style.font.name } : {}),
    ...(style.font?.size ? { fs: style.font.size } : {}),
    ...(style.font?.bold ? { bl: 1 } : {}),
    ...(style.font?.italic ? { it: 1 } : {}),
    ...(style.font?.strike ? { st: { s: 1 } } : {}),
    ...(style.font?.underline ? { ul: { s: 1 } } : {}),
    ...(colorToHex(style.font?.color) ? { cl: { rgb: colorToHex(style.font?.color) } } : {}),
    ...(fill ? { bg: { rgb: fill } } : {}),
    ...(style.numFmt?.formatCode ? { n: { pattern: style.numFmt.formatCode } } : {})
  }
}

function getDifferentialStyles(source: Workbook): readonly DifferentialStyle[] {
  return (source.styles as typeof source.styles & { dxfs?: DifferentialStyle[] }).dxfs ?? []
}

function univerDifferentialStyleToOffice(style: IStyleBase): ReturnType<typeof makeDifferentialStyle> {
  const hasFont = Boolean(style.ff || style.fs || style.bl || style.it || style.st?.s || style.ul?.s || style.cl?.rgb)
  return makeDifferentialStyle({
    ...(hasFont ? { font: makeFont({
      ...(style.ff ? { name: style.ff } : {}),
      ...(style.fs ? { size: style.fs } : {}),
      ...(style.bl ? { bold: true } : {}),
      ...(style.it ? { italic: true } : {}),
      ...(style.st?.s ? { strike: true } : {}),
      ...(style.ul?.s ? { underline: 'single' } : {}),
      ...(style.cl?.rgb ? { color: rgbColor(cssColorToOffice(style.cl.rgb)) } : {})
    }) } : {}),
    ...(style.bg?.rgb ? { fill: makePatternFill({ patternType: 'solid', fgColor: rgbColor(cssColorToOffice(style.bg.rgb)) }) } : {})
  })
}

function parseConditionalValue(value: string): number | string {
  const parsed = Number(value)
  return Number.isFinite(parsed) && value.trim() !== '' ? parsed : toUniverFormula(value) ?? value
}

function stripFormulaPrefix(value: string): string {
  return value.startsWith('=') ? value.slice(1) : value
}

function officeTextConditionalOperator(rule: ConditionalFormattingRule): string | undefined {
  if (rule.type === 'notContainsText') return 'notContainsText'
  if (['containsText', 'beginsWith', 'endsWith', 'containsBlanks', 'notContainsBlanks', 'containsErrors', 'notContainsErrors'].includes(rule.type)) {
    return rule.type
  }
  return undefined
}

function univerTextConditionalOperator(operator: string): {
  type: ConditionalFormattingRule['type']
  operator?: string
} {
  if (operator === 'notContainsText') return { type: 'notContainsText', operator: 'notContains' }
  if (operator === 'containsBlanks' || operator === 'notContainsBlanks' || operator === 'containsErrors' || operator === 'notContainsErrors') {
    return { type: operator }
  }
  return { type: operator as ConditionalFormattingRule['type'], operator }
}

function parseOfficeColorScale(innerXml: string | undefined): Array<{
  index: number
  color: string
  value: { type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'formula'; value?: number | string }
}> | null {
  if (!innerXml) return null
  const values = [...innerXml.matchAll(/<cfvo\b([^>]*)\/?\s*>/gi)].map((match) => parseCfvo(match[1] ?? ''))
  const colors = [...innerXml.matchAll(/<color\b([^>]*)\/?\s*>/gi)].map((match) =>
    xmlAttribute(match[1] ?? '', 'rgb')
  ).filter((color): color is string => Boolean(color))
  if (values.length < 2 || values.length !== colors.length) return null
  return values.map((value, index) => ({ index, value, color: officeRgbToCss(colors[index]!) }))
}

function parseOfficeDataBar(innerXml: string | undefined): {
  isShowValue: boolean
  config: {
    min: ReturnType<typeof parseCfvo>
    max: ReturnType<typeof parseCfvo>
    isGradient: boolean
    positiveColor: string
    nativeColor: string
  }
} | null {
  if (!innerXml) return null
  const values = [...innerXml.matchAll(/<cfvo\b([^>]*)\/?\s*>/gi)].map((match) => parseCfvo(match[1] ?? ''))
  const color = /<color\b([^>]*)\/?\s*>/i.exec(innerXml)
  const rgb = color ? xmlAttribute(color[1] ?? '', 'rgb') : undefined
  if (values.length < 2 || !rgb) return null
  const showValue = /<dataBar\b([^>]*)>/i.exec(innerXml)?.[1]
  const positiveColor = officeRgbToCss(rgb)
  return {
    isShowValue: xmlAttribute(showValue ?? '', 'showValue') !== '0',
    config: { min: values[0]!, max: values[1]!, isGradient: true, positiveColor, nativeColor: positiveColor }
  }
}

function parseCfvo(attributes: string): {
  type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'formula'
  value?: number | string
} {
  const type = xmlAttribute(attributes, 'type')
  const supported = ['min', 'max', 'num', 'percent', 'percentile', 'formula'] as const
  const normalized = supported.includes(type as typeof supported[number])
    ? type as typeof supported[number]
    : 'num'
  const raw = xmlAttribute(attributes, 'val')
  if (raw === undefined || normalized === 'min' || normalized === 'max') return { type: normalized }
  const numeric = Number(raw)
  return { type: normalized, value: Number.isFinite(numeric) ? numeric : raw }
}

function cfvoXml(value: ReturnType<typeof parseCfvo>): string {
  return `<cfvo type="${value.type}"${value.value === undefined ? '' : ` val="${escapeXmlAttribute(String(value.value))}"`}/>`
}

function cssColorToOffice(color: string): string {
  const normalized = color.replace(/^#/, '').toUpperCase()
  return normalized.length === 8 ? normalized : `FF${normalized}`
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(attributes)?.[1]
}

function officeRgbToCss(rgb: string): string {
  const normalized = rgb.replace(/^#/, '')
  return `#${normalized.length === 8 ? normalized.slice(2) : normalized}`
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isConditionalValueConfig(value: unknown): value is ReturnType<typeof parseCfvo> {
  return isObjectRecord(value) && ['min', 'max', 'num', 'percent', 'percentile', 'formula'].includes(String(value.type))
}

function isUniverColorScalePoint(value: unknown): value is {
  color: string
  value: ReturnType<typeof parseCfvo>
} {
  return isObjectRecord(value) && typeof value.color === 'string' && isConditionalValueConfig(value.value)
}

function asUniverConditionalRule(value: unknown): IConditionFormattingRule {
  return value as IConditionFormattingRule
}

function readResource<T>(snapshot: IWorkbookData, name: string): T | undefined {
  const resource = snapshot.resources?.find((candidate) => candidate.name === name)
  if (!resource) return undefined
  try {
    return JSON.parse(resource.data || '{}') as T
  } catch {
    throw new Error(`The spreadsheet editor produced invalid ${name} state.`)
  }
}

function officeRangeToUniver(range: { minRow: number; minCol: number; maxRow: number; maxCol: number }): IRange {
  return {
    startRow: range.minRow - 1,
    endRow: range.maxRow - 1,
    startColumn: range.minCol - 1,
    endColumn: range.maxCol - 1
  }
}

function isUniverRange(value: unknown): value is IRange {
  if (!value || typeof value !== 'object') return false
  const range = value as Partial<IRange>
  return [range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isInteger) &&
    range.startRow! >= 0 && range.startColumn! >= 0 &&
    range.endRow! >= range.startRow! && range.endColumn! >= range.startColumn! &&
    range.endRow! < 1_048_576 && range.endColumn! < 16_384
}

function univerRangeToBoundaries(range: IRange): {
  minRow: number
  minCol: number
  maxRow: number
  maxCol: number
} {
  if (!isUniverRange(range)) throw new Error('The spreadsheet editor produced an invalid cell range.')
  return {
    minRow: range.startRow + 1,
    minCol: range.startColumn + 1,
    maxRow: range.endRow + 1,
    maxCol: range.endColumn + 1
  }
}

function univerRangeToOffice(range: IRange): string {
  return boundariesToRangeString(univerRangeToBoundaries(range))
}

function isOfficeValidationType(value: string): value is 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom' {
  return ['whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom'].includes(value)
}

function isOfficeValidationOperator(value: unknown): value is 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual' {
  return typeof value === 'string' && [
    'between', 'notBetween', 'equal', 'notEqual', 'greaterThan', 'greaterThanOrEqual',
    'lessThan', 'lessThanOrEqual'
  ].includes(value)
}

function officeValidationErrorStyleToUniver(style: 'stop' | 'warning' | 'information'): 0 | 1 | 2 {
  return style === 'stop' ? 1 : style === 'warning' ? 2 : 0
}

function univerValidationErrorStyleToOffice(style: unknown): 'stop' | 'warning' | 'information' {
  return style === 1 ? 'stop' : style === 2 ? 'warning' : 'information'
}

function applyWorksheetSnapshot(
  target: Workbook,
  worksheet: Extract<Workbook['sheets'][number], { kind: 'worksheet' }>['sheet'],
  data: Partial<IWorksheetData>,
  styles: IWorkbookData['styles']
): void {
  clearAllCells(worksheet)
  removeAllMergedRanges(worksheet)
  for (const [rowKey, columns] of Object.entries(data.cellData ?? {})) {
    const row = Number(rowKey) + 1
    for (const [columnKey, cellData] of Object.entries(
      (columns ?? {}) as Record<string, ICellData | undefined>
    )) {
      if (!cellData) continue
      const column = Number(columnKey) + 1
      const custom = (cellData.custom as { xlsx?: XlsxCellCustom } | undefined)?.xlsx
      const value = cellData.v ?? null
      const cell = setCell(worksheet, row, column, value, custom?.styleId ?? 0)
      if (cellData.f) applyFormula(cell, cellData.f, value, custom)
      applyUniverStyle(target, cell, resolveStyle(cellData.s, styles))
    }
  }
  for (const range of data.mergeData ?? []) {
    mergeCells(worksheet, boundariesToRangeString({
      minRow: range.startRow + 1,
      minCol: range.startColumn + 1,
      maxRow: range.endRow + 1,
      maxCol: range.endColumn + 1
    }))
  }
  const custom = (data.custom as { xlsx?: XlsxSheetCustom } | undefined)?.xlsx
  worksheet.rowDimensions.clear()
  for (const [row, original] of custom?.rowDimensions ?? []) {
    setRowDimension(worksheet, row, original)
  }
  for (const [rowKey, row] of Object.entries(data.rowData ?? {})) {
    const rowIndex = Number(rowKey) + 1
    setRowDimension(worksheet, rowIndex, {
      ...(row?.h !== undefined ? { height: pixelsToPoints(row.h) } : {}),
      hidden: Boolean(row?.hd)
    })
  }
  worksheet.columnDimensions.clear()
  for (const [column, original] of custom?.columnDimensions ?? []) {
    setColumnDimension(worksheet, column, original)
  }
  for (const [columnKey, column] of Object.entries(data.columnData ?? {})) {
    const columnIndex = Number(columnKey) + 1
    setColumnDimension(worksheet, columnIndex, {
      ...(column?.w !== undefined ? { width: pixelsToExcelWidth(column.w) } : {}),
      hidden: Boolean(column?.hd)
    })
  }
  const freeze = data.freeze
  setFreezePanes(
    worksheet,
    freeze && (freeze.xSplit > 0 || freeze.ySplit > 0)
      ? boundariesToRangeString({
          minRow: freeze.ySplit + 1,
          maxRow: freeze.ySplit + 1,
          minCol: freeze.xSplit + 1,
          maxCol: freeze.xSplit + 1
        })
      : undefined
  )
}

function applyFormula(
  cell: Cell,
  formula: string,
  cachedValue: ICellData['v'],
  custom?: XlsxCellCustom
): void {
  const officeFormula = formula.startsWith('=') ? formula.slice(1) : formula
  const cached = typeof cachedValue === 'string' || typeof cachedValue === 'number' || typeof cachedValue === 'boolean'
    ? cachedValue
    : undefined
  if (custom?.formulaKind === 'array' && custom.formulaRef) {
    setArrayFormula(cell, custom.formulaRef, officeFormula, { cachedValue: cached })
  } else if (custom?.formulaKind === 'shared' && custom.formulaSharedIndex !== undefined) {
    setSharedFormula(cell, custom.formulaSharedIndex, officeFormula, custom.formulaRef, { cachedValue: cached })
  } else {
    setFormula(cell, officeFormula, { cachedValue: cached })
  }
}

function toUniverFormula(formula: string | undefined): string | undefined {
  if (!formula) return formula
  return formula.startsWith('=') ? formula : `=${formula}`
}

function resolveStyle(
  style: ICellData['s'],
  styles: IWorkbookData['styles']
): IStyleData | null | undefined {
  const resolved = typeof style === 'string' ? styles[style] : style
  return resolved ?? undefined
}

function applyUniverStyle(target: Workbook, cell: Cell, style: IStyleData | null | undefined): void {
  if (!style) return
  if (style.ff) setFontName(target, cell, style.ff)
  if (style.fs) setFontSize(target, cell, style.fs)
  setBold(target, cell, Boolean(style.bl))
  setItalic(target, cell, Boolean(style.it))
  setStrikethrough(target, cell, Boolean(style.st?.s))
  setUnderline(target, cell, style.ul?.s ? true : false)
  if (style.cl?.rgb) setFontColor(target, cell, rgbColor(cssColorToOffice(style.cl.rgb)))
  if (style.bg?.rgb) setCellBackgroundColor(target, cell, rgbColor(cssColorToOffice(style.bg.rgb)))
  if (style.n?.pattern) setCellNumberFormat(target, cell, style.n.pattern)
  setCellAlignment(target, cell, makeAlignment({
    ...(univerHorizontalAlignmentToOffice(style.ht) ? { horizontal: univerHorizontalAlignmentToOffice(style.ht) } : {}),
    ...(univerVerticalAlignmentToOffice(style.vt) ? { vertical: univerVerticalAlignmentToOffice(style.vt) } : {}),
    ...(style.tr ? { textRotation: style.tr.v ? 255 : Math.max(0, Math.min(180, style.tr.a)) } : {}),
    wrapText: style.tb === 3
  }))
  if (style.bd) {
    setCellBorder(target, cell, makeBorder({
      ...(univerBorderSideToOffice(style.bd.t) ? { top: univerBorderSideToOffice(style.bd.t) } : {}),
      ...(univerBorderSideToOffice(style.bd.r) ? { right: univerBorderSideToOffice(style.bd.r) } : {}),
      ...(univerBorderSideToOffice(style.bd.b) ? { bottom: univerBorderSideToOffice(style.bd.b) } : {}),
      ...(univerBorderSideToOffice(style.bd.l) ? { left: univerBorderSideToOffice(style.bd.l) } : {})
    }))
  }
}

function univerHorizontalAlignmentToOffice(alignment: IStyleData['ht']): 'left' | 'center' | 'right' | 'justify' | 'distributed' | undefined {
  return ({ 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'distributed' } as const)[alignment as 1]
}

function univerVerticalAlignmentToOffice(alignment: IStyleData['vt']): 'top' | 'center' | 'bottom' | undefined {
  return ({ 1: 'top', 2: 'center', 3: 'bottom' } as const)[alignment as 1]
}

function univerBorderSideToOffice(side: unknown): ReturnType<typeof makeSide> | undefined {
  if (!side || typeof side !== 'object') return undefined
  const candidate = side as { s?: number; cl?: { rgb?: string | null | void } | null | void }
  const style = ({
    1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashed', 5: 'dashDot', 6: 'dashDotDot',
    7: 'double', 8: 'medium', 9: 'mediumDashed', 10: 'mediumDashDot',
    11: 'mediumDashDotDot', 12: 'slantDashDot', 13: 'thick'
  } as Record<number, SideStyle>)[candidate.s ?? 0]
  if (!style) return undefined
  return makeSide({ style, ...(candidate.cl?.rgb ? { color: rgbColor(cssColorToOffice(candidate.cl.rgb)) } : {}) })
}

export function classifyWorkbook(source: Workbook): SpreadsheetCompatibility {
  const readOnlyReasons: string[] = []
  const preserveReasons: string[] = []
  if (source.workbookProtection) readOnlyReasons.push('workbook structure protection')
  if (source.fileSharing) readOnlyReasons.push('write protection')
  if (source.vbaSignature || hasPassthrough(source, /(?:^|\/)_(?:xmlsignatures|signatures)\//i)) {
    readOnlyReasons.push('digital signatures')
  }
  if (source.sheets.some((reference) => reference.kind === 'worksheet' && reference.sheet.sheetProtection)) {
    readOnlyReasons.push('protected worksheets')
  }
  if (source.sheets.some((reference) => reference.kind === 'chartsheet')) preserveReasons.push('chart sheets')
  if (source.sheets.some((reference) => reference.kind === 'worksheet' && reference.sheet.drawing)) {
    preserveReasons.push('charts, drawings, or images')
  }
  if (source.sheets.some((reference) => reference.kind === 'worksheet' &&
    reference.sheet.conditionalFormatting.some((formatting) =>
      formatting.rules.some((rule) => rule.type === 'iconSet')
    ))) {
    preserveReasons.push('icon-set conditional formatting')
  }
  if (source.pivotCaches?.length || hasPassthrough(source, /pivot|slicer/i)) preserveReasons.push('pivots or slicers')
  if (source.externalReferences?.length || hasPassthrough(source, /externalLinks|connections|queryTables/i)) {
    preserveReasons.push('external links or data connections')
  }
  if (hasPassthrough(source, /customXml/i)) preserveReasons.push('custom XML')
  if (source.vbaProject || hasPassthrough(source, /vbaProject|activeX|embeddings/i)) {
    preserveReasons.push('embedded code or objects')
  }
  const reasons = [...new Set(readOnlyReasons.length > 0 ? readOnlyReasons : preserveReasons)]
  const level = readOnlyReasons.length > 0 ? 'read-only' : reasons.length > 0 ? 'preserve-only' : 'supported'
  return { level, reasons, requiresSaveAs: level === 'preserve-only' }
}

function hasPassthrough(source: Workbook, expression: RegExp): boolean {
  return [...(source.passthrough?.keys() ?? [])].some((path) => expression.test(path))
}

function disableExternalRefresh(source: Workbook): void {
  source.workbookProperties = {
    ...source.workbookProperties,
    updateLinks: 'never',
    allowRefreshQuery: false,
    refreshAllConnections: false,
    saveExternalLinkValues: true
  }
}

function uniqueWorksheetTitle(source: Workbook, preferred: string): string {
  const titles = new Set(source.sheets.map((reference) => reference.sheet.title.toLocaleLowerCase()))
  if (!titles.has(preferred.toLocaleLowerCase())) return preferred
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` (${index})`
    const candidate = `${preferred.slice(0, 31 - suffix.length)}${suffix}`
    if (!titles.has(candidate.toLocaleLowerCase())) return candidate
  }
  throw new Error('Could not allocate a unique worksheet name.')
}

function excelWidthToPixels(width: number): number {
  return Math.max(12, Math.round(width * 7 + 5))
}

function pixelsToExcelWidth(pixels: number): number {
  return Math.max(0, (pixels - 5) / 7)
}

function pointsToPixels(points: number): number {
  return points * (96 / 72)
}

function pixelsToPoints(pixels: number): number {
  return pixels * (72 / 96)
}
