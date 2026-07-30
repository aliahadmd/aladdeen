// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/application',
    isPackaged: false
  },
  shell: {
    openExternal: vi.fn()
  }
}))

import { AgentAuthService } from '@main/services/agent-auth'
import type {
  AgentCapabilities,
  AgentCredentialVault
} from '@main/services/agent-credentials'
import type { AgentWorkerChild } from '@main/services/agent-worker-host'
import type { AppDatabase } from '@main/services/database'
import type { AgentProvider, AppSettings } from '@shared/contracts'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const capabilitiesMessage = {
  channel: 'auth',
  type: 'capabilities',
  providers: [
    {
      provider: 'anthropic',
      oauthAvailable: true,
      apiKeyAvailable: true,
      modelIds: ['claude-sonnet-4-5']
    },
    {
      provider: 'openai-codex',
      oauthAvailable: true,
      apiKeyAvailable: false,
      modelIds: ['gpt-5.5']
    },
    {
      provider: 'kimi-coding',
      oauthAvailable: true,
      apiKeyAvailable: true,
      modelIds: ['kimi-for-coding']
    },
    {
      provider: 'openai',
      oauthAvailable: false,
      apiKeyAvailable: true,
      modelIds: ['gpt-5']
    },
    {
      provider: 'google',
      oauthAvailable: false,
      apiKeyAvailable: true,
      modelIds: ['gemini-2.5-pro']
    }
  ]
} as const

const initialSettings: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false,
  completedOnboardingVersion: 1,
  agentEnabled: true,
  agentProvider: 'anthropic',
  agentModelId: 'claude-sonnet-4-5',
  agentThinkingLevel: 'medium',
  agentPanelWidth: 380,
  agentPanelCollapsed: false,
  ...DEFAULT_READING_SETTINGS
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  connected = true
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly send = vi.fn((message: unknown) => {
    if ((message as { type?: string })?.type === 'cancel') {
      setImmediate(() => this.finish(null, 'SIGTERM'))
    }
    return true
  })
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.finish(null, signal)
    return true
  })

  finish(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.connected = false
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

function createHarness(): {
  service: AgentAuthService
  capabilityChild: FakeChild
  loginChild: FakeChild
  openExternal: ReturnType<typeof vi.fn>
  stopAgent: ReturnType<typeof vi.fn>
  sentEvents: unknown[]
  database: { settings: AppSettings }
} {
  const capabilityChild = new FakeChild()
  const loginChild = new FakeChild()
  const workers = [capabilityChild, loginChild]
  const createWorker = vi.fn(() => workers.shift() as unknown as AgentWorkerChild)
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const stopAgent = vi.fn().mockResolvedValue(undefined)
  const sentEvents: unknown[] = []
  const database = {
    settings: { ...initialSettings },
    getSettings(): AppSettings {
      return { ...this.settings }
    },
    setSettings(settings: AppSettings): AppSettings {
      this.settings = { ...settings }
      return { ...this.settings }
    }
  }
  let capabilities = {} as AgentCapabilities
  const vault = {
    encryptionAvailable: () => true,
    getCapabilities: () => capabilities,
    setCapabilities: (next: AgentCapabilities) => {
      capabilities = next
    },
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    status: vi.fn()
  }
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, event: unknown) => sentEvents.push(event)
    }
  }
  const service = new AgentAuthService(
    database as unknown as AppDatabase,
    vault as unknown as AgentCredentialVault,
    () => window as never,
    stopAgent,
    openExternal,
    createWorker
  )
  return {
    service,
    capabilityChild,
    loginChild,
    openExternal,
    stopAgent,
    sentEvents,
    database
  }
}

async function begin(
  harness: ReturnType<typeof createHarness>,
  provider: AgentProvider
): Promise<{ attemptId: string }> {
  const result = harness.service.beginLogin(provider)
  await new Promise<void>((resolve) => setImmediate(resolve))
  harness.capabilityChild.emit('message', capabilitiesMessage)
  return result
}

