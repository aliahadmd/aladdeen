import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FileText, FolderOpen, FolderPlus, Plus, SlidersHorizontal } from 'lucide-react'
import type { DocumentKind } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  dropdownContentClasses, dropdownItemClasses, dropdownLabelClasses,
  dropdownSeparatorClasses, sidebarActionButtonClasses
} from '@renderer/lib/ui-styles'
import { DocumentKindMenuItems } from './DocumentKindMenuItems'

interface SidebarActionsProps {
  destination?: string
  enabledDocumentKinds?: readonly DocumentKind[]
  onAddFolder(): void
  onOpenFile(): void
  onCreateDocument(kind: Exclude<DocumentKind, 'pdf'>): void
  onCreateFolder(): void
  onCreateProject(): void
  onManageTypes?(): void
}

export function SidebarActions({ destination, enabledDocumentKinds, onAddFolder, onOpenFile, onCreateDocument, onCreateFolder, onCreateProject, onManageTypes }: SidebarActionsProps): React.JSX.Element {
  return (
    <div className="sidebar-actions mx-[9px] grid shrink-0 grid-cols-2 gap-1.5 pt-[3px] pb-2" role="group" aria-label="Workspace actions">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={sidebarActionButtonClasses} title="Open existing documents">
            <FolderOpen size={15} aria-hidden="true" /><span>Open</span><ChevronDown size={12} className="ml-auto" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={cn(dropdownContentClasses, 'sidebar-action-menu min-w-[224px]')} sideOffset={5} align="start" collisionPadding={12}>
            <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onAddFolder}>
              <FolderOpen size={14} aria-hidden="true" /> Add folder…<span className="sidebar-menu-shortcut" aria-hidden="true">⇧⌘O</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onOpenFile}>
              <FileText size={14} aria-hidden="true" /> Open file…<span className="sidebar-menu-shortcut" aria-hidden="true">⌘O</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={sidebarActionButtonClasses} title="Create a document or folder">
            <Plus size={15} aria-hidden="true" /><span>New</span><ChevronDown size={12} className="ml-auto" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={cn(dropdownContentClasses, 'sidebar-action-menu min-w-[224px] max-w-[min(320px,calc(100vw-24px))]')} sideOffset={5} align="end" collisionPadding={12}>
            <DropdownMenu.Label className={cn(dropdownLabelClasses, 'sidebar-menu-destination')} title={destination}>
              {destination ? `In ${destination}` : 'New document'}
            </DropdownMenu.Label>
            <DocumentKindMenuItems enabledKinds={enabledDocumentKinds} onSelect={onCreateDocument} />
            <DropdownMenu.Separator className={dropdownSeparatorClasses} />
            <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onCreateFolder}>
              <FolderPlus size={14} aria-hidden="true" />{destination ? 'New subfolder…' : 'New folder…'}
            </DropdownMenu.Item>
            {destination && <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onCreateProject}>
              <FolderPlus size={14} aria-hidden="true" /> New project folder…
            </DropdownMenu.Item>}
            {onManageTypes && <>
              <DropdownMenu.Separator className={dropdownSeparatorClasses} />
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onManageTypes}>
                <SlidersHorizontal size={14} aria-hidden="true" /> Manage file types…
              </DropdownMenu.Item>
            </>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
