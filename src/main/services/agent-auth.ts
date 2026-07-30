import { randomUUID } from 'node:crypto'
import { shell, type BrowserWindow } from 'electron'
import { DesktopError } from '@main/errors'
import {
  AGENT_PROVIDERS,
  type AgentCapabilities,
  type AgentCredentialVault
} from '@main/services/agent-credentials'
import {
  bindCredentialBridge,
  spawnAgentWorker,
  type AgentWorkerChild
} from '@main/services/agent-worker-host'
import { defaultModelForProvider } from '@shared/agent-providers'
import type { AgentWorkerAuthMessage } from '@shared/agent-worker'
import {
  IPC,
  type AgentAuthEvent,
  type AgentCredentialStatus,
  type AgentProvider
} from '@shared/contracts'
import type { AppDatabase } from './database'

const MAX_AUTH_IPC_BYTES = 768 * 1024
const AUTH_HOSTS: Record<Extract<AgentProvider, 'anthropic' | 'openai-codex' | 'kimi-coding'>, string> = {
  anthropic: 'claude.ai',
  'openai-codex': 'auth.openai.com',
  'kimi-coding': 'auth.kimi.com'
}

interface ActiveLogin {
  id: string
  provider: AgentProvider
  child: AgentWorkerChild
  detachCredentialBridge: () => void
  pendingPrompts: Set<string>
  loginUrl?: string
  stderr: string
  terminal: boolean
  cancelling: boolean
}

export class AgentAuthService {
  private active?: ActiveLogin
  private capabilitiesLoaded = false

  constructor(
    private readonly database: AppDatabase,
    private readonly vault: AgentCredentialVault,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly stopAgentSession: () => Promise<void>,
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
    private readonly createWorker: typeof spawnAgentWorker = spawnAgentWorker
  ) {}

  async credentialStatus(): Promise<AgentCredentialStatus> {
    if (this.database.getSettings().agentEnabled && !this.active) {
      await this.refreshCapabilities().catch(() => undefined)
    }
    return this.vault.status()
  }

  async setApiKey(provider: AgentProvider, apiKey: string): Promise<void> {
    const capability = this.vault.getCapabilities()[provider]
    if (!capability.apiKeyAvailable) {
      throw new DesktopError('INVALID_PATH', `${provider} does not support API-key login in the pinned pi runtime.`)
    }
    await this.cancelActiveLogin()
    await this.stopAgentSession()
    await this.vault.write(provider, { type: 'api_key', key: apiKey })
  }

  async disconnectProvider(provider: AgentProvider): Promise<void> {
    await this.cancelActiveLogin()
    await this.stopAgentSession()
    this.vault.delete(provider)
  }

  async beginLogin(provider: AgentProvider): Promise<{ attemptId: string }> {
    const settings = this.database.getSettings()
    if (!settings.agentEnabled) {
      throw new DesktopError('PERMISSION_DENIED', 'Enable the coding agent before connecting an account.')
    }
    if (!this.vault.encryptionAvailable()) {
      throw new DesktopError('PERMISSION_DENIED', 'Secure credential storage is unavailable on this Mac.')
    }
    if (this.active) {
      throw new DesktopError('CONFLICT', 'Another account login is already in progress.')
    }
    await this.refreshCapabilities()
    if (!this.vault.getCapabilities()[provider].oauthAvailable) {
      throw new DesktopError('INVALID_PATH', `${provider} does not support account login in the pinned pi runtime.`)
    }
    await this.stopAgentSession()

    const attemptId = randomUUID()
    const child = this.createWorker({ mode: 'login', provider })
    const login: ActiveLogin = {
      id: attemptId,
      provider,
      child,
      detachCredentialBridge: () => undefined,
      pendingPrompts: new Set(),
      stderr: '',
      terminal: false,
      cancelling: false
    }
    login.detachCredentialBridge = bindCredentialBridge(child, this.vault)
    this.active = login
    this.bindLogin(login)
    this.emit({ type: 'started', attemptId, provider })
    return { attemptId }
  }

  async respondLoginPrompt(attemptId: string, promptId: string, value: string): Promise<void> {
    const login = this.requireLogin(attemptId)
    if (!login.pendingPrompts.delete(promptId)) {
      throw new DesktopError('NOT_FOUND', 'That login prompt is no longer waiting for a response.')
    }
    if (!login.child.connected) throw new DesktopError('NOT_FOUND', 'The login worker has already stopped.')
    login.child.send({
      channel: 'auth-control',
      type: 'prompt-response',
      promptId,
      value
    })
  }

  async reopenLoginUrl(attemptId: string): Promise<void> {
    const login = this.requireLogin(attemptId)
    if (!login.loginUrl) throw new DesktopError('NOT_FOUND', 'No browser login URL is available yet.')
    await this.openExternal(login.loginUrl)
    this.emit({ type: 'browser-opened', attemptId, provider: login.provider })
  }

  async cancelLogin(attemptId: string): Promise<void> {
    const login = this.requireLogin(attemptId)
    await this.cancel(login)
  }

