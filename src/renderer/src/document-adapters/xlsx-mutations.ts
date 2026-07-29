export function isWorkbookMutationCommand(commandId: string): boolean {
  const id = commandId.toLowerCase()
  if (
    id.includes('selection') ||
    id.includes('scroll') ||
    id.includes('activate') ||
    id.includes('focus') ||
    id.includes('hover') ||
    id.includes('zoom') ||
    id.includes('calculate') ||
    id.includes('calculation') ||
    id.includes('render') ||
    id.includes('replace-snapshot') ||
    id.includes('open-dialog')
  ) return false
  return [
    '.set-', '.reset-', '.delta-', '.auto-', '.toggle-', '.numfmt.', 'set-range',
    'set-cell', 'paste', 'cut', 'clear', 'insert', 'delete', 'remove', 'replace',
    'move', 'merge', 'unmerge', 'hide', 'show', 'freeze', 'filter', 'sort',
    'validation', 'conditional', 'hyper-link', 'undo', 'redo', 'sheet.command.add',
    'sheet.command.rename', 'copy-down', 'copy-right', 'copy-formula', 'refill',
    'apply-format', 'cancel-frozen', 'repeat-last-action', 'split-text', 'text-to-number'
  ].some((marker) => id.includes(marker))
}
