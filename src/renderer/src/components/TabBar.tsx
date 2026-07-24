import { FileText, X } from 'lucide-react'
import {
  documentTabClasses,
  tabBarClasses,
  tabCloseClasses,
  tabNameClasses,
  tabStateClasses
} from '@renderer/lib/ui-styles'
import { isDocumentDirty, useAppStore } from '@renderer/store/app-store'

export function TabBar(): React.JSX.Element | null {
  const documents = useAppStore((state) => state.documents)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const setActiveFileId = useAppStore((state) => state.setActiveFileId)
  const closeDocument = useAppStore((state) => state.closeDocument)
  const reorderDocument = useAppStore((state) => state.reorderDocument)

  if (documents.length === 0) return null

  return (
    <div className={tabBarClasses} role="tablist" aria-label="Open documents">
      {documents.map((document) => {
        const active = activeFileId === document.id
        return (
          <button
            key={document.id}
            className={documentTabClasses(active)}
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/aladdeen-tab', document.id)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const source = event.dataTransfer.getData('text/aladdeen-tab')
              if (source) reorderDocument(source, document.id)
            }}
            onClick={() => setActiveFileId(document.id)}
            title={document.fullPath}
          >
            <FileText size={14} />
            <span className={tabNameClasses}>{document.name}</span>
            <span className={tabStateClasses(document.status)} aria-label={document.status}>
              {isDocumentDirty(document) ? '•' : ''}
            </span>
            <span
              className={tabCloseClasses(active)}
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
        )
      })}
    </div>
  )
}
