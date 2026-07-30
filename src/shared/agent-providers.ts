import type { AgentProvider } from './contracts'

export interface AgentProviderDefinition {
  id: AgentProvider
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

export function defaultModelForProvider(provider: AgentProvider): string {
  return AGENT_PROVIDER_DEFINITIONS.find((definition) => definition.id === provider)?.defaultModel ?? ''
}
