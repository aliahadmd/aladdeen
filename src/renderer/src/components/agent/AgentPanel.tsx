import { useEffect } from 'react'
import { AlertTriangle, RotateCcw, Settings2 } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { buttonClasses } from '@renderer/lib/ui-styles'
import { AgentComposer } from './AgentComposer'
import { AgentPanelHeader } from './AgentPanelHeader'
import { AgentTranscript } from './AgentTranscript'

export function AgentPanel({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const selectedProjectId = useAppStore((state) => state.selectedProjectId)
  const activeFileProjectId = useAppStore((state) =>
    state.documents.find((document) => document.id === state.activeFileId)?.projectId
  )
  const session = useAppStore((state) => state.agentSession)
  const error = useAppStore((state) => state.agentError)
  const settings = useAppStore((state) => state.settings)
  const start = useAppStore((state) => state.startAgentSession)
  const setPanelOpen = useAppStore((state) => state.setAgentPanelOpen)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const activeProjectId = selectedProjectId ?? activeFileProjectId ??
    environment?.projects.find((project) => !project.archived)?.id
  const project = environment?.projects.find((candidate) => candidate.id === activeProjectId)

  useEffect(() => {
    if (!settings.agentEnabled || !activeProjectId || session?.projectId === activeProjectId) return
    void start(activeProjectId)
  }, [activeProjectId, session?.projectId, settings.agentEnabled, start])

  const close = (): void => {
    if (compact) setPanelOpen(false)
    else void updateSettings({ agentPanelCollapsed: true })
  }

  return (
    <aside className="agent-panel flex h-full min-h-0 w-full flex-col border-l border-border bg-[color-mix(in_oklab,var(--surface)_98%,var(--bg))]">
      <AgentPanelHeader projectName={project?.name} compact={compact} onClose={close} />
      {error && (
        <div className="border-b border-danger/25 bg-danger-soft px-3 py-2.5">
          <p className="m-0 flex items-start gap-2 text-[10px] leading-[1.45] text-danger">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>{error.message}</span>
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', className: 'h-7 px-2 text-[9px]' })}
              onClick={() => {
                document.querySelector<HTMLElement>('[data-aladdeen-settings-trigger]')?.click()
              }}
            >
              <Settings2 size={11} /> Open Settings
            </button>
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary', className: 'h-7 px-2 text-[9px]' })}
              onClick={() => void start(activeProjectId)}
            >
              <RotateCcw size={11} /> Restart session
            </button>
          </div>
        </div>
      )}
      <AgentTranscript projectName={project?.name} />
      <AgentComposer />
    </aside>
  )
}
