import { describe, expect, it, vi } from 'vitest'
import type { FUniver } from '@univerjs/core/lib/facade'
import { UniverSpreadsheetDocumentApi } from '@renderer/document-adapters/spreadsheet-api'
import { getDocumentTransactions } from '@renderer/document-adapters/runtime'

function createFacade() {
  const range = {
    getValues: vi.fn(() => [[1]]),
    getFormulas: vi.fn(() => [['']]),
    setValues: vi.fn(),
    setFormulas: vi.fn(),
    clear: vi.fn()
  }
  const sheet = {
    getSheetId: vi.fn(() => 'sheet-1'),
    getSheetName: vi.fn(() => 'Sheet1'),
    getRange: vi.fn(() => range),
    activate: vi.fn(),
    setActiveRange: vi.fn(),
    setName: vi.fn()
  }
  const workbook = {
    getSheets: vi.fn(() => [sheet]),
    getSheetByName: vi.fn((name: string) => name === 'Sheet1' ? sheet : undefined),
    insertSheet: vi.fn(() => sheet),
    deleteSheet: vi.fn(() => true),
    moveSheet: vi.fn(),
    save: vi.fn(() => ({ sheetOrder: [], sheets: {}, styles: {} }))
  }
  const facade = { getActiveWorkbook: vi.fn(() => workbook) } as unknown as FUniver
  return { facade, range, sheet, workbook }
}

describe('engine-neutral spreadsheet API', () => {
  it('validates bounded A1 input and records agent mutations without exposing an IPC API', () => {
    const { facade, range } = createFacade()
    const onMutation = vi.fn()
    const api = new UniverSpreadsheetDocumentApi(facade, 'agent-sheet', () => 'revision-1', onMutation)

    api.setValues('Sheet1', 'A1:B1', [[1, 2]])
    expect(range.setValues).toHaveBeenCalledWith([[1, 2]])
    expect(onMutation).toHaveBeenCalledOnce()
    expect(getDocumentTransactions('agent-sheet').at(-1)).toMatchObject({
      actor: 'agent',
      documentKind: 'xlsx',
      undoGroup: 'set-values:Sheet1!A1:B1'
    })
    expect(() => api.setFormulas('Sheet1', 'A1', [['SUM(B1:B2)']])).toThrow(/begin with =/i)
    expect(() => api.getRange('Sheet1', 'A:A')).toThrow(/bounded A1/i)
    expect('univerAPI' in window).toBe(false)
  })

  it('allows selection without a transaction and blocks mutation for read-only workbooks', () => {
    const { facade, sheet } = createFacade()
    const api = new UniverSpreadsheetDocumentApi(facade, 'read-only-sheet', () => 'revision-1', vi.fn(), () => false)
    api.selectRange('Sheet1', 'C3')
    expect(sheet.activate).toHaveBeenCalledOnce()
    expect(sheet.setActiveRange).toHaveBeenCalledOnce()
    expect(getDocumentTransactions('read-only-sheet')).toHaveLength(0)
    expect(() => api.clearRange('Sheet1', 'C3')).toThrow(/read-only/i)
  })
})
