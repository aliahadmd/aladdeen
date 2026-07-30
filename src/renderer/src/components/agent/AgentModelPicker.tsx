import { useEffect, useId, useMemo, useState } from 'react'
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
  const verificationRequired = status === 'ready' && selectedModel?.verified === false
  const selectDisabled = disabled || status !== 'ready' || providerModels.length === 0
  const searchable = providerModels.length > 80 || provider === 'openrouter' && providerModels.length > 20
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || query === selectedModel?.name) return providerModels.slice(0, 100)
    return providerModels.filter((model) => (
      model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)
    )).slice(0, 100)
  }, [providerModels, query, selectedModel?.name])
  useEffect(() => {
    setQuery(selectedModel?.name ?? value)
  }, [provider, selectedModel?.name, value])
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
      {searchable ? (
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={searchOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            disabled={selectDisabled}
            value={query}
            placeholder={fallbackLabel}
            className={cn(
              'min-w-0 rounded-md border border-border bg-surface-elevated font-semibold text-foreground outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-55',
              variant === 'compact'
                ? 'h-7 w-full px-2 text-[9px]'
                : 'h-9 w-full rounded-lg border-border-strong bg-surface px-2.5 text-[11px]'
            )}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setSearchOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchOpen(false)
                setQuery(selectedModel?.name ?? value)
              }
              if (event.key === 'Enter') {
                const model = filteredModels[0]
                if (model?.verified !== false) {
                  event.preventDefault()
                  if (model) onChange(model)
                  setSearchOpen(false)
                }
              }
            }}
          />
          {searchOpen && !selectDisabled && (
            <div
              id={listboxId}
              role="listbox"
              className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface-elevated p-1 shadow-xl"
            >
              {filteredModels.map((model) => (
                <button
                  key={`${model.provider}/${model.id}`}
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  disabled={model.verified === false}
                  className="block w-full rounded-md border-0 bg-transparent px-2 py-2 text-left text-[10px] text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(model)
                    setQuery(model.name)
                    setSearchOpen(false)
                  }}
                >
                  <span className="block truncate font-semibold">{model.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[8px] text-foreground-muted">
                    {model.id}{model.verified === false ? ' · verification required' : ''}
                  </span>
                </button>
              ))}
              {filteredModels.length === 0 && (
                <p className="m-0 px-2 py-3 text-center text-[9px] text-foreground-muted">
                  No matching models.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
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
            if (model && model.verified !== false) onChange(model)
          }}
        >
          {(!selectedModel || status !== 'ready') && (
            <option value={value} disabled={unavailable}>{fallbackLabel}</option>
          )}
          {providerModels.map((model) => (
            <option
              key={`${model.provider}/${model.id}`}
              value={model.id}
              disabled={model.verified === false}
            >
              {model.name}{model.verified === false ? ' (verify first)' : ''}
            </option>
          ))}
        </select>
      )}
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
          {verificationRequired && 'Run the compatibility test before selecting this custom model.'}
          {status === 'ready' && selectedModel && !verificationRequired && (
            <span>Model ID: <code className="font-mono">{selectedModel.id}</code></span>
          )}
          {status === 'ready' && !value && providerModels.length === 0 && 'No models are available for this provider.'}
        </div>
      )}
    </div>
  )
}
