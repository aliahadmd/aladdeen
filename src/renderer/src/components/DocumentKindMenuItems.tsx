import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FileCode2, FileText, SlidersHorizontal } from 'lucide-react'
import type { DocumentKind } from '@shared/contracts'
import { dropdownItemClasses, dropdownSeparatorClasses } from '@renderer/lib/ui-styles'
import { DocumentKindIcon } from './DocumentKindIcon'

export function DocumentKindMenuItems({ enabledKinds, onSelect, onManage }: {
  enabledKinds?: readonly DocumentKind[]
  onSelect(kind: Exclude<DocumentKind, 'pdf'>): void
  onManage?(): void
}): React.JSX.Element {
  const enabled = new Set<DocumentKind>(enabledKinds ?? ['markdown', 'html', 'docx', 'xlsx', 'pptx'])
  const kinds = [
    ['markdown', 'Markdown'], ['html', 'HTML'], ['docx', 'Word document'],
    ['xlsx', 'Excel workbook'], ['pptx', 'PowerPoint presentation']
  ] as const
  const available = kinds.filter(([kind]) => enabled.has(kind))
  return <>
    {available.map(([kind, label]) => (
      <DropdownMenu.Item key={kind} className={dropdownItemClasses()} onSelect={() => onSelect(kind)}>
        {kind === 'html' ? <FileCode2 size={14} aria-hidden="true" />
          : kind === 'markdown' || kind === 'docx' ? <FileText size={14} aria-hidden="true" />
            : <DocumentKindIcon kind={kind} size={14} />}
        {label}
      </DropdownMenu.Item>
    ))}
    {onManage && <>
      {available.length > 0 && <DropdownMenu.Separator className={dropdownSeparatorClasses} />}
      <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onManage}>
        <SlidersHorizontal size={14} aria-hidden="true" /> Manage file types…
      </DropdownMenu.Item>
    </>}
  </>
}
