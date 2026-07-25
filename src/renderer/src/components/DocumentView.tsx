import { Suspense } from 'react'
import { AlertCircle, CheckCircle2, CloudOff, LoaderCircle, PencilLine } from 'lucide-react'
import { DocumentAdapterRegistry } from '@renderer/document-adapters/registry'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type { OpenDocument } from '@shared/contracts'
import { DocumentActions } from './DocumentActions'
import { Welcome } from './Welcome'

export function DocumentView(): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const document = useAppStore((state) => (
    state.documents.find((candidate) => candidate.id === activeFileId)
  ))

  if (!document) return <Welcome />

  const adapter = DocumentAdapterRegistry[document.documentKind]
  const Adapter = adapter.component

  return (
    <section className="document-workspace relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_27px] bg-surface-elevated">
      {document.documentKind === 'markdown' && <DocumentActions />}
      <div className="document-main h-full min-h-0 min-w-0">
        <Suspense fallback={<AdapterLoading document={document} />}>
          <Adapter document={document} />
        </Suspense>
      </div>

      <footer className="flex min-w-0 select-none items-center justify-between border-t border-border bg-surface px-[10px] text-[9px] text-foreground-muted">
        <SaveStatus status={document.status} error={document.error} />
        <DocumentFacts document={document} />
      </footer>
    </section>
  )
}

function AdapterLoading({ document }: { document: OpenDocument }): React.JSX.Element {
  const label = document.documentKind === 'docx'
    ? 'Word editor'
    : document.documentKind === 'pdf'
      ? 'PDF viewer'
      : document.documentKind === 'html'
        ? 'HTML editor'
        : 'Markdown editor'
  return (
    <div className="grid h-full min-h-0 place-items-center bg-surface-elevated text-[12px] text-foreground-muted">
      <span className="flex items-center gap-2">
        <LoaderCircle className="spinner" size={16} />
        Loading {label}…
      </span>
    </div>
  )
}

function DocumentFacts({ document }: { document: OpenDocument }): React.JSX.Element {
  if ('content' in document) {
    const words = document.content.trim() ? document.content.trim().split(/\s+/u).length : 0
    return (
      <div className="flex min-w-0 items-center gap-[13px] whitespace-nowrap max-[700px]:gap-2">
        <span>{words.toLocaleString()} words</span>
        <span className="max-[700px]:hidden">{document.content.length.toLocaleString()} characters</span>
        <span>UTF-8 · {document.revision.lineEnding ?? 'LF'}</span>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-[13px] whitespace-nowrap max-[700px]:gap-2">
      <span>{document.documentKind === 'docx' ? 'Word document' : 'PDF document'}</span>
      <span className="max-[700px]:hidden">{formatBytes(document.session.byteLength)}</span>
      <span>{document.documentKind.toUpperCase()}</span>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function SaveStatus({ status, error }: { status: string; error?: string }): React.JSX.Element {
  const classes = cn(
    'flex shrink-0 items-center gap-[5px]',
    status === 'saved' && 'text-success',
    status === 'conflict' && 'text-warning',
    status === 'error' && 'text-danger'
  )
  if (status === 'saving') {
    return (
      <span className={classes}>
        <LoaderCircle size={13} className="spinner" /> Saving
      </span>
    )
  }
  if (status === 'editing') {
    return (
      <span className={classes}>
        <PencilLine size={13} /> Editing
      </span>
    )
  }
  if (status === 'conflict') {
    return (
      <span className={classes} title={error}>
        <CloudOff size={13} /> Conflict
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className={classes} title={error}>
        <AlertCircle size={13} /> Save error
      </span>
    )
  }
  return (
    <span className={classes}>
      <CheckCircle2 size={13} /> Saved
    </span>
  )
}
