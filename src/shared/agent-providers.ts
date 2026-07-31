import type { AgentProviderId } from './contracts'

export interface AgentProviderDefinition {
  id: AgentProviderId
  name: string
  accountLabel?: string
  defaultModel: string
}

export const AGENT_PROVIDER_DEFINITIONS: readonly AgentProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    accountLabel: 'Continue with Claude',
    defaultModel: 'claude-sonnet-4-5'
  },
  {
    id: 'openai-codex',
    name: 'Codex',
    accountLabel: 'Continue with ChatGPT',
    defaultModel: 'gpt-5.5'
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Code',
    accountLabel: 'Continue with Kimi',
    defaultModel: 'kimi-for-coding'
  },
  { id: 'openai', name: 'OpenAI API', defaultModel: 'gpt-5' },
  { id: 'google', name: 'Google', defaultModel: 'gemini-2.5-pro' }
] as const

export const FEATURED_AGENT_PROVIDER_IDS = [
  'anthropic',
  'openai-codex',
  'kimi-coding',
  'openai',
  'google',
  'deepseek',
  'openrouter'
] as const

const LEGACY_CUSTOM_PROVIDER_PATTERN =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isCustomAgentProviderId(provider: AgentProviderId): boolean {
  return provider.startsWith('custom:')
}

export function isLegacyCustomAgentProvider(provider: AgentProviderId): boolean {
  return LEGACY_CUSTOM_PROVIDER_PATTERN.test(provider)
}

export function isFeaturedAgentProvider(provider: AgentProviderId): boolean {
  return (FEATURED_AGENT_PROVIDER_IDS as readonly string[]).includes(provider)
}

export function defaultModelForProvider(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DEFINITIONS.find((definition) => definition.id === provider)?.defaultModel ?? ''
}

export function providerDisplayName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DEFINITIONS.find((definition) => definition.id === provider)?.name ?? provider
}
