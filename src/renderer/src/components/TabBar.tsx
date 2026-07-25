import { useRef } from 'react'
import { X } from 'lucide-react'
import {
  documentTabClasses,
  tabBarClasses,
  tabCloseClasses,
  tabNameClasses,
  tabStateClasses
} from '@renderer/lib/ui-styles'
import { isDocumentDirty, useAppStore } from '@renderer/store/app-store'
import { DocumentKindIcon } from './DocumentKindIcon'

export function TabBar(): React.JSX.Element | null {
  const documents = useAppStore((state) => state.documents)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const setActiveFileId = useAppStore((state) => state.setActiveFileId)
  const closeDocument = useAppStore((state) => state.closeDocument)
  const reorderDocument = useAppStore((state) => state.reorderDocument)
  const tabs = useRef(new Map<string, HTMLButtonElement>())

  if (documents.length === 0) return null

  return (
    <div className={tabBarClasses} role="tablist" aria-label="Open documents">
      {documents.map((document) => {
        const active = activeFileId === document.id
        return (
          <div
            key={document.id}
            role="presentation"
            className={documentTabClasses(active)}
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
            title={document.fullPath}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              ref={(element) => {
                if (element) tabs.current.set(document.id, element)
                else tabs.current.delete(document.id)
              }}
              className="col-span-3 grid h-full min-w-0 grid-cols-subgrid items-center gap-[6px] border-0 bg-transparent p-0 text-inherit"
              onClick={() => setActiveFileId(document.id)}
              onKeyDown={(event) => {
                const index = documents.findIndex((candidate) => candidate.id === document.id)
                let targetIndex: number | undefined
                if (event.key === 'ArrowLeft') targetIndex = Math.max(0, index - 1)
                if (event.key === 'ArrowRight') targetIndex = Math.min(documents.length - 1, index + 1)
                if (event.key === 'Home') targetIndex = 0
                if (event.key === 'End') targetIndex = documents.length - 1
                const target = targetIndex === undefined ? undefined : documents[targetIndex]
                if (!target) return
                event.preventDefault()
                setActiveFileId(target.id)
                tabs.current.get(target.id)?.focus()
              }}
            >
              <DocumentKindIcon kind={document.documentKind} />
              <span className={tabNameClasses}>{document.name}</span>
              <span className={tabStateClasses(document.status)} aria-label={document.status}>
                {isDocumentDirty(document) ? '•' : ''}
              </span>
            </button>
            <button
              type="button"
              className={tabCloseClasses(active)}
              aria-label={`Close ${document.name}`}
              onClick={(event) => {
                event.stopPropagation()
                void closeDocument(document.id)
              }}
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
