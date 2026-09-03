import { Component, Suspense, useDeferredValue, useMemo, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, CloudOff, LoaderCircle, Save } from 'lucide-react'
import { DocumentAdapterRegistry } from '@renderer/document-adapters/registry'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type { OpenDocument, TextOpenDocument } from '@shared/contracts'
import { DocumentActions } from './DocumentActions'
import { Welcome } from './Welcome'

export function DocumentView(): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const saveDocument = useAppStore((state) => state.saveDocument)
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
        <DocumentAdapterBoundary key={document.id} document={document}>
          <Suspense fallback={<AdapterLoading document={document} />}>
            <Adapter document={document} />
          </Suspense>
        </DocumentAdapterBoundary>
      </div>

      <footer className="flex min-w-0 select-none items-center justify-between border-t border-border bg-surface px-[10px] text-[9px] text-foreground-muted">
        <SaveStatus status={document.status} error={document.error} onSave={() => void saveDocument(document.id)} />
        <DocumentFacts document={document} />
      </footer>
    </section>
  )
}

class DocumentAdapterBoundary extends Component<{
  document: OpenDocument
  children: ReactNode
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Document adapter failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full min-h-0 place-items-center bg-surface-elevated p-8 text-center">
        <div className="max-w-md">
          <AlertCircle className="mx-auto text-danger" size={24} />
          <strong className="mt-3 block text-[14px] text-foreground">
            Could not display {this.props.document.name}
          </strong>
          <span className="mt-1.5 block text-[11px] leading-relaxed text-foreground-muted">
            {this.state.error.message || 'The document editor stopped unexpectedly.'}
          </span>
          <button
            type="button"
            className="mt-4 h-8 rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground hover:bg-surface-hover"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}

function AdapterLoading({ document }: { document: OpenDocument }): React.JSX.Element {
  const label = document.documentKind === 'docx'
    ? 'Word editor'
    : document.documentKind === 'pdf'
      ? 'PDF viewer'
      : document.documentKind === 'xlsx'
        ? 'spreadsheet editor'
      : document.documentKind === 'pptx'
        ? 'presentation editor'
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
    return <TextDocumentFacts document={document} />
  }

  return (
    <div className="flex min-w-0 items-center gap-[13px] whitespace-nowrap max-[700px]:gap-2">
      <span>{document.documentKind === 'docx'
        ? 'Word document'
        : document.documentKind === 'xlsx'
          ? 'Excel workbook'
          : document.documentKind === 'pptx'
            ? 'PowerPoint presentation'
            : 'PDF document'}</span>
      <span className="max-[700px]:hidden">{formatBytes(document.session.byteLength)}</span>
      <span>{document.documentKind.toUpperCase()}</span>
    </div>
  )
}

function TextDocumentFacts({ document }: { document: TextOpenDocument }): React.JSX.Element {
  const content = useDeferredValue(document.content)
  const words = useMemo(() => {
    const trimmed = content.trim()
    return trimmed ? trimmed.split(/\s+/u).length : 0
  }, [content])
  return (
    <div className="flex min-w-0 items-center gap-[13px] whitespace-nowrap max-[700px]:gap-2">
      <span>{words.toLocaleString()} words</span>
      <span className="max-[700px]:hidden">{content.length.toLocaleString()} characters</span>
      <span>UTF-8 · {document.revision.lineEnding ?? 'LF'}</span>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function SaveStatus({ status, error, onSave }: { status: string; error?: string; onSave(): void }): React.JSX.Element {
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
      <button
        type="button"
        className={cn(classes, 'cursor-pointer rounded-[5px] border-0 bg-transparent px-[5px] py-[2px] font-semibold text-accent transition-colors hover:bg-accent-soft')}
        onClick={onSave}
        title="Save (⌘S)"
      >
        <Save size={13} /> Unsaved — Save
      </button>
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
