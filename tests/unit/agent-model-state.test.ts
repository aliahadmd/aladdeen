import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, AppSettings } from '@shared/contracts'
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('active agent model state', () => {
  it('changes the live model without changing the saved default', async () => {
    const setModel = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        provider: 'openai-codex',
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportsThinking: true
      }
    })
    vi.stubGlobal('window', {
      aladdeen: {
        agent: { setModel }
      }
    } as unknown as Window & typeof globalThis)
    useAppStore.setState({
      settings,
      persistedSettings: settings,
      agentSession: { sessionId: 'session-1', projectId: 'project-1' },
      agentRunState: 'idle',
      agentCurrentModel: {
        provider: 'openai-codex',
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        supportsThinking: true
      }
    })

    await useAppStore.getState().setAgentModel('openai-codex', 'gpt-5.4')

    expect(setModel).toHaveBeenCalledWith('session-1', 'openai-codex', 'gpt-5.4')
    expect(useAppStore.getState().agentCurrentModel?.id).toBe('gpt-5.4')
    expect(useAppStore.getState().settings.agentModelId).toBe('gpt-5.5')
  })

  it('ignores model changes while the agent is running', async () => {
    const setModel = vi.fn()
    vi.stubGlobal('window', {
      aladdeen: {
        agent: { setModel }
      }
    } as unknown as AladdeenApi)
    useAppStore.setState({
      settings,
      agentSession: { sessionId: 'session-1', projectId: 'project-1' },
      agentRunState: 'running'
    })

    await useAppStore.getState().setAgentModel('openai-codex', 'gpt-5.4')
    expect(setModel).not.toHaveBeenCalled()
  })
})
