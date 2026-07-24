import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { AlertCircle, CheckCircle2, CloudOff, LoaderCircle, PencilLine } from 'lucide-react'
import { MarkdownEditor } from './MarkdownEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { DocumentActions } from './DocumentActions'
import { Welcome } from './Welcome'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useMediaQuery } from '@renderer/hooks/use-media-query'
import { useAppStore } from '@renderer/store/app-store'

export function DocumentView(): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const documents = useAppStore((state) => state.documents)
  const editing = useAppStore((state) => state.editing)
  const mobilePane = useAppStore((state) => state.mobilePane)
  const setMobilePane = useAppStore((state) => state.setMobilePane)
  const dark = useEffectiveDarkMode()
  const compact = useMediaQuery('(max-width: 959px)')
  const document = documents.find((candidate) => candidate.id === activeFileId)

  if (!document) return <Welcome />

  const words = document.content.trim() ? document.content.trim().split(/\s+/u).length : 0

  return (
    <section className="document-workspace">
      <DocumentActions />
      {editing && (
        <div className="compact-pane-switch" role="tablist" aria-label="Document view">
          <button className={mobilePane === 'editor' ? 'is-active' : ''} onClick={() => setMobilePane('editor')}>
            Editor
          </button>
          <button className={mobilePane === 'preview' ? 'is-active' : ''} onClick={() => setMobilePane('preview')}>
            Preview
          </button>
        </div>
      )}

      <div className={`document-main ${editing ? 'is-editing' : 'is-preview-only'}`}>
        {editing ? (
          compact ? (
            <div className="compact-document-pane">
              {mobilePane === 'editor' ? (
                <MarkdownEditor document={document} dark={dark} />
              ) : (
                <MarkdownPreview document={document} />
              )}
            </div>
          ) : (
            <div className="wide-split">
              <PanelGroup direction="horizontal" autoSaveId="aladdeen-editor-split">
                <Panel defaultSize={44} minSize={28} maxSize={70}>
                  <MarkdownEditor document={document} dark={dark} />
                </Panel>
                <PanelResizeHandle className="resize-handle" />
                <Panel defaultSize={56} minSize={30}>
                  <MarkdownPreview document={document} />
                </Panel>
              </PanelGroup>
            </div>
          )
        ) : (
          <MarkdownPreview document={document} />
        )}
      </div>

      <footer className="document-statusbar">
        <SaveStatus status={document.status} error={document.error} />
        <div className="document-stats">
          <span>{words.toLocaleString()} words</span>
          <span>{document.content.length.toLocaleString()} characters</span>
          <span>UTF-8 · {document.revision.lineEnding}</span>
        </div>
      </footer>
    </section>
  )
}

function SaveStatus({ status, error }: { status: string; error?: string }): React.JSX.Element {
  if (status === 'saving') {
    return (
      <span className="save-status is-saving">
        <LoaderCircle size={13} className="spinner" /> Saving
      </span>
    )
  }
  if (status === 'editing') {
    return (
      <span className="save-status">
        <PencilLine size={13} /> Editing
      </span>
    )
  }
  if (status === 'conflict') {
    return (
      <span className="save-status is-warning" title={error}>
        <CloudOff size={13} /> Conflict
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="save-status is-error" title={error}>
        <AlertCircle size={13} /> Save error
      </span>
    )
  }
  return (
    <span className="save-status is-saved">
      <CheckCircle2 size={13} /> Saved
    </span>
  )
}