  async close(): Promise<void> {
    await this.cancelActiveLogin()
  }

  private bindLogin(login: ActiveLogin): void {
    login.child.on('message', (message: unknown) => {
      if (this.active !== login || login.terminal || !isAuthWorkerMessage(message)) return
      if (!messageWithinLimit(message)) {
        this.failLogin(login, 'The login worker sent an oversized message.')
        return
      }
      void this.handleAuthMessage(login, message).catch((error: unknown) => {
        this.failLogin(login, safeAuthError(error))
      })
    })
    login.child.stderr.on('data', (chunk: Buffer | string) => {
      login.stderr = `${login.stderr}${String(chunk)}`.slice(-16 * 1024)
    })
    login.child.on('error', (error) => {
      if (this.active === login && !login.terminal) this.failLogin(login, safeAuthError(error))
    })
    login.child.on('exit', (code) => {
      login.detachCredentialBridge()
      if (this.active !== login) return
      this.active = undefined
      if (login.terminal) return
      if (login.cancelling) {
        login.terminal = true
        this.emit({ type: 'cancelled', attemptId: login.id, provider: login.provider })
        return
      }
      login.terminal = true
      this.emit({
        type: 'failed',
        attemptId: login.id,
        provider: login.provider,
        message: safeAuthError(login.stderr || `The login worker exited with code ${String(code)}.`)
      })
    })
  }

  private async handleAuthMessage(login: ActiveLogin, message: AgentWorkerAuthMessage): Promise<void> {
    if (message.type === 'ready') return
    if (message.type === 'url') {
      if (typeof message.url !== 'string') throw new Error('The login worker sent an invalid URL event.')
      try {
        login.loginUrl = this.validateLoginUrl(login.provider, message.url)
        await this.openExternal(login.loginUrl)
        this.emit({ type: 'browser-opened', attemptId: login.id, provider: login.provider })
      } catch {
        this.failLogin(login, 'The provider returned an invalid authorization URL.')
      }
      return
    }
    if (message.type === 'device-code') {
      if (
        typeof message.userCode !== 'string' ||
        typeof message.verificationUri !== 'string' ||
        message.userCode.length > 200
      ) {
        throw new Error('The login worker sent an invalid device-code event.')
      }
      try {
        login.loginUrl = this.validateLoginUrl(login.provider, message.verificationUri)
        await this.openExternal(login.loginUrl)
        this.emit({ type: 'browser-opened', attemptId: login.id, provider: login.provider })
        this.emit({
          type: 'device-code',
          attemptId: login.id,
          provider: login.provider,
          userCode: message.userCode,
          ...(message.expiresInSeconds
            ? { expiresAt: Date.now() + message.expiresInSeconds * 1_000 }
            : {})
        })
      } catch {
        this.failLogin(login, 'The provider returned an invalid device-login URL.')
      }
      return
    }
    if (message.type === 'prompt') {
      if (
        typeof message.promptId !== 'string' ||
        typeof message.message !== 'string' ||
        !['text', 'secret', 'select', 'manual_code'].includes(message.promptType)
      ) {
        throw new Error('The login worker sent an invalid prompt event.')
      }
      login.pendingPrompts.add(message.promptId)
      this.emit({
        type: 'prompt',
        attemptId: login.id,
        provider: login.provider,
        promptId: message.promptId,
        promptType: message.promptType,
        message: message.message,
        placeholder: message.placeholder,
        options: message.options
      })
      return
    }
    if (message.type === 'progress') {
      if (typeof message.message !== 'string') throw new Error('The login worker sent invalid progress.')
      this.emit({
        type: 'progress',
        attemptId: login.id,
        provider: login.provider,
        message: message.message
      })
      return
    }
    if (message.type === 'completed') {
      login.terminal = true
      login.pendingPrompts.clear()
      this.selectProviderAfterLogin(login.provider)
      this.emit({
        type: 'completed',
        attemptId: login.id,
        provider: login.provider,
        authType: 'oauth'
      })
      return
    }
    if (message.type === 'cancelled') {
      login.terminal = true
      login.pendingPrompts.clear()
      this.emit({ type: 'cancelled', attemptId: login.id, provider: login.provider })
      return
    }
    if (message.type === 'failed') {
      if (typeof message.message !== 'string') throw new Error('The login worker sent an invalid failure.')
      this.failLogin(login, message.message)
    }
  }

  private selectProviderAfterLogin(provider: AgentProvider): void {
    const settings = this.database.getSettings()
    const modelIds = this.vault.getCapabilities()[provider].modelIds
    const modelIsValid = modelIds.includes(settings.agentModelId)
    this.database.setSettings({
      ...settings,
      agentProvider: provider,
      agentModelId: modelIsValid ? settings.agentModelId : defaultModelForProvider(provider)
    })
  }

