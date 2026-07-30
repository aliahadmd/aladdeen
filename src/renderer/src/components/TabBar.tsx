import { useRef } from 'react'
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import {
  documentTabClasses,
  tabBarClasses,
  tabCloseClasses,
  tabNameClasses,
  sidebarIconButtonClasses,
  tabStateClasses
} from '@renderer/lib/ui-styles'
import { isDocumentDirty, useAppStore } from '@renderer/store/app-store'
import { useMediaQuery } from '@renderer/hooks/use-media-query'
import { COMPACT_WORKSPACE_QUERY } from '@renderer/lib/breakpoints'
import { DocumentKindIcon } from './DocumentKindIcon'

interface TabSummary {
  id: string
  name: string
  fullPath: string
  documentKind: Parameters<typeof DocumentKindIcon>[0]['kind']
  status: string
  dirty: boolean
}

let priorTabs: TabSummary[] = []

function selectTabs(state: ReturnType<typeof useAppStore.getState>): TabSummary[] {
  const next = state.documents.map((document) => ({
    id: document.id,
    name: document.name,
    fullPath: document.fullPath,
    documentKind: document.documentKind,
    status: document.status,
    dirty: isDocumentDirty(document)
  }))
  if (
    next.length === priorTabs.length &&
    next.every((tab, index) => {
      const prior = priorTabs[index]
      return prior && Object.keys(tab).every((key) => (
        tab[key as keyof TabSummary] === prior[key as keyof TabSummary]
      ))
    })
  ) return priorTabs
  priorTabs = next
  return next
}

export function TabBar(): React.JSX.Element | null {
  const documents = useAppStore(selectTabs)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const setActiveFileId = useAppStore((state) => state.setActiveFileId)
  const closeDocument = useAppStore((state) => state.closeDocument)
  const reorderDocument = useAppStore((state) => state.reorderDocument)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const agentPanelOpen = useAppStore((state) => state.agentPanelOpen)
  const setAgentPanelOpen = useAppStore((state) => state.setAgentPanelOpen)
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY)

  if (documents.length === 0 && !settings.agentEnabled) return null
  const agentVisible = settings.agentEnabled && (
    compact ? agentPanelOpen : !settings.agentPanelCollapsed
  )

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
              onClick={() => void setActiveFileId(document.id)}
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
                void setActiveFileId(target.id)
                tabs.current.get(target.id)?.focus()
              }}
            >
              <DocumentKindIcon kind={document.documentKind} />
              <span className={tabNameClasses}>{document.name}</span>
              <span className={tabStateClasses(document.status)} aria-label={document.status}>
                {document.dirty ? '•' : ''}
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
      {settings.agentEnabled && (
        <div className="sticky right-0 ml-auto flex h-full shrink-0 items-center border-l border-border bg-surface px-1.5">
          <button
            type="button"
            className={sidebarIconButtonClasses}
            aria-label={agentVisible ? 'Hide coding agent' : 'Show coding agent'}
            aria-pressed={agentVisible}
            title={agentVisible ? 'Hide coding agent' : 'Show coding agent'}
            onClick={() => {
              if (compact) {
                setAgentPanelOpen(!agentPanelOpen)
              } else {
                void updateSettings({ agentPanelCollapsed: !settings.agentPanelCollapsed })
              }
            }}
          >
            {agentVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      )}
    </div>
  )
}
