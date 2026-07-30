import { Plus, X } from 'lucide-react'
import type { AgentProvider, AgentThinkingLevel } from '@shared/contracts'
import { useAppStore } from '@renderer/store/app-store'
import { sidebarIconButtonClasses } from '@renderer/lib/ui-styles'

const THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function AgentPanelHeader({
  projectName,
  compact,
  onClose
}: {
  projectName?: string
  compact: boolean
  onClose(): void
}): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const models = useAppStore((state) => state.agentModels)
  const runState = useAppStore((state) => state.agentRunState)
  const session = useAppStore((state) => state.agentSession)
  const newSession = useAppStore((state) => state.newAgentSession)
  const setModel = useAppStore((state) => state.setAgentModel)
  const setThinkingLevel = useAppStore((state) => state.setAgentThinkingLevel)
  const providerModels = models.filter((model) => model.provider === settings.agentProvider)

  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="flex h-[42px] items-center gap-2 px-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            runState === 'running'
              ? 'animate-pulse bg-accent'
              : session
                ? 'bg-success'
                : 'bg-foreground-muted'
          }`}
          aria-label={runState === 'running' ? 'Agent running' : session ? 'Agent ready' : 'Agent disconnected'}
        />
        <div className="min-w-0 flex-1">
          <p className="m-0 overflow-hidden text-[11px] font-bold text-ellipsis whitespace-nowrap text-foreground">
            Coding agent
          </p>
          <p className="m-0 overflow-hidden text-[8px] text-ellipsis whitespace-nowrap text-foreground-muted">
            {projectName ?? 'Choose a project'}
          </p>
        </div>
        <button
          type="button"
          className={sidebarIconButtonClasses}
          aria-label="New agent session"
          title="New session"
          onClick={() => void newSession()}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className={sidebarIconButtonClasses}
          aria-label={compact ? 'Close agent panel' : 'Hide agent panel'}
          title={compact ? 'Close' : 'Hide panel'}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_94px] gap-1.5 border-t border-border px-2.5 py-2">
        <select
          className="h-7 min-w-0 rounded-md border border-border bg-surface-elevated px-2 text-[9px] font-semibold text-foreground outline-none focus:border-accent"
          aria-label="Agent model"
          value={settings.agentModelId}
          onChange={(event) => {
            const model = providerModels.find((candidate) => candidate.id === event.currentTarget.value)
            void setModel((model?.provider ?? settings.agentProvider) as AgentProvider, event.currentTarget.value)
          }}
        >
          {!providerModels.some((model) => model.id === settings.agentModelId) && (
            <option value={settings.agentModelId}>{settings.agentModelId}</option>
          )}
          {providerModels.map((model) => (
            <option key={`${model.provider}/${model.id}`} value={model.id}>{model.name}</option>
          ))}
        </select>
        <select
          className="h-7 rounded-md border border-border bg-surface-elevated px-2 text-[9px] font-semibold capitalize text-foreground outline-none focus:border-accent"
          aria-label="Agent thinking level"
          value={settings.agentThinkingLevel}
          onChange={(event) => void setThinkingLevel(event.currentTarget.value as AgentThinkingLevel)}
        >
          {THINKING_LEVELS.map((level) => <option value={level} key={level}>{level}</option>)}
        </select>
      </div>
    </header>
  )
}
