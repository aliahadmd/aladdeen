import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ALargeSmall, ChevronDown, Download, Edit3, Eye, FileDown, Minus, Plus, RotateCcw, SaveAll } from 'lucide-react'
import {
  DEFAULT_READING_SETTINGS,
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN
} from '@shared/reading'
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
  const readingFontSize = useAppStore((state) => state.settings.readingFontSize)
  const readingColumnWidth = useAppStore((state) => state.settings.readingColumnWidth)
  const updateSettings = useAppStore((state) => state.updateSettings)

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

        <Popover.Root>
          <ActionTip label="Reading appearance">
            <Popover.Trigger asChild>
              <button className={documentActionButtonClasses()} aria-label="Reading controls">
                <ALargeSmall size={16} />
                <span>Reading</span>
              </button>
            </Popover.Trigger>
          </ActionTip>
          <Popover.Portal>
            <Popover.Content
              className={`${dropdownContentClasses} w-[238px] p-3 outline-none`}
              sideOffset={7}
              align="end"
              aria-label="Reading controls"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-[650] text-foreground">Text size</span>
                <span className="text-[10px] font-[620] tabular-nums text-foreground-muted" aria-live="polite">{readingFontSize} px</span>
              </div>
              <div className="mt-2 grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2">
                <button
                  className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-foreground-soft hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  aria-label="Decrease reading text size"
                  disabled={readingFontSize <= READING_FONT_SIZE_MIN}
                  onClick={() => void updateSettings({ readingFontSize: Math.max(READING_FONT_SIZE_MIN, readingFontSize - 1) })}
                >
                  <Minus size={14} />
                </button>
                <div className="h-px bg-border" aria-hidden="true" />
                <button
                  className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-foreground-soft hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  aria-label="Increase reading text size"
                  disabled={readingFontSize >= READING_FONT_SIZE_MAX}
                  onClick={() => void updateSettings({ readingFontSize: Math.min(READING_FONT_SIZE_MAX, readingFontSize + 1) })}
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="my-3 h-px bg-border" />
              <span className="text-[11px] font-[650] text-foreground">Reading column</span>
              <div className="mt-2 grid grid-cols-3 gap-[3px] rounded-lg border border-border bg-surface p-[3px]" role="group" aria-label="Reading column width">
                {([
                  ['narrow', 'Narrow'],
                  ['comfortable', 'Comfort'],
                  ['wide', 'Wide']
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={`min-h-8 rounded-md border-0 px-1 text-[10px] font-semibold transition-colors ${readingColumnWidth === value ? 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.1)]' : 'bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground'}`}
                    type="button"
                    aria-pressed={readingColumnWidth === value}
                    onClick={() => void updateSettings({ readingColumnWidth: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                className="mt-3 inline-flex h-8 w-full items-center justify-center gap-[7px] rounded-md border border-border bg-surface text-[10px] font-[620] text-foreground-soft hover:bg-surface-hover hover:text-foreground"
                type="button"
                onClick={() => void updateSettings({ ...DEFAULT_READING_SETTINGS })}
              >
                <RotateCcw size={13} /> Reset reading preferences
              </button>
              <Popover.Arrow className="fill-border" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

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
