import { describe, expect, it } from 'vitest'
import { isWorkbookMutationCommand } from '@renderer/document-adapters/xlsx-mutations'

describe('XLSX dirty-state command classification', () => {
  it('marks content, structure, filter, undo, and redo commands as mutations', () => {
    for (const id of [
      'sheet.command.set-range-values',
      'sheet.command.set-bold',
      'sheet.command.delta-row-height',
      'sheet.command.rename',
      'sheet.command.set-filter',
      'sheet.command.undo',
      'sheet.command.redo'
    ]) expect(isWorkbookMutationCommand(id)).toBe(true)
  })

  it('does not dirty the workbook for selection and viewport commands', () => {
    for (const id of [
      'sheet.operation.set-selection',
      'sheet.operation.scroll',
      'sheet.operation.activate',
      'sheet.operation.zoom',
      'doc.command-replace-snapshot',
      'formula.mutation.set-formula-calculation-notification'
    ]) expect(isWorkbookMutationCommand(id)).toBe(false)
  })
})
