import type { AgentModel, AgentProvider } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'

export type AgentModelPickerStatus = 'disabled' | 'loading' | 'ready' | 'error'

function modelsForProvider(
  models: readonly AgentModel[],
  provider: AgentProvider
): AgentModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (model.provider !== provider || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

export function AgentModelPicker({
  models,
  provider,
  value,
  status = 'ready',
  variant = 'compact',
  disabled = false,
  error,
  onRetry,
  onChange,
  ariaLabel
}: {
  models: readonly AgentModel[]
  provider: AgentProvider
  value: string
  status?: AgentModelPickerStatus
  variant?: 'compact' | 'settings'
  disabled?: boolean
  error?: string
  onRetry?(): void
  onChange(model: AgentModel): void
  ariaLabel: string
}): React.JSX.Element {
  const providerModels = modelsForProvider(models, provider)
  const selectedModel = providerModels.find((model) => model.id === value)
  const unavailable = status === 'ready' && Boolean(value) && !selectedModel
  const selectDisabled = disabled || status !== 'ready' || providerModels.length === 0
  const fallbackLabel = status === 'loading'
    ? 'Loading models…'
    : status === 'error'
      ? value || 'Models unavailable'
      : status === 'disabled'
        ? value || 'Enable agent to load models'
        : unavailable
          ? `Unavailable: ${value}`
          : value || 'No models available'

  return (
    <div className={cn(variant === 'settings' && 'min-w-0')}>
      <select
        aria-label={ariaLabel}
        className={cn(
          'min-w-0 rounded-md border border-border bg-surface-elevated font-semibold text-foreground outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-55',
          variant === 'compact'
            ? 'h-7 w-full px-2 text-[9px]'
            : 'h-9 w-full rounded-lg border-border-strong bg-surface px-2.5 text-[11px]'
        )}
        disabled={selectDisabled}
        value={value}
        onChange={(event) => {
          const model = providerModels.find((candidate) => candidate.id === event.currentTarget.value)
          if (model) onChange(model)
        }}
      >
        {(!selectedModel || status !== 'ready') && (
          <option value={value} disabled={unavailable}>{fallbackLabel}</option>
        )}
        {providerModels.map((model) => (
          <option key={`${model.provider}/${model.id}`} value={model.id}>{model.name}</option>
        ))}
      </select>
      {variant === 'settings' && (
        <div className="mt-1.5 min-h-4 text-[9px] leading-[1.4] text-foreground-muted" aria-live="polite">
          {status === 'loading' && 'Loading the model catalog from the installed pi runtime…'}
          {status === 'disabled' && 'Enable the coding agent to load available models.'}
          {status === 'error' && (
            <span className="flex items-center justify-between gap-2 text-danger">
              <span>{error ?? 'The model catalog could not be loaded.'}</span>
              {onRetry && (
                <button
                  type="button"
                  className="shrink-0 font-semibold text-foreground underline decoration-border-strong underline-offset-2"
                  onClick={onRetry}
                >
                  Retry
                </button>
              )}
            </span>
          )}
          {unavailable && 'This saved model is unavailable. Choose another model.'}
          {status === 'ready' && selectedModel && (
            <span>Model ID: <code className="font-mono">{selectedModel.id}</code></span>
          )}
          {status === 'ready' && !value && providerModels.length === 0 && 'No models are available for this provider.'}
        </div>
      )}
    </div>
  )
}
