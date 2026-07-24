import { lazy, Suspense, useDeferredValue } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { AlertCircle, CheckCircle2, CloudOff, LoaderCircle, PencilLine } from 'lucide-react'
import { MarkdownPreview } from './MarkdownPreview'
import { DocumentActions } from './DocumentActions'
import { Welcome } from './Welcome'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useMediaQuery } from '@renderer/hooks/use-media-query'
import { cn } from '@renderer/lib/cn'
import { COMPACT_WORKSPACE_QUERY } from '@renderer/lib/breakpoints'
import { useAppStore } from '@renderer/store/app-store'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then((module) => ({
  default: module.MarkdownEditor
})))

export function DocumentView(): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const documents = useAppStore((state) => state.documents)
  const editing = useAppStore((state) => state.editing)
  const mobilePane = useAppStore((state) => state.mobilePane)
  const setMobilePane = useAppStore((state) => state.setMobilePane)
  const dark = useEffectiveDarkMode()
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY)
  const document = documents.find((candidate) => candidate.id === activeFileId)
  const deferredContent = useDeferredValue(document?.content ?? '')

  if (!document) return <Welcome />

  const previewDocument = deferredContent === document.content
    ? document
    : { ...document, content: deferredContent }
  const words = deferredContent.trim() ? deferredContent.trim().split(/\s+/u).length : 0
  const editor = (
    <Suspense fallback={<div className="h-full min-h-0 bg-surface" aria-label="Loading Markdown editor" />}>
      <MarkdownEditor document={document} dark={dark} />
    </Suspense>
  )
  const preview = (
    <MarkdownPreview
      document={previewDocument}
      sourceNavigationReady={deferredContent === document.content}
    />
  )

  return (
    <section className={cn(
      'document-workspace relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_27px] bg-surface-elevated',
      editing && 'max-[959px]:grid-rows-[35px_minmax(0,1fr)_27px]'
    )}>
      <DocumentActions />
      {editing && (
        <div className="compact-pane-switch hidden items-center justify-center gap-0.5 border-b border-border bg-surface max-[959px]:flex" role="tablist" aria-label="Document view">
          <button className={cn('h-[25px] rounded-md border-0 bg-transparent px-[14px] text-[11px] font-semibold text-foreground-muted', mobilePane === 'editor' && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.08)]')} onClick={() => setMobilePane('editor')}>
            Editor
          </button>
          <button className={cn('h-[25px] rounded-md border-0 bg-transparent px-[14px] text-[11px] font-semibold text-foreground-muted', mobilePane === 'preview' && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.08)]')} onClick={() => setMobilePane('preview')}>
            Preview
          </button>
        </div>
      )}

      <div className={cn('document-main h-full min-h-0 min-w-0', editing ? 'is-editing' : 'is-preview-only')}>
        {editing ? (
          compact ? (
            <div className="h-full min-h-0 min-w-0">
              {mobilePane === 'editor' ? (
                editor
              ) : (
                preview
              )}
            </div>
          ) : (
            <div className="h-full min-h-0 min-w-0 max-[959px]:hidden">
              <PanelGroup direction="horizontal" autoSaveId="aladdeen-editor-split">
                <Panel defaultSize={44} minSize={28} maxSize={70}>
                  {editor}
                </Panel>
                <PanelResizeHandle className="relative w-px bg-border after:absolute after:inset-y-0 after:left-0 after:z-[2] after:w-[7px] after:content-[''] data-[resize-handle-active]:bg-accent" />
                <Panel defaultSize={56} minSize={30}>
                  {preview}
                </Panel>
              </PanelGroup>
            </div>
          )
        ) : (
          preview
        )}
      </div>

      <footer className="flex min-w-0 select-none items-center justify-between border-t border-border bg-surface px-[10px] text-[9px] text-foreground-muted">
        <SaveStatus status={document.status} error={document.error} />
        <div className="flex min-w-0 items-center gap-[13px] whitespace-nowrap max-[700px]:gap-2">
          <span>{words.toLocaleString()} words</span>
          <span className="max-[700px]:hidden">{document.content.length.toLocaleString()} characters</span>
          <span>UTF-8 · {document.revision.lineEnding}</span>
        </div>
      </footer>
    </section>
  )
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
