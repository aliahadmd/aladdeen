import type {
  DocumentKind,
  DocumentKindCounts
} from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { PROJECT_DOCUMENT_TYPE_OPTIONS } from '@renderer/lib/project-document-types'
import { DocumentKindIcon } from './DocumentKindIcon'

interface ProjectDocumentTypesProps {
  enabled: ReadonlySet<DocumentKind>
  counts: DocumentKindCounts
  onChange(enabled: Set<DocumentKind>): void
}

export function ProjectDocumentTypes({
  enabled,
  counts,
  onChange
}: ProjectDocumentTypesProps): React.JSX.Element {
  const toggle = (kind: DocumentKind): void => {
    const next = new Set(enabled)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    onChange(next)
  }

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="text-[12px] font-semibold text-foreground">Document types</legend>
      <p className="mt-1 text-[11px] leading-[1.45] text-foreground-muted">
        Choose which formats Aladdeen discovers in this project.
      </p>
      <div className="mt-2.5 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 min-[720px]:grid-cols-4">
        {PROJECT_DOCUMENT_TYPE_OPTIONS.map((option) => {
          const checked = enabled.has(option.kind)
          const count = counts[option.kind]
          return (
            <label
              key={option.kind}
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2.5 outline-none focus-within:ring-2 focus-within:ring-accent-muted',
                checked && 'border-accent-muted bg-[color-mix(in_oklab,var(--accent)_9%,var(--surface))]'
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-accent"
                checked={checked}
                onChange={() => toggle(option.kind)}
              />
              <DocumentKindIcon kind={option.kind} size={14} />
              <span className="min-w-0 flex-1">
                <strong className="block text-[12px] font-semibold text-foreground">{option.label}</strong>
                <small className="mt-0.5 block truncate text-[11px] text-foreground-muted">{option.extensions}</small>
                <small className="mt-1 block text-[11px] tabular-nums text-foreground-muted">
                  {count.toLocaleString()} found
                </small>
              </span>
            </label>
          )
        })}
      </div>
      {enabled.size === 0 && (
        <p className="mt-2 text-[11px] font-medium text-danger" role="alert">
          Choose at least one document type.
        </p>
      )}
    </fieldset>
  )
}
