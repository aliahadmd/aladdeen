import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown, Download, Edit3, Eye, FileDown } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

export function DocumentActions(): React.JSX.Element {
  const editing = useAppStore((state) => state.editing)
  const setEditing = useAppStore((state) => state.setEditing)
  const exportActive = useAppStore((state) => state.exportActive)

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={100}>
      <div className="document-actions" aria-label="Document actions">
        <ActionTip label={editing ? 'Return to preview' : 'Edit Markdown'}>
          <button
            className={`document-action-button ${editing ? 'is-active' : ''}`}
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
              <button className="document-action-button export-action" aria-label="Export">
                <Download size={15} />
                <span>Export</span>
                <ChevronDown className="action-chevron" size={12} />
              </button>
            </DropdownMenu.Trigger>
          </ActionTip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" sideOffset={7} align="end">
              <DropdownMenu.Item className="dropdown-item" onSelect={() => void exportActive('pdf')}>
                <FileDown size={15} />
                Export as PDF
                <span className="item-hint">A4</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item" onSelect={() => void exportActive('docx')}>
                <FileDown size={15} />
                Export as DOCX
                <span className="item-hint">Word</span>
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
        <Tooltip.Content className="tooltip-content" sideOffset={7}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
