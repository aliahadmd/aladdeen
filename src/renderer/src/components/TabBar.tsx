import { FileText, X } from 'lucide-react'
import { isDocumentDirty, useAppStore } from '@renderer/store/app-store'

export function TabBar(): React.JSX.Element | null {
  const documents = useAppStore((state) => state.documents)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const setActiveFileId = useAppStore((state) => state.setActiveFileId)
  const closeDocument = useAppStore((state) => state.closeDocument)
  const reorderDocument = useAppStore((state) => state.reorderDocument)

  if (documents.length === 0) return null

  return (
    <div className="tabbar" role="tablist" aria-label="Open documents">
      {documents.map((document) => (
        <button
          key={document.id}
          className={`document-tab ${activeFileId === document.id ? 'is-active' : ''}`}
          role="tab"
          aria-selected={activeFileId === document.id}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/fluidmd-tab', document.id)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const source = event.dataTransfer.getData('text/fluidmd-tab')
            if (source) reorderDocument(source, document.id)
          }}
          onClick={() => setActiveFileId(document.id)}
          title={document.fullPath}
        >
          <FileText size={14} />
          <span className="tab-name">{document.name}</span>
          <span className={`tab-state state-${document.status}`} aria-label={document.status}>
            {isDocumentDirty(document) ? '•' : ''}
          </span>
          <span
            className="tab-close"
            role="button"
            tabIndex={0}
            aria-label={`Close ${document.name}`}
            onClick={(event) => {
              event.stopPropagation()
              void closeDocument(document.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation()
                void closeDocument(document.id)
              }
            }}
          >
            <X size={13} />
          </span>
        </button>
      ))}
    </div>
  )
}
