import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, RefreshCw, X } from 'lucide-react'
import type { AiCredentialStatus, AiModelInfo, AiProvider, AiProviderProfileInfo } from '@shared/contracts'
import { AI_MODES, AI_MODE_DESCRIPTIONS, AI_REASONING_LEVELS } from '@shared/ai'
import { cn } from '@renderer/lib/cn'
import type { AppSettings } from '@shared/contracts'

const PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string; hint: string }> = [
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude models with an Anthropic API key.' },
  { value: 'openai-compatible', label: 'OpenAI-compatible', hint: 'Any /v1/chat/completions endpoint — OpenAI, OpenRouter, Ollama, LM Studio.' }
]

export function AiSettings({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate(next: Partial<AppSettings>): void
}): React.JSX.Element {
  const [credential, setCredential] = useState<AiCredentialStatus | null>(null)
  const [profiles, setProfiles] = useState<Partial<Record<AiProvider, AiProviderProfileInfo>>>({})
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [models, setModels] = useState<AiModelInfo[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)

  const provider = settings.aiProvider
  const profile = profiles[provider]

  useEffect(() => {
    void window.aladdeen.ai.credentialStatus().then((result) => {
      if (result.ok) setCredential(result.value)
    })
    for (const option of PROVIDER_OPTIONS) {
      void window.aladdeen.ai.getProfile(option.value).then((result) => {
        if (result.ok) {
          setProfiles((current) => ({ ...current, [option.value]: result.value }))
        }
      })
    }
  }, [])

  useEffect(() => {
    setModels([])
    setModelsError(null)
    setLoadingModels(true)
    window.aladdeen.ai
      .listModels(provider)
      .then((result) => {
        if (result.ok) setModels(result.value)
        else setModelsError(result.error.message)
      })
      .finally(() => setLoadingModels(false))
  }, [provider, credential])

  const saveApiKey = async (): Promise<void> => {
    if (apiKeyDraft.trim() === '') return
    setSavingKey(true)
    const result = await window.aladdeen.ai.setApiKey(provider, apiKeyDraft.trim())
    setSavingKey(false)
    if (result.ok) {
      setApiKeyDraft('')
      setShowApiKey(false)
      const status = await window.aladdeen.ai.credentialStatus()
      if (status.ok) setCredential(status.value)
      return
    }
    throw new Error(result.error.message)
  }

  const clearApiKey = async (): Promise<void> => {
    const result = await window.aladdeen.ai.clearApiKey(provider)
    if (!result.ok) throw new Error(result.error.message)
    const status = await window.aladdeen.ai.credentialStatus()
    if (status.ok) setCredential(status.value)
  }

  const saveProfile = async (patch: { baseUrl?: string; allowLocal?: boolean; manualModelId?: string }): Promise<void> => {
    const base = profile ?? { baseUrl: '', allowLocal: false, manualModelId: '' }
    const result = await window.aladdeen.ai.setProfile(
      provider,
      patch.baseUrl ?? base.baseUrl,
      patch.allowLocal ?? base.allowLocal,
      patch.manualModelId ?? base.manualModelId
    )
    if (!result.ok) throw new Error(result.error.message)
    setProfiles((current) => ({ ...current, [provider]: result.value }))
  }

  const refreshModels = (): void => {
    setLoadingModels(true)
    setModelsError(null)
    window.aladdeen.ai
      .listModels(provider)
      .then((result) => {
        if (result.ok) setModels(result.value)
        else setModelsError(result.error.message)
      })
      .finally(() => setLoadingModels(false))
  }

  const hasKey = credential?.hasApiKey[provider] === true

  return (
    <div className="divide-y divide-border">
      <section className="grid min-h-[86px] grid-cols-[minmax(110px,1fr)_auto] items-center gap-5 py-4 max-[520px]:grid-cols-1 max-[520px]:gap-3" aria-labelledby="ai-provider-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="ai-provider-label">Provider</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">
            {PROVIDER_OPTIONS.find((option) => option.value === provider)?.hint}
          </p>
        </div>
        <div className="grid w-[280px] grid-cols-2 gap-[3px] rounded-lg border border-border bg-surface p-[3px] max-[520px]:w-full" role="group" aria-label="AI provider">
          {PROVIDER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                'h-8 rounded-md border-0 bg-transparent px-2 text-[12px] font-semibold text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground',
                provider === option.value && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.1)] hover:bg-surface-elevated'
              )}
              onClick={() => onUpdate({ aiProvider: option.value })}
              aria-pressed={provider === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {provider === 'openai-compatible' && (
        <section className="grid gap-3 py-4" aria-labelledby="ai-endpoint-label">
          <div>
            <h3 className="m-0 text-[13px] font-[620] text-foreground" id="ai-endpoint-label">Endpoint</h3>
            <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">
              Requests go directly from this device to the endpoint you configure.
            </p>
          </div>
          <label className="grid gap-[6px]">
            <span className="text-[12px] font-semibold text-foreground-soft">Base URL</span>
            <input
              type="url"
              className="h-9 rounded-[7px] border border-border bg-surface-elevated px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
              placeholder="https://api.openai.com"
              defaultValue={profile?.baseUrl ?? ''}
              onBlur={(event) => void saveProfile({ baseUrl: event.target.value.trim() })}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-foreground-soft">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={profile?.allowLocal === true}
              onChange={(event) => void saveProfile({ allowLocal: event.target.checked })}
            />
            Allow local endpoints (http://localhost, LAN addresses)
          </label>
        </section>
      )}

      <section className="grid gap-3 py-4" aria-labelledby="ai-key-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="ai-key-label">API key</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">
            {credential && !credential.encryptionAvailable
              ? 'Secure storage is unavailable on this device, so Aladdeen refuses to store keys.'
              : 'Stored encrypted with your OS keychain. Never included in backups of your documents.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showApiKey ? 'text' : 'password'}
              className="h-9 w-full rounded-[7px] border border-border bg-surface-elevated px-3 pr-9 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
              placeholder={hasKey ? 'Key stored — enter a new one to replace it' : 'Paste your API key'}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              disabled={savingKey}
              aria-label="API key"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-muted hover:text-foreground"
              onClick={() => setShowApiKey((value) => !value)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {apiKeyDraft.trim() !== '' && (
            <button
              type="button"
              className="grid h-9 place-items-center rounded-[7px] border border-transparent bg-accent px-3 text-[12px] font-semibold text-accent-contrast transition-[filter] hover:brightness-110 active:scale-[.97]"
              onClick={() => void saveApiKey().catch((error: Error) => console.error(error.message))}
            >
              {savingKey ? <Loader2 size={14} className="animate-spin" /> : 'Save key'}
            </button>
          )}
          {hasKey && (
            <button
              type="button"
              className="grid h-9 place-items-center rounded-[7px] border border-border bg-surface px-3 text-[12px] font-semibold text-foreground-soft transition-colors hover:bg-surface-hover hover:text-foreground"
              onClick={() => void clearApiKey().catch((error: Error) => console.error(error.message))}
            >
              Remove
            </button>
          )}
        </div>
        <p className="m-0 flex items-center gap-[6px] text-[12px]" aria-live="polite">
          {hasKey ? (
            <span className="flex items-center gap-[5px] text-success"><Check size={13} /> Key stored</span>
          ) : (
            <span className="flex items-center gap-[5px] text-foreground-muted"><X size={13} /> No key stored</span>
          )}
        </p>
      </section>

      <section className="grid gap-3 py-4" aria-labelledby="ai-model-label">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m-0 text-[13px] font-[620] text-foreground" id="ai-model-label">Model</h3>
            <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">
              Fetched from the provider; add a model ID manually if the endpoint has no catalog.
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 shrink-0 place-items-center rounded-[7px] border border-border bg-surface px-2 text-foreground-soft transition-colors hover:bg-surface-hover hover:text-foreground"
            onClick={refreshModels}
            aria-label="Refresh model list"
          >
            {loadingModels ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        <select
          className="h-9 rounded-[7px] border border-border bg-surface-elevated px-2 text-[13px] text-foreground outline-none focus:border-accent"
          value={models.some((model) => model.id === settings.aiModelId) ? settings.aiModelId : '__manual'}
          onChange={(event) => {
            if (event.target.value !== '__manual') onUpdate({ aiModelId: event.target.value })
          }}
          aria-label="Model"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
          <option value="__manual">Custom model ID…</option>
        </select>
        {!models.some((model) => model.id === settings.aiModelId) && settings.aiModelId !== '' && (
          <input
            type="text"
            className="h-9 rounded-[7px] border border-border bg-surface-elevated px-3 text-[13px] text-foreground outline-none focus:border-accent"
            value={settings.aiModelId}
            onChange={(event) => onUpdate({ aiModelId: event.target.value.trim() })}
            placeholder="provider/model-id"
            aria-label="Custom model ID"
          />
        )}
        {modelsError && (
          <p className="m-0 text-[12px] text-warning">{modelsError} You can still set a model ID manually.</p>
        )}
      </section>

      <section className="grid gap-3 py-4" aria-labelledby="ai-defaults-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="ai-defaults-label">Defaults for new chats</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">Reasoning effort and tool policy.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
          <label className="grid gap-[6px]">
            <span className="text-[12px] font-semibold text-foreground-soft">Reasoning</span>
            <select
              className="h-9 rounded-[7px] border border-border bg-surface-elevated px-2 text-[13px] text-foreground outline-none focus:border-accent"
              value={settings.aiReasoning}
              onChange={(event) => onUpdate({ aiReasoning: event.target.value as AppSettings['aiReasoning'] })}
              aria-label="Reasoning effort"
            >
              {AI_REASONING_LEVELS.map((level) => (
                <option key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-[6px]">
            <span className="text-[12px] font-semibold text-foreground-soft">Tool policy</span>
            <select
              className="h-9 rounded-[7px] border border-border bg-surface-elevated px-2 text-[13px] text-foreground outline-none focus:border-accent"
              value={settings.aiMode}
              onChange={(event) => onUpdate({ aiMode: event.target.value as AppSettings['aiMode'] })}
              aria-label="Tool policy"
            >
              {AI_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode === 'ask' ? 'Ask before changes' : mode === 'full' ? 'Full access' : 'Plan'}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="m-0 text-[12px] leading-[1.45] text-foreground-muted">{AI_MODE_DESCRIPTIONS[settings.aiMode]}</p>
      </section>
    </div>
  )
}
