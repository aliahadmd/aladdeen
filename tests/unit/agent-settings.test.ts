import { describe, expect, it } from 'vitest'
import { agentSessionMustStopForSettingsChange } from '@shared/agent-settings'
import type { AppSettings } from '@shared/contracts'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const settings: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false,
  completedOnboardingVersion: 1,
  agentEnabled: true,
  agentProvider: 'openai-codex',
  agentModelId: 'gpt-5.5',
  agentThinkingLevel: 'medium',
  agentPanelWidth: 380,
  agentPanelCollapsed: false,
  ...DEFAULT_READING_SETTINGS
}

describe('agent settings session lifecycle', () => {
  it('keeps the active session when only the future default model changes', () => {
    expect(agentSessionMustStopForSettingsChange(settings, {
      ...settings,
      agentModelId: 'gpt-5.4'
    })).toBe(false)
  })

  it('stops the active session when the provider changes or the agent is disabled', () => {
    expect(agentSessionMustStopForSettingsChange(settings, {
      ...settings,
      agentProvider: 'anthropic'
    })).toBe(true)
    expect(agentSessionMustStopForSettingsChange(settings, {
      ...settings,
      agentEnabled: false
    })).toBe(true)
  })
})
