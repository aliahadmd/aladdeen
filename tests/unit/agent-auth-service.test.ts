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
import type {
  AgentProvider,
  AgentProviderProfile,
  AppSettings
} from '@shared/contracts'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const capabilitiesMessage = {
  channel: 'auth',
  type: 'capabilities',
  providers: [
    {
      provider: 'anthropic',
      name: 'Anthropic',
      oauthAvailable: true,
      apiKeyAvailable: true,
      dynamicCatalog: false,
      models: [{
        provider: 'anthropic',
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        supportsThinking: true
      }]
    },
    {
      provider: 'openai-codex',
      name: 'OpenAI Codex',
      oauthAvailable: true,
      apiKeyAvailable: false,
      dynamicCatalog: false,
      models: [{
        provider: 'openai-codex',
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        supportsThinking: true
      }]
    },
    {
      provider: 'kimi-coding',
      name: 'Kimi Coding',
      oauthAvailable: true,
      apiKeyAvailable: true,
      dynamicCatalog: false,
      models: [{
        provider: 'kimi-coding',
        id: 'kimi-for-coding',
        name: 'Kimi for Coding',
        supportsThinking: true
      }]
    },
    {
      provider: 'openai',
      name: 'OpenAI',
      oauthAvailable: false,
      apiKeyAvailable: true,
      dynamicCatalog: false,
      models: [{
        provider: 'openai',
        id: 'gpt-5',
        name: 'GPT-5',
        supportsThinking: true
      }]
    },
    {
      provider: 'google',
      name: 'Google',
      oauthAvailable: false,
      apiKeyAvailable: true,
      dynamicCatalog: false,
      models: [{
        provider: 'google',
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        supportsThinking: true
      }]
    },
    {
      provider: 'deepseek',
      name: 'DeepSeek',
      oauthAvailable: false,
      apiKeyAvailable: true,
      dynamicCatalog: false,
      models: [{
        provider: 'deepseek',
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        supportsThinking: true,
        protocol: 'openai-completions'
      }]
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
  database: {
    settings: AppSettings
    profiles: Map<string, AgentProviderProfile>
    verifications: Map<string, string>
  }
  createWorker: ReturnType<typeof vi.fn>
} {
  const capabilityChild = new FakeChild()
  const loginChild = new FakeChild()
  const workers = [capabilityChild, loginChild]
  const createWorker = vi.fn(() => workers.shift() as unknown as AgentWorkerChild)
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const stopAgent = vi.fn().mockResolvedValue(undefined)
  const sentEvents: unknown[] = []
  const profiles = new Map<string, AgentProviderProfile>()
  const verifications = new Map<string, string>()
  const database = {
    settings: { ...initialSettings },
    profiles,
    verifications,
    getSettings(): AppSettings {
      return { ...this.settings }
    },
    setSettings(settings: AppSettings): AppSettings {
      this.settings = { ...settings }
      return { ...this.settings }
    },
    listAgentProviderProfiles: () => [...profiles.values()],
    getAgentProviderProfile: (providerId: string) => profiles.get(providerId),
    saveAgentProviderProfile: (profile: AgentProviderProfile) => profiles.set(profile.id, profile),
    deleteAgentProviderProfile: (providerId: string) => profiles.delete(providerId),
    clearAgentModelVerifications: (providerId: string) => {
      for (const key of verifications.keys()) {
        if (key.startsWith(`${providerId}\u0000`)) verifications.delete(key)
      }
    },
    getAgentModelVerification: (providerId: string, modelId: string) => {
      const configHash = verifications.get(`${providerId}\u0000${modelId}`)
      return configHash ? { configHash, verifiedAt: 100 } : undefined
    },
    setAgentModelVerification: (providerId: string, modelId: string, configHash: string) => {
      verifications.set(`${providerId}\u0000${modelId}`, configHash)
    },
    getAgentModelCache: () => undefined,
    setAgentModelCache: vi.fn(),
    getAgentRuntimeModelCache: () => undefined,
    setAgentRuntimeModelCache: vi.fn()
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
    status: vi.fn().mockResolvedValue({ encryptionAvailable: true, providers: [] })
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
    database,
    createWorker
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
      message: 'Untrusted provider authorization URL.'
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

  it('returns a sanitized local model catalog only while the agent is enabled', async () => {
    const harness = createHarness()
    const catalogPromise = harness.service.getModelCatalog()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.capabilityChild.emit('message', capabilitiesMessage)

    await expect(catalogPromise).resolves.toContainEqual(expect.objectContaining({
      provider: 'openai-codex',
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      supportsThinking: true
    }))

    const disabledHarness = createHarness()
    disabledHarness.database.settings.agentEnabled = false
    await expect(disabledHarness.service.getModelCatalog()).rejects.toThrow(
      'Enable the coding agent to load available models.'
    )
    expect(disabledHarness.capabilityChild.listenerCount('message')).toBe(0)
    await expect(disabledHarness.service.credentialStatus()).resolves.toBeDefined()
    expect(disabledHarness.service.getLegacyProviderProfiles()).toEqual([])
    expect(disabledHarness.createWorker).not.toHaveBeenCalled()
  })

  it('coalesces concurrent model-catalog discovery into one worker', async () => {
    const harness = createHarness()
    const first = harness.service.getModelCatalog()
    const second = harness.service.getModelCatalog()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.capabilityChild.emit('message', capabilitiesMessage)

    const [firstCatalog, secondCatalog] = await Promise.all([first, second])
    expect(firstCatalog).toEqual(secondCatalog)
    expect(harness.loginChild.listenerCount('message')).toBe(0)
  })

  it('exposes all pi-native providers as deterministic sanitized descriptors', async () => {
    const harness = createHarness()
    const catalog = harness.service.getProviderCatalog()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.capabilityChild.emit('message', capabilitiesMessage)

    await expect(catalog).resolves.toContainEqual({
      id: 'deepseek',
      name: 'DeepSeek',
      featured: true,
      oauthAvailable: false,
      apiKeyAvailable: true,
      modelCount: 1,
      catalogKind: 'bundled'
    })
  })

  it('keeps legacy profiles out of native catalogs and exposes only a sanitized cleanup record', async () => {
    const harness = createHarness()
    const profile: AgentProviderProfile = {
      id: 'custom:fa2a4d2b-0499-45ae-b5fa-24b6217bf256',
      name: 'Old Local Server',
      protocol: 'openai-completions',
      baseUrl: 'http://127.0.0.1:8000/v1',
      endpointScope: 'loopback',
      authScheme: 'bearer',
      catalogMode: 'manual',
      compatibility: {},
      models: [{
        provider: 'custom:fa2a4d2b-0499-45ae-b5fa-24b6217bf256',
        id: 'local-coder',
        name: 'Local Coder',
        supportsThinking: false,
        source: 'custom'
      }],
      createdAt: 1,
      updatedAt: 2
    }
    harness.database.profiles.set(profile.id, profile)

    const catalogPromise = harness.service.getProviderCatalog()
    await new Promise<void>((resolve) => setImmediate(resolve))
    harness.capabilityChild.emit('message', capabilitiesMessage)
    await expect(catalogPromise).resolves.not.toContainEqual(
      expect.objectContaining({ id: profile.id })
    )
    expect(harness.service.getLegacyProviderProfiles()).toEqual([{
      id: profile.id,
      name: profile.name
    }])
    expect(JSON.stringify(harness.service.getLegacyProviderProfiles())).not.toContain(profile.baseUrl)
  })

  it('removes a legacy profile while disabled and repairs a stale selected provider', async () => {
    const harness = createHarness()
    const providerId = 'custom:9c47b46c-cf1d-4249-a742-09d8f6d6505d'
    harness.database.settings = {
      ...harness.database.settings,
      agentEnabled: false,
      agentProvider: providerId,
      agentModelId: 'old-model'
    }
    harness.database.profiles.set(providerId, {
      id: providerId,
      name: 'Old Endpoint',
      protocol: 'openai-completions',
      baseUrl: 'http://localhost:9000/v1',
      endpointScope: 'loopback',
      authScheme: 'bearer',
      catalogMode: 'manual',
      compatibility: {},
      models: [],
      createdAt: 1,
      updatedAt: 1
    })

    await harness.service.removeLegacyProviderProfile(providerId)

    expect(harness.database.profiles.has(providerId)).toBe(false)
    expect(harness.stopAgent).toHaveBeenCalledWith(providerId)
    expect(harness.database.settings).toMatchObject({
      agentProvider: 'anthropic',
      agentModelId: 'claude-sonnet-4-5'
    })
  })

  it('rejects attempts to authenticate a legacy custom endpoint', async () => {
    const harness = createHarness()
    await expect(harness.service.beginLogin(
      'custom:9c47b46c-cf1d-4249-a742-09d8f6d6505d',
      'api_key'
    )).rejects.toThrow('provider ID is invalid')
    expect(harness.createWorker).not.toHaveBeenCalled()
  })

  it('relays Kimi device codes without the verification URL and supports cancellation', async () => {
    const harness = createHarness()
    const { attemptId } = await begin(harness, 'kimi-coding')
    const verificationUrl = 'https://www.kimi.com/code?user_code=ABCD-EFGH'
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

  it('rejects unapproved Kimi lookalike authorization hosts', async () => {
    const harness = createHarness()
    await begin(harness, 'kimi-coding')
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://www.kimi.com.attacker.example/code?user_code=ABCD-EFGH',
      expiresInSeconds: 900
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.openExternal).not.toHaveBeenCalled()
    expect(harness.loginChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(harness.sentEvents).toContainEqual(expect.objectContaining({
      type: 'failed',
      message: 'Untrusted provider authorization URL.'
    }))
  })

  it('redacts provider token payloads from renderer-facing failures', async () => {
    const harness = createHarness()
    await begin(harness, 'openai-codex')
    harness.loginChild.emit('message', {
      channel: 'auth',
      type: 'failed',
      message: 'Token response: {"access_token":"short-access","refresh_token":"short-refresh"} Bearer sk-provider-secret'
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    const serialized = JSON.stringify(harness.sentEvents)
    expect(serialized).not.toContain('short-access')
    expect(serialized).not.toContain('short-refresh')
    expect(serialized).not.toContain('sk-provider-secret')
    expect(serialized).toContain('sensitive value removed')
  })
})