describe('agent account authentication service', () => {
  it('opens only the provider URL, relays sanitized prompts, and selects the Codex default', async () => {
    const harness = createHarness()
    const { attemptId } = await begin(harness, 'openai-codex')
    expect(harness.stopAgent).toHaveBeenCalledOnce()

    const rawUrl = 'https://auth.openai.com/oauth/authorize?client_id=secret-client&state=secret-state'
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'url',
      kind: 'browser',
      url: rawUrl
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.openExternal).toHaveBeenCalledWith(rawUrl)
    expect(JSON.stringify(harness.sentEvents)).not.toContain(rawUrl)

    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'prompt',
      promptId: 'd3b56a73-79de-487b-a055-a6698854052f',
      promptType: 'select',
      message: 'Choose a login method',
      options: [
        { id: 'browser', label: 'Browser' },
        { id: 'device_code', label: 'Device code' }
      ]
    })
    await harness.service.respondLoginPrompt(
      attemptId,
      'd3b56a73-79de-487b-a055-a6698854052f',
      'device_code'
    )
    expect(harness.loginChild.send).toHaveBeenCalledWith({
      channel: 'auth-control',
      type: 'prompt-response',
      promptId: 'd3b56a73-79de-487b-a055-a6698854052f',
      value: 'device_code'
    })

    harness.loginChild.emit('message', { channel: 'auth', type: 'completed' })
    expect(harness.database.settings).toMatchObject({
      agentProvider: 'openai-codex',
      agentModelId: 'gpt-5.5'
    })
    expect(harness.sentEvents).toContainEqual(expect.objectContaining({
      type: 'completed',
      provider: 'openai-codex',
      authType: 'oauth'
    }))
  })

  it('never opens an invalid external authorization URL', async () => {
    const harness = createHarness()
    await begin(harness, 'anthropic')
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'url',
      kind: 'browser',
      url: 'https://attacker.example/steal'
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.openExternal).not.toHaveBeenCalled()
    expect(harness.loginChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(harness.sentEvents).toContainEqual(expect.objectContaining({
      type: 'failed',
      message: 'The provider returned an invalid authorization URL.'
    }))
  })

  it('rejects malformed capability messages without starting a login worker', async () => {
    const harness = createHarness()
    const login = harness.service.beginLogin('openai-codex')
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.capabilityChild.emit('message', {
      channel: 'auth',
      type: 'capabilities',
      providers: [{ provider: 'openai-codex', oauthAvailable: 'yes' }]
    })

    await expect(login).rejects.toThrow('invalid provider')
    expect(harness.capabilityChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(harness.stopAgent).not.toHaveBeenCalled()
    expect(harness.loginChild.listenerCount('message')).toBe(0)
  })

  it('relays Kimi device codes without the verification URL and supports cancellation', async () => {
    const harness = createHarness()
    const { attemptId } = await begin(harness, 'kimi-coding')
    const verificationUrl = 'https://auth.kimi.com/device?user_code=ABCD-EFGH'
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: verificationUrl,
      intervalSeconds: 5,
      expiresInSeconds: 900
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.openExternal).toHaveBeenCalledWith(verificationUrl)
    const deviceEvent = harness.sentEvents.find((event) => (
      event as { type?: string }
    ).type === 'device-code')
    expect(deviceEvent).toMatchObject({
      type: 'device-code',
      provider: 'kimi-coding',
      userCode: 'ABCD-EFGH'
    })
    expect(JSON.stringify(deviceEvent)).not.toContain(verificationUrl)

    await harness.service.cancelLogin(attemptId)
    expect(harness.loginChild.send).toHaveBeenCalledWith({
      channel: 'auth-control',
      type: 'cancel'
    })
    expect(harness.sentEvents).toContainEqual(expect.objectContaining({
      type: 'cancelled',
      provider: 'kimi-coding'
    }))
  })

  it('redacts provider token payloads from renderer-facing failures', async () => {
    const harness = createHarness()
    await begin(harness, 'openai-codex')
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'failed',
      message: 'Token response: {"access_token":"short-access","refresh_token":"short-refresh"}'
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    const serialized = JSON.stringify(harness.sentEvents)
    expect(serialized).not.toContain('short-access')
    expect(serialized).not.toContain('short-refresh')
    expect(serialized).toContain('sensitive value removed')
  })
})
