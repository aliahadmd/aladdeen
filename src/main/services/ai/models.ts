import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_API_VERSION, ANTHROPIC_DEFAULT_MODEL_ID } from '@shared/ai'
import type { AiModelInfo, AiProvider } from '@shared/ai'
import { DesktopError } from '@main/errors'
import { extractProviderErrorMessage, openAiEndpointCandidates } from './providers'

interface AnthropicModelRow {
  id: string
  display_name?: string
}

interface OpenAiModelRow {
  id: string
}

function labelFromId(id: string): string {
  return id
    .split('-')
    .map((part) => (/^(?:\d|v\d)/u.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

export async function fetchProviderModels(
  provider: AiProvider,
  baseUrl: string,
  apiKey: string | null,
  signal?: AbortSignal
): Promise<AiModelInfo[]> {
  if (provider === 'anthropic') {
    const response = await fetch(`${baseUrl || ANTHROPIC_DEFAULT_BASE_URL}/v1/models?limit=100`, {
      headers: {
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_API_VERSION
      },
      signal
    })
    if (!response.ok) throw extractProviderErrorMessage(response.status, await response.text())
    const payload = (await response.json()) as { data?: AnthropicModelRow[] }
    return (payload.data ?? []).map((row) => ({
      provider,
      id: row.id,
      label: row.display_name ?? labelFromId(row.id)
    }))
  }
  const candidates = openAiEndpointCandidates(baseUrl, 'models')
  let lastStatus = 0
  let lastPayload = ''
  for (const url of candidates) {
    const response = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal
    })
    if (response.ok) {
      const payload = (await response.json()) as { data?: OpenAiModelRow[] }
      return (payload.data ?? [])
        .filter((row) => typeof row.id === 'string' && row.id !== '')
        .map((row) => ({ provider, id: row.id, label: labelFromId(row.id) }))
    }
    lastStatus = response.status
    lastPayload = await response.text()
    // Some bare-base servers only implement the un-prefixed /models route.
    if (response.status !== 404) break
  }
  throw extractProviderErrorMessage(lastStatus, lastPayload)
}

export function fallbackModels(provider: AiProvider, manualModelId: string): AiModelInfo[] {
  const models: AiModelInfo[] = []
  if (provider === 'anthropic') {
    models.push({ provider, id: ANTHROPIC_DEFAULT_MODEL_ID, label: 'Claude Sonnet 4.5' })
  }
  if (manualModelId !== '') {
    if (!models.some((model) => model.id === manualModelId)) {
      models.push({ provider, id: manualModelId, label: labelFromId(manualModelId) })
    }
  }
  if (models.length === 0) {
    throw new DesktopError(
      'NOT_FOUND',
      'No models are available. Set an API key, add a manual model ID, or check the endpoint.'
    )
  }
  return models
}
