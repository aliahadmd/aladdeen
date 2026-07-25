import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown, Download, Edit3, Eye, FileDown, SaveAll } from 'lucide-react'
import {
  documentActionButtonClasses,
  documentActionsClasses,
  dropdownContentClasses,
  dropdownItemClasses,
  itemHintClasses,
  tooltipArrowClasses,
  tooltipContentClasses
} from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'

export function DocumentActions(): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const documentKind = useAppStore((state) => (
    state.documents.find((document) => document.id === activeFileId)?.documentKind
  ))
  const editing = useAppStore((state) => state.editing)
  const setEditing = useAppStore((state) => state.setEditing)
  const exportActive = useAppStore((state) => state.exportActive)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)

  if (documentKind !== 'markdown') return <></>

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={100}>
      <div className={documentActionsClasses} aria-label="Document actions">
        <ActionTip label={editing ? 'Return to preview' : 'Edit Markdown'}>
          <button
            className={documentActionButtonClasses(editing)}
            onClick={() => setEditing(!editing)}
            aria-label={editing ? 'Preview' : 'Edit'}
            aria-pressed={editing}
          >
            {editing ? <Eye size={15} /> : <Edit3 size={15} />}
            <span>{editing ? 'Preview' : 'Edit'}</span>
          </button>
        </ActionTip>

        <DropdownMenu.Root>
          <ActionTip label="Export document">
            <DropdownMenu.Trigger asChild>
              <button className={documentActionButtonClasses()} aria-label="Export">
                <Download size={15} />
                <span>Export</span>
                <ChevronDown className="action-chevron -ml-0.5" size={12} />
              </button>
            </DropdownMenu.Trigger>
          </ActionTip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={dropdownContentClasses} sideOffset={7} align="end">
              <DropdownMenu.Item
                className={dropdownItemClasses()}
                onSelect={() => activeFileId && void saveDocumentAs(activeFileId)}
              >
                <SaveAll size={15} />
                Save As…
                <span className={itemHintClasses}>Copy</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => void exportActive('pdf')}>
                <FileDown size={15} />
                Export as PDF
                <span className={itemHintClasses}>A4</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => void exportActive('docx')}>
                <FileDown size={15} />
                Export as DOCX
                <span className={itemHintClasses}>Word</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </Tooltip.Provider>
  )
}

function ActionTip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={tooltipContentClasses} sideOffset={7}>
          {label}
          <Tooltip.Arrow className={tooltipArrowClasses} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