  private async refreshCapabilities(): Promise<void> {
    if (this.capabilitiesLoaded || this.active) return
    const child = this.createWorker({ mode: 'capabilities' })
    const detach = bindCredentialBridge(child, this.vault)
    const capabilities = await new Promise<AgentCapabilities>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('Pi capability discovery timed out.'))
      }, 10_000)
      child.on('message', (message: unknown) => {
        if (!isAuthWorkerMessage(message) || message.type !== 'capabilities') return
        clearTimeout(timeout)
        if (!messageWithinLimit(message)) {
          reject(new Error('Pi capability discovery returned an oversized response.'))
          child.kill('SIGTERM')
          return
        }
        try {
          resolve(capabilitiesFromWorker(message))
        } catch (error) {
          reject(error)
          child.kill('SIGTERM')
        }
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Pi capability discovery exited before returning capabilities (code ${String(code)}).`))
      })
    }).finally(detach)
    this.vault.setCapabilities(capabilities)
    this.capabilitiesLoaded = true
  }

  private validateLoginUrl(provider: AgentProvider, value: string): string {
    const expectedHost = AUTH_HOSTS[provider as keyof typeof AUTH_HOSTS]
    if (!expectedHost) throw new Error('Provider has no account-login host.')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.username || url.password) {
      throw new Error('Untrusted provider authorization URL.')
    }
    return url.href
  }

  private failLogin(login: ActiveLogin, message: string): void {
    if (login.terminal) return
    login.terminal = true
    login.pendingPrompts.clear()
    this.emit({
      type: 'failed',
      attemptId: login.id,
      provider: login.provider,
      message: safeAuthError(message)
    })
    if (login.child.exitCode === null && login.child.signalCode === null) login.child.kill('SIGTERM')
  }

  private requireLogin(attemptId: string): ActiveLogin {
    if (!this.active || this.active.id !== attemptId || this.active.terminal) {
      throw new DesktopError('NOT_FOUND', 'That account login is no longer active.')
    }
    return this.active
  }

  private async cancelActiveLogin(): Promise<void> {
    if (this.active && !this.active.terminal) await this.cancel(this.active)
  }

  private async cancel(login: ActiveLogin): Promise<void> {
    if (login.terminal || login.cancelling) return
    login.cancelling = true
    login.pendingPrompts.clear()
    if (login.child.connected) login.child.send({ channel: 'auth-control', type: 'cancel' })
    await Promise.race([
      new Promise<void>((resolve) => login.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000))
    ])
    if (login.child.exitCode === null && login.child.signalCode === null) login.child.kill('SIGTERM')
  }

  private emit(event: AgentAuthEvent): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.agentAuthEvent, event)
  }
}

function capabilitiesFromWorker(
  message: Extract<AgentWorkerAuthMessage, { type: 'capabilities' }>
): AgentCapabilities {
  if (!Array.isArray(message.providers) || message.providers.length > 100) {
    throw new Error('Pi capability discovery returned an invalid provider list.')
  }
  const capabilities: AgentCapabilities = {
    anthropic: { oauthAvailable: false, apiKeyAvailable: false, modelIds: [] },
    'openai-codex': { oauthAvailable: false, apiKeyAvailable: false, modelIds: [] },
    'kimi-coding': { oauthAvailable: false, apiKeyAvailable: false, modelIds: [] },
    openai: { oauthAvailable: false, apiKeyAvailable: false, modelIds: [] },
    google: { oauthAvailable: false, apiKeyAvailable: false, modelIds: [] }
  }
  for (const item of message.providers as unknown[]) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof (item as { provider?: unknown }).provider !== 'string' ||
      typeof (item as { oauthAvailable?: unknown }).oauthAvailable !== 'boolean' ||
      typeof (item as { apiKeyAvailable?: unknown }).apiKeyAvailable !== 'boolean' ||
      !Array.isArray((item as { modelIds?: unknown }).modelIds)
    ) {
      throw new Error('Pi capability discovery returned an invalid provider.')
    }
    const provider = item as {
      provider: string
      oauthAvailable: boolean
      apiKeyAvailable: boolean
      modelIds: unknown[]
    }
    if (!AGENT_PROVIDERS.includes(provider.provider as AgentProvider)) continue
    capabilities[provider.provider as AgentProvider] = {
      oauthAvailable: provider.oauthAvailable,
      apiKeyAvailable: provider.apiKeyAvailable,
      modelIds: provider.modelIds
        .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.length <= 500)
        .slice(0, 1_000)
    }
  }
  return capabilities
}

function isAuthWorkerMessage(value: unknown): value is AgentWorkerAuthMessage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { channel?: unknown }).channel === 'auth' &&
    [
      'ready',
      'capabilities',
      'url',
      'device-code',
      'prompt',
      'progress',
      'completed',
      'failed',
      'cancelled'
    ].includes(String((value as { type?: unknown }).type))
  )
}

function messageWithinLimit(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_AUTH_IPC_BYTES
  } catch {
    return false
  }
}

function safeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/\S+/gi, '[authorization URL removed]')
    .replace(
      /((?:access_token|refresh_token|id_token|authorization_code|code_verifier|device_code|access|refresh)\s*["']?\s*[:=]\s*["']?)[^"',}\s]+/gi,
      '$1[sensitive value removed]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT removed]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[sensitive value removed]')
    .slice(0, 2_000)
}
