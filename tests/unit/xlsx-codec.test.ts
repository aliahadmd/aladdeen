// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from '@office-kit/xlsx/io'
import { getFormulaText, setFormula } from '@office-kit/xlsx/cell'
import { addWorksheet, createWorkbook, makeWorkbookProtection } from '@office-kit/xlsx/workbook'
import {
  addConditionalFormatting,
  getCell,
  makeAutoFilter,
  makeCfRule,
  makeConditionalFormatting,
  makeDataValidation,
  setCell,
  setAutoFilter,
  setHyperlink
} from '@office-kit/xlsx/worksheet'
import {
  getCellAlignment,
  getCellBorder,
  getCellFill,
  getCellFont,
  getCellNumberFormat,
  makeAlignment,
  makeBorder,
  makeSide,
  setCellAlignment,
  setCellBorder,
  setCellNumberFormat
} from '@office-kit/xlsx/styles'
import { dateToExcel } from '@office-kit/xlsx/utils'

let codec: typeof import('@renderer/document-adapters/xlsx-codec.worker')

beforeAll(async () => {
  vi.stubGlobal('addEventListener', vi.fn())
  vi.stubGlobal('postMessage', vi.fn())
  codec = await import('@renderer/document-adapters/xlsx-codec.worker')
})

describe('XLSX codec qualification', () => {
  it('edits, saves, reopens, and preserves formulas, styles, date mode, and unknown parts', async () => {
    const workbook = createWorkbook({ date1904: true })
    const worksheet = addWorksheet(workbook, 'Forecast')
    const valueCell = setCell(worksheet, 1, 1, 12)
    setCellNumberFormat(workbook, valueCell, '#,##0.00')
    setCellAlignment(workbook, valueCell, makeAlignment({ horizontal: 'center', wrapText: true }))
    setCellBorder(workbook, valueCell, makeBorder({ bottom: makeSide({ style: 'double' }) }))
    const formulaCell = setCell(worksheet, 1, 2, null)
    setFormula(formulaCell, 'A1*2', { cachedValue: 24 })
    const date = new Date('2024-01-15T00:00:00.000Z')
    const dateCell = setCell(worksheet, 2, 1, date)
    setCellNumberFormat(workbook, dateCell, 'yyyy-mm-dd')
    const preservedPart = new TextEncoder().encode('<agent-friendly />')
    workbook.passthrough = new Map([['customXml/item1.xml', preservedPart]])
    workbook.passthroughContentTypes = new Map([
      ['customXml/item1.xml', 'application/xml']
    ])

    const snapshot = codec.workbookToUniverSnapshot(workbook, 'forecast.xlsx')
    const sheetId = snapshot.sheetOrder[0]!
    expect(snapshot.sheets[sheetId]!.cellData![0]![1]!.f).toBe('=A1*2')
    snapshot.sheets[sheetId]!.cellData![0]![0]!.v = 21
    codec.applyUniverSnapshot(workbook, snapshot)
    codec.applyUniverSnapshot(workbook, snapshot)

    const firstSave = await workbookToBytes(workbook)
    const reopened = await loadWorkbook(fromArrayBuffer(firstSave.buffer.slice(
      firstSave.byteOffset,
      firstSave.byteOffset + firstSave.byteLength
    ) as ArrayBuffer))
    const reopenedSheet = reopened.sheets.find((reference) => reference.kind === 'worksheet')
    expect(reopened.sheets.filter((reference) => reference.kind === 'worksheet')).toHaveLength(1)
    expect(reopened.date1904).toBe(true)
    expect(reopenedSheet?.kind).toBe('worksheet')
    if (!reopenedSheet || reopenedSheet.kind !== 'worksheet') throw new Error('Worksheet was not preserved.')
    expect(getCell(reopenedSheet.sheet, 1, 1)?.value).toBe(21)
    expect(getCellNumberFormat(reopened, getCell(reopenedSheet.sheet, 1, 1)!)).toBe('#,##0.00')
    expect(getCellAlignment(reopened, getCell(reopenedSheet.sheet, 1, 1)!)).toMatchObject({
      horizontal: 'center',
      wrapText: true
    })
    expect(getCellBorder(reopened, getCell(reopenedSheet.sheet, 1, 1)!).bottom?.style).toBe('double')
    expect(getFormulaText(getCell(reopenedSheet.sheet, 1, 2)!)).toBe('A1*2')
    expect(getCell(reopenedSheet.sheet, 2, 1)?.value).toBe(dateToExcel(date, { epoch: 'mac' }))
    expect(reopened.calcProperties).toMatchObject({ fullCalcOnLoad: true, forceFullCalc: true })
    expect(reopened.passthrough?.get('customXml/item1.xml')).toEqual(preservedPart)

    const secondSave = await workbookToBytes(reopened)
    const reopenedAgain = await loadWorkbook(fromArrayBuffer(secondSave.buffer.slice(
      secondSave.byteOffset,
      secondSave.byteOffset + secondSave.byteLength
    ) as ArrayBuffer))
    expect(reopenedAgain.passthrough?.get('customXml/item1.xml')).toEqual(preservedPart)
  })

  it('retains a newly created sheet identity over consecutive saves', () => {
    const workbook = createWorkbook()
    addWorksheet(workbook, 'Sheet1')
    const snapshot = codec.workbookToUniverSnapshot(workbook, 'blank.xlsx')
    snapshot.sheetOrder.push('agent-created')
    snapshot.sheets['agent-created'] = {
      id: 'agent-created',
      name: 'Agent Data',
      rowCount: 1000,
      columnCount: 26,
      cellData: { 0: { 0: { v: 'once' } } }
    }

    codec.applyUniverSnapshot(workbook, snapshot)
    codec.applyUniverSnapshot(workbook, snapshot)
    expect(workbook.sheets.filter((reference) => reference.kind === 'worksheet')).toHaveLength(2)
  })

  it('normalizes Univer CSS colors before applying Office styles', () => {
    const workbook = createWorkbook()
    const worksheet = addWorksheet(workbook, 'Colors')
    setCell(worksheet, 1, 1, 'Styled')
    const snapshot = codec.workbookToUniverSnapshot(workbook, 'colors.xlsx')
    snapshot.sheets[snapshot.sheetOrder[0]!]!.cellData![0]![0]!.s = {
      cl: { rgb: '#FFFFFF' },
      bg: { rgb: '#123456' }
    }

    expect(() => codec.applyUniverSnapshot(workbook, snapshot)).not.toThrow()
    const cell = getCell(worksheet, 1, 1)!
    expect(getCellFont(workbook, cell).color?.rgb).toBe('FFFFFFFF')
    expect(getCellFill(workbook, cell)).toMatchObject({
      kind: 'pattern',
      patternType: 'solid',
      fgColor: { rgb: 'FF123456' }
    })
  })

  it('classifies preserve-only and protected workbooks before enabling autosave', () => {
    const preserveOnly = createWorkbook()
    addWorksheet(preserveOnly, 'Sheet1')
    preserveOnly.passthrough = new Map([['customXml/item1.xml', new Uint8Array([1])]])
    expect(codec.classifyWorkbook(preserveOnly)).toMatchObject({
      level: 'preserve-only',
      requiresSaveAs: true,
      reasons: ['custom XML']
    })

    const protectedWorkbook = createWorkbook()
    addWorksheet(protectedWorkbook, 'Sheet1')
    protectedWorkbook.workbookProtection = makeWorkbookProtection({ lockStructure: true })
    expect(codec.classifyWorkbook(protectedWorkbook)).toMatchObject({
      level: 'read-only',
      requiresSaveAs: false,
      reasons: ['workbook structure protection']
    })
  })

  it('round-trips editable filter and validation resources into OOXML models', () => {
    const workbook = createWorkbook()
    const worksheet = addWorksheet(workbook, 'Inputs')
    setAutoFilter(worksheet, makeAutoFilter({
      ref: 'A1:C10',
      filterColumns: [{ kind: 'filters', colId: 1, values: ['Open'], blank: true }]
    }))
    worksheet.dataValidations = [makeDataValidation({
      type: 'list',
      sqref: 'C2:C10',
      formula1: '"Low,Medium,High"',
      allowBlank: true,
      showDropDown: false
    })]

    const snapshot = codec.workbookToUniverSnapshot(workbook, 'inputs.xlsx')
    const filterResource = snapshot.resources?.find((resource) => resource.name === 'SHEET_FILTER_PLUGIN')
    const validationResource = snapshot.resources?.find((resource) => resource.name === 'SHEET_DATA_VALIDATION_PLUGIN')
    expect(filterResource?.data).toContain('Open')
    expect(validationResource?.data).toContain('Low,Medium,High')

    const filters = JSON.parse(filterResource!.data) as Record<string, { filterColumns: Array<{ filters: { filters: string[] } }> }>
    filters[snapshot.sheetOrder[0]!]!.filterColumns[0]!.filters.filters = ['Closed']
    filterResource!.data = JSON.stringify(filters)
    const validations = JSON.parse(validationResource!.data) as Record<string, Array<{ formula1: string }>>
    validations[snapshot.sheetOrder[0]!]![0]!.formula1 = '"Yes,No"'
    validationResource!.data = JSON.stringify(validations)

    codec.applyUniverSnapshot(workbook, snapshot)
    expect(worksheet.autoFilter?.filterColumns[0]?.values).toEqual(['Closed'])
    expect(worksheet.dataValidations[0]?.formula1).toBe('"Yes,No"')
    expect(worksheet.dataValidations[0]?.sqref.ranges[0]).toMatchObject({
      minRow: 2,
      minCol: 3,
      maxRow: 10,
      maxCol: 3
    })
  })

  it('maps external and internal hyperlinks without exposing the Univer runtime', () => {
    const workbook = createWorkbook()
    const inputs = addWorksheet(workbook, 'Inputs')
    addWorksheet(workbook, 'Details')
    setCell(inputs, 1, 1, 'Website')
    setCell(inputs, 2, 1, 'Details')
    setHyperlink(inputs, 'A1', { target: 'https://example.test', display: 'Website', tooltip: 'Open site' })
    setHyperlink(inputs, 'A2', { location: "'Details'!B3", display: 'Details' })

    const snapshot = codec.workbookToUniverSnapshot(workbook, 'links.xlsx')
    const custom = snapshot.sheets[snapshot.sheetOrder[0]!]!.custom as {
      xlsx: { hyperlinks: Array<{ url: string; tooltip?: string }> }
    }
    expect(custom.xlsx.hyperlinks).toEqual([
      expect.objectContaining({ url: 'https://example.test', tooltip: 'Open site' }),
      expect.objectContaining({ url: expect.stringMatching(/^#gid=xlsx-sheet-\d+&range=B3$/) })
    ])

    codec.applyUniverSnapshot(workbook, snapshot)
    expect(inputs.hyperlinks).toEqual([
      expect.objectContaining({ ref: 'A1', target: 'https://example.test', tooltip: 'Open site' }),
      expect.objectContaining({ ref: 'A2', location: "'Details'!B3" })
    ])
  })

  it('round-trips common conditional-formatting rules through the local resource model', () => {
    const workbook = createWorkbook()
    const worksheet = addWorksheet(workbook, 'Scores')
    addConditionalFormatting(worksheet, makeConditionalFormatting({
      sqref: 'B2:B20',
      rules: [
        makeCfRule({
          type: 'cellIs',
          priority: 1,
          operator: 'greaterThan',
          formulas: ['75']
        }),
        makeCfRule({
          type: 'dataBar',
          priority: 2,
          formulas: [],
          innerXml: '<dataBar showValue="1"><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>'
        })
      ]
    }))

    const snapshot = codec.workbookToUniverSnapshot(workbook, 'scores.xlsx')
    const resource = snapshot.resources?.find((candidate) => candidate.name === 'SHEET_CONDITIONAL_FORMATTING_PLUGIN')
    expect(resource?.data).toContain('highlightCell')
    expect(resource?.data).toContain('dataBar')
    const rules = JSON.parse(resource!.data) as Record<string, Array<{ rule: Record<string, unknown> }>>
    rules[snapshot.sheetOrder[0]!]![0]!.rule.value = 90
    resource!.data = JSON.stringify(rules)

    codec.applyUniverSnapshot(workbook, snapshot)
    expect(worksheet.conditionalFormatting.flatMap((formatting) => formatting.rules)).toEqual([
      expect.objectContaining({ type: 'cellIs', operator: 'greaterThan', formulas: ['90'] }),
      expect.objectContaining({ type: 'dataBar', innerXml: expect.stringContaining('FF638EC6') })
    ])
  })
})
