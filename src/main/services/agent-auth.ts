import { createHash, randomUUID } from 'node:crypto'
import { shell, type BrowserWindow } from 'electron'
import { DesktopError } from '@main/errors'
import {
  type AgentCapabilities,
  type AgentCredentialVault
} from '@main/services/agent-credentials'
import { validateAgentEndpoint } from '@main/services/agent-endpoints'
import {
  bindCredentialBridge,
  bindModelsStoreBridge,
  spawnAgentWorker,
  type AgentWorkerChild
} from '@main/services/agent-worker-host'
import {
  FEATURED_AGENT_PROVIDER_IDS,
  defaultModelForProvider,
  isFeaturedAgentProvider,
  providerDisplayName
} from '@shared/agent-providers'
import type {
  AgentWorkerAuthMessage,
  AgentWorkerModel,
  AgentWorkerOptions,
  AgentWorkerProviderProfile
} from '@shared/agent-worker'
import {
  IPC,
  type AgentAuthEvent,
  type AgentAuthType,
  type AgentCredentialStatus,
  type AgentModel,
  type AgentProviderCompatibility,
  type AgentProviderDescriptor,
  type AgentProviderId,
  type AgentProviderProfile,
  type AgentProviderProfileInput
} from '@shared/contracts'
import type { AppDatabase } from './database'

const MAX_AUTH_IPC_BYTES = 8 * 1024 * 1024
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,199}$/
const CUSTOM_PROVIDER_PATTERN = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const AUTH_HOSTS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['claude.ai'],
  'openai-codex': ['auth.openai.com'],
  'kimi-coding': ['auth.kimi.com'],
  openrouter: ['openrouter.ai'],
  xai: ['auth.x.ai'],
  'github-copilot': ['github.com'],
  radius: ['radius.pi.dev']
}

interface ActiveLogin {
  id: string
  provider: AgentProviderId
  authType: AgentAuthType
  child: AgentWorkerChild
  detachCredentialBridge: () => void
  detachModelsStoreBridge: () => void
  pendingPrompts: Set<string>
  approvedHosts: Set<string>
  loginUrl?: string
  stderr: string
  terminal: boolean
  cancelling: boolean
}

export class AgentAuthService {
  private active?: ActiveLogin
  private readonly workers = new Set<AgentWorkerChild>()
  private providerOperation?: string
  private capabilitiesLoaded = false
  private capabilitiesLoading?: Promise<void>

  constructor(
    private readonly database: AppDatabase,
    private readonly vault: AgentCredentialVault,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly stopAgentSession: (providerId?: AgentProviderId) => Promise<void>,
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
    private readonly createWorker: typeof spawnAgentWorker = spawnAgentWorker
  ) {}

  async credentialStatus(): Promise<AgentCredentialStatus> {
    if (this.database.getSettings().agentEnabled && !this.active) {
      await this.refreshCapabilities().catch(() => undefined)
    }
    return this.vault.status()
  }

  async getProviderCatalog(): Promise<AgentProviderDescriptor[]> {
    this.requireEnabled('load provider capabilities')
    await this.refreshCapabilities()
    const statuses = await this.vault.status()
    const connected = new Set(
      statuses.providers.filter((status) => status.configured).map((status) => status.providerId)
    )
    const descriptors: AgentProviderDescriptor[] = Object.entries(this.vault.getCapabilities())
      .filter(([, capability]) => (
        capability.oauthAvailable || capability.apiKeyAvailable || capability.dynamicCatalog
      ))
      .map(([id, capability]) => ({
        id,
        name: providerDisplayName(id) === id ? capability.name : providerDisplayName(id),
        source: 'native' as const,
        featured: isFeaturedAgentProvider(id),
        oauthAvailable: capability.oauthAvailable,
        apiKeyAvailable: capability.apiKeyAvailable,
        modelCount: this.database.getAgentModelCache(id)?.models.length ?? capability.models.length,
        catalogKind: capability.dynamicCatalog ? 'dynamic' as const : 'bundled' as const
      }))
    for (const profile of this.database.listAgentProviderProfiles()) {
      descriptors.push({
        id: profile.id,
        name: profile.name,
        source: 'custom',
        featured: false,
        oauthAvailable: false,
        apiKeyAvailable: profile.authScheme !== 'none',
        modelCount: profile.models.length,
        catalogKind: profile.catalogMode
      })
    }
    const featuredIndex = new Map<string, number>(
      FEATURED_AGENT_PROVIDER_IDS.map((provider, index) => [provider, index])
    )
    return descriptors.sort((left, right) => {
      const leftFeatured = featuredIndex.get(left.id)
      const rightFeatured = featuredIndex.get(right.id)
      if (leftFeatured !== undefined || rightFeatured !== undefined) {
        return (leftFeatured ?? Number.MAX_SAFE_INTEGER) - (rightFeatured ?? Number.MAX_SAFE_INTEGER)
      }
      const connectedDifference = Number(connected.has(right.id)) - Number(connected.has(left.id))
      return connectedDifference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    })
  }

  getProviderProfiles(): AgentProviderProfile[] {
    return this.database.listAgentProviderProfiles().map((profile) => ({
      ...profile,
      compatibility: { ...profile.compatibility },
      models: this.profileModelsWithVerification(profile)
    }))
  }

  validateDefaultModelSelection(providerId: AgentProviderId, modelId: string): void {
    const profile = this.database.getAgentProviderProfile(providerId)
    if (!profile || !modelId) return
    const model = profile.models.find((candidate) => candidate.id === modelId)
    if (!model) {
      throw new DesktopError('NOT_FOUND', 'That custom model is not configured for this provider.')
    }
    const verification = this.database.getAgentModelVerification(providerId, modelId)
    if (
      model.metadataConfirmed !== true ||
      verification?.configHash !== verificationFingerprint(profile, model)
    ) {
      throw new DesktopError(
        'PERMISSION_DENIED',
        'Run the compatibility test before making this custom model the default.'
      )
    }
  }

  async getModelCatalog(): Promise<AgentModel[]> {
    this.requireEnabled('load available models')
    await this.refreshCapabilities()
    const models: AgentModel[] = []
    for (const [provider, capability] of Object.entries(this.vault.getCapabilities())) {
      const cached = this.database.getAgentModelCache(provider)?.models
      models.push(...(cached ?? capability.models).map((model) => ({
        ...model,
        provider,
        source: model.source ?? 'pi',
        verified: true
      })))
    }
    for (const profile of this.database.listAgentProviderProfiles()) {
      models.push(...this.profileModelsWithVerification(profile))
    }
    return deduplicateModels(models)
  }

  async createProviderProfile(input: AgentProviderProfileInput): Promise<AgentProviderProfile> {
    this.requireEnabled('add a custom provider')
    const id = `custom:${randomUUID()}`
    const profile = await this.buildProfile(id, input, Date.now())
    this.database.saveAgentProviderProfile(profile)
    return profile
  }

  async updateProviderProfile(
    providerId: AgentProviderId,
    input: AgentProviderProfileInput
  ): Promise<AgentProviderProfile> {
    this.requireEnabled('edit a custom provider')
    this.requireCustomProviderId(providerId)
    const existing = this.database.getAgentProviderProfile(providerId)
    if (!existing) throw new DesktopError('NOT_FOUND', 'That custom provider no longer exists.')
    await this.cancelActiveLogin()
    await this.stopAgentSession(providerId)
    const profile = await this.buildProfile(providerId, input, existing.createdAt)
    this.database.saveAgentProviderProfile(profile)
    return { ...profile, models: this.profileModelsWithVerification(profile) }
  }

  async deleteProviderProfile(providerId: AgentProviderId): Promise<void> {
    this.requireEnabled('delete a custom provider')
    this.requireCustomProviderId(providerId)
    if (!this.database.getAgentProviderProfile(providerId)) {
      throw new DesktopError('NOT_FOUND', 'That custom provider no longer exists.')
    }
    await this.cancelActiveLogin()
    await this.stopAgentSession(providerId)
    this.database.deleteAgentProviderProfile(providerId)
    const settings = this.database.getSettings()
    if (settings.agentProvider === providerId) {
      this.database.setSettings({
        ...settings,
        agentProvider: 'anthropic',
        agentModelId: defaultModelForProvider('anthropic')
      })
    }
  }

  async discoverModels(providerId: AgentProviderId): Promise<AgentModel[]> {
    return this.runExclusiveProviderOperation('model discovery', async () => {
      this.requireEnabled('discover provider models')
      const profile = this.requireProfile(providerId)
      if (profile.protocol === 'anthropic-messages' || profile.catalogMode !== 'remote') {
        throw new DesktopError(
          'INVALID_PATH',
          'This provider uses manual model entry because its protocol has no compatible discovery endpoint.'
        )
      }
      await this.stopAgentSession(providerId)
      const message = await this.runWorkerForMessage(
        { mode: 'discover', provider: providerId, profile: toWorkerProfile(profile) },
        (candidate): candidate is Extract<AgentWorkerAuthMessage, { type: 'models' }> => (
          candidate.type === 'models' && candidate.provider === providerId
        ),
        35_000
      )
      const models = sanitizeWorkerModels(providerId, message.models, profile.protocol, 'discovered')
      if (!models.length) throw new DesktopError('NOT_FOUND', 'The provider returned no usable models.')
      const updated = { ...profile, models, updatedAt: Date.now() }
      this.database.clearAgentModelVerifications(providerId)
      this.database.saveAgentProviderProfile(updated)
      this.database.setAgentModelCache(providerId, models)
      return this.profileModelsWithVerification(updated)
    })
  }

  async refreshModelCatalog(providerId: AgentProviderId): Promise<AgentModel[]> {
    return this.runExclusiveProviderOperation('catalog refresh', async () => {
      this.requireEnabled('refresh provider models')
      validateProviderId(providerId)
      await this.refreshCapabilities()
      const profile = this.database.getAgentProviderProfile(providerId)
      if (!profile && !this.vault.getCapabilities()[providerId]) {
        throw new DesktopError('NOT_FOUND', 'That provider is not available in the pinned pi runtime.')
      }
      await this.stopAgentSession(providerId)
      const message = await this.runWorkerForMessage(
        {
          mode: 'refresh',
          provider: providerId,
          ...(profile ? { profile: toWorkerProfile(profile) } : {})
        },
        (candidate): candidate is Extract<AgentWorkerAuthMessage, { type: 'models' }> => (
          candidate.type === 'models' && candidate.provider === providerId
        ),
        60_000
      )
      const models = sanitizeWorkerModels(
        providerId,
        message.models,
        profile?.protocol,
        profile ? 'discovered' : 'pi'
      )
      this.database.setAgentModelCache(providerId, models)
      if (profile) {
        const updated = { ...profile, models, updatedAt: Date.now() }
        this.database.clearAgentModelVerifications(providerId)
        this.database.saveAgentProviderProfile(updated)
        return this.profileModelsWithVerification(updated)
      }
      const capabilities = this.vault.getCapabilities()
      this.vault.setCapabilities({
        ...capabilities,
        [providerId]: { ...capabilities[providerId]!, models }
      })
      return models.map((model) => ({ ...model, verified: true }))
    })
  }

  async verifyModel(providerId: AgentProviderId, modelId: string): Promise<AgentModel> {
    return this.runExclusiveProviderOperation('compatibility test', async () => {
      this.requireEnabled('verify a custom model')
      const profile = this.requireProfile(providerId)
      const model = profile.models.find((item) => item.id === modelId)
      if (!model) throw new DesktopError('NOT_FOUND', 'That model is not configured for this provider.')
      if (model.metadataConfirmed !== true) {
        throw new DesktopError(
          'PERMISSION_DENIED',
          'Review and save the model metadata before running the compatibility test.'
        )
      }
      await this.stopAgentSession(providerId)
      const message = await this.runWorkerForMessage(
        {
          mode: 'verify',
          provider: providerId,
          modelId,
          profile: toWorkerProfile(profile)
        },
        (candidate): candidate is Extract<AgentWorkerAuthMessage, { type: 'verified' }> => (
          candidate.type === 'verified' &&
          candidate.provider === providerId &&
          candidate.model.id === modelId
        ),
        75_000
      )
      const verified = sanitizeWorkerModels(
        providerId,
        [message.model],
        profile.protocol,
        model.source ?? 'custom'
      )[0]
      if (!verified) throw new DesktopError('INTERNAL', 'The compatibility probe returned an invalid model.')
      this.database.setAgentModelVerification(
        providerId,
        modelId,
        verificationFingerprint(profile, model)
      )
      return { ...verified, verified: true }
    })
  }

  async disconnectProvider(provider: AgentProviderId): Promise<void> {
    validateProviderId(provider)
    await this.cancelActiveLogin()
    await this.stopAgentSession(provider)
    this.vault.delete(provider)
  }

  async beginLogin(
    provider: AgentProviderId,
    authType: AgentAuthType = 'oauth'
  ): Promise<{ attemptId: string }> {
    this.requireEnabled('connect an account')
    validateProviderId(provider)
    if (!this.vault.encryptionAvailable()) {
      throw new DesktopError('PERMISSION_DENIED', 'Secure credential storage is unavailable on this Mac.')
    }
    if (this.active || this.providerOperation) {
      throw new DesktopError('CONFLICT', 'Another provider operation is already in progress.')
    }
    await this.refreshCapabilities()
    const profile = this.database.getAgentProviderProfile(provider)
    const capability = this.vault.getCapabilities()[provider]
    const available = authType === 'oauth'
      ? capability?.oauthAvailable
      : capability?.apiKeyAvailable ?? Boolean(profile && profile.authScheme !== 'none')
    if (!available) {
      throw new DesktopError(
        'INVALID_PATH',
        `${provider} does not support ${authType === 'oauth' ? 'account' : 'API-key'} login in the pinned pi runtime.`
      )
    }
    await this.stopAgentSession()

    const attemptId = randomUUID()
    const child = this.createWorker({
      mode: 'login',
      provider,
      authType,
      ...(profile ? { profile: toWorkerProfile(profile) } : {})
    })
    const login: ActiveLogin = {
      id: attemptId,
      provider,
      authType,
      child,
      detachCredentialBridge: () => undefined,
      detachModelsStoreBridge: () => undefined,
      pendingPrompts: new Set(),
      approvedHosts: new Set(),
      stderr: '',
      terminal: false,
      cancelling: false
    }
    login.detachCredentialBridge = bindCredentialBridge(child, this.vault)
    login.detachModelsStoreBridge = bindModelsStoreBridge(child, this.database)
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
    if (Buffer.byteLength(value, 'utf8') > 32 * 1024) {
      throw new DesktopError('INVALID_PATH', 'The login response is too large.')
    }
    if (login.provider === 'github-copilot' && value.trim()) {
      const candidate = value.includes('://') ? value : `https://${value}`
      let url: URL
      try {
        url = new URL(candidate)
      } catch {
        throw new DesktopError('INVALID_PATH', 'Enter a public HTTPS GitHub Enterprise domain.')
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['', '/'].includes(url.pathname)
      ) throw new DesktopError('INVALID_PATH', 'Enter a public HTTPS GitHub Enterprise domain.')
      await validateAgentEndpoint(url.origin, 'public_https')
      login.approvedHosts.add(url.hostname.toLowerCase())
    }
    if (!login.child.connected) throw new DesktopError('NOT_FOUND', 'The login worker has already stopped.')
    login.child.send({ channel: 'auth-control', type: 'prompt-response', promptId, value })
  }

  async reopenLoginUrl(attemptId: string): Promise<void> {
    const login = this.requireLogin(attemptId)
    if (!login.loginUrl) throw new DesktopError('NOT_FOUND', 'No browser login URL is available yet.')
    await this.openExternal(login.loginUrl)
    this.emit({ type: 'browser-opened', attemptId, provider: login.provider })
  }

  async cancelLogin(attemptId: string): Promise<void> {
    await this.cancel(this.requireLogin(attemptId))
  }

  async close(): Promise<void> {
    await this.cancelActiveLogin()
    const workers = [...this.workers]
    for (const child of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }
    await Promise.all(workers.map((child) => Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000))
    ])))
  }

  private async buildProfile(
    id: AgentProviderId,
    input: AgentProviderProfileInput,
    createdAt: number
  ): Promise<AgentProviderProfile> {
    this.requireCustomProviderId(id)
    if (input.authScheme === 'none' && input.endpointScope !== 'loopback') {
      throw new DesktopError('PERMISSION_DENIED', 'Unauthenticated providers are allowed only on loopback.')
    }
    if (input.catalogMode === 'remote' && input.protocol === 'anthropic-messages') {
      throw new DesktopError(
        'INVALID_PATH',
        'Anthropic-compatible providers require manual model entry.'
      )
    }
    const endpoint = await validateAgentEndpoint(input.baseUrl, input.endpointScope)
    const name = input.name.trim()
    if (!name || name.length > 100) throw new DesktopError('INVALID_PATH', 'Enter a provider name.')
    const seen = new Set<string>()
    const models: AgentModel[] = []
    for (const item of input.models.slice(0, 2_000)) {
      const modelId = item.id.trim()
      if (!modelId || modelId.length > 200 || seen.has(modelId)) continue
      seen.add(modelId)
      models.push({
        provider: id,
        id: modelId,
        name: item.name?.trim().slice(0, 300) || modelId,
        supportsThinking: item.supportsThinking,
        protocol: input.protocol,
        supportsVision: item.supportsVision,
        contextWindow: item.contextWindow,
        maxOutputTokens: item.maxOutputTokens,
        source: 'custom',
        metadataConfirmed: true,
        verified: false
      })
    }
    if (input.catalogMode === 'manual' && models.length === 0) {
      throw new DesktopError('INVALID_PATH', 'Add at least one model to a manual provider catalog.')
    }
    return {
      id,
      name,
      protocol: input.protocol,
      baseUrl: endpoint.normalizedUrl,
      endpointScope: input.endpointScope,
      authScheme: input.authScheme,
      catalogMode: input.catalogMode,
      compatibility: {
        ...defaultCompatibility(input.protocol),
        ...input.compatibility
      },
      models,
      createdAt,
      updatedAt: Date.now()
    }
  }

  private profileModelsWithVerification(profile: AgentProviderProfile): AgentModel[] {
    return profile.models.map((model) => ({
      ...model,
      provider: profile.id,
      protocol: profile.protocol,
      source: model.source ?? 'custom',
      metadataConfirmed: model.metadataConfirmed === true,
      verified: model.metadataConfirmed === true &&
        this.database.getAgentModelVerification(profile.id, model.id)?.configHash ===
          verificationFingerprint(profile, model)
    }))
  }

  private requireProfile(providerId: AgentProviderId): AgentProviderProfile {
    this.requireCustomProviderId(providerId)
    const profile = this.database.getAgentProviderProfile(providerId)
    if (!profile) throw new DesktopError('NOT_FOUND', 'That custom provider no longer exists.')
    return profile
  }

  private requireCustomProviderId(providerId: AgentProviderId): void {
    if (!CUSTOM_PROVIDER_PATTERN.test(providerId)) {
      throw new DesktopError('INVALID_PATH', 'That provider is not a custom endpoint.')
    }
  }

  private requireEnabled(action: string): void {
    if (!this.database.getSettings().agentEnabled) {
      throw new DesktopError('PERMISSION_DENIED', `Enable the coding agent to ${action}.`)
    }
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
      login.detachModelsStoreBridge()
      if (this.active !== login) return
      this.active = undefined
      if (login.terminal) return
      login.terminal = true
      if (login.cancelling) {
        this.emit({ type: 'cancelled', attemptId: login.id, provider: login.provider })
      } else {
        this.emit({
          type: 'failed',
          attemptId: login.id,
          provider: login.provider,
          message: safeAuthError(login.stderr || `The login worker exited with code ${String(code)}.`)
        })
      }
    })
  }

  private async handleAuthMessage(login: ActiveLogin, message: AgentWorkerAuthMessage): Promise<void> {
    if (message.type === 'ready' || message.type === 'capabilities' ||
      message.type === 'models' || message.type === 'verified') return
    if (message.type === 'url') {
      login.loginUrl = this.validateLoginUrl(login, message.url)
      await this.openExternal(login.loginUrl)
      this.emit({ type: 'browser-opened', attemptId: login.id, provider: login.provider })
      return
    }
    if (message.type === 'device-code') {
      if (typeof message.userCode !== 'string' || message.userCode.length > 200) {
        throw new Error('The login worker sent an invalid device-code event.')
      }
      login.loginUrl = this.validateLoginUrl(login, message.verificationUri)
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
      return
    }
    if (message.type === 'prompt') {
      if (
        typeof message.promptId !== 'string' ||
        typeof message.message !== 'string' ||
        !['text', 'secret', 'select', 'manual_code'].includes(message.promptType)
      ) throw new Error('The login worker sent an invalid prompt event.')
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
        authType: login.authType
      })
      return
    }
    if (message.type === 'cancelled') {
      login.terminal = true
      login.pendingPrompts.clear()
      this.emit({ type: 'cancelled', attemptId: login.id, provider: login.provider })
      return
    }
    if (message.type === 'failed') this.failLogin(login, message.message)
  }

  private selectProviderAfterLogin(provider: AgentProviderId): void {
    const settings = this.database.getSettings()
    const profile = this.database.getAgentProviderProfile(provider)
    const models = profile?.models ?? this.vault.getCapabilities()[provider]?.models ?? []
    const modelIsValid = settings.agentProvider === provider &&
      models.some((model) => model.id === settings.agentModelId)
    this.database.setSettings({
      ...settings,
      agentProvider: provider,
      agentModelId: modelIsValid ? settings.agentModelId : defaultModelForProvider(provider)
    })
  }

  private async refreshCapabilities(): Promise<void> {
    if (this.capabilitiesLoaded || this.active) return
    if (this.capabilitiesLoading) return this.capabilitiesLoading
    const loading = this.discoverCapabilities()
    this.capabilitiesLoading = loading
    try {
      await loading
    } finally {
      if (this.capabilitiesLoading === loading) this.capabilitiesLoading = undefined
    }
  }

  private async discoverCapabilities(): Promise<void> {
    const message = await this.runWorkerForMessage(
      { mode: 'capabilities' },
      (candidate): candidate is Extract<AgentWorkerAuthMessage, { type: 'capabilities' }> => (
        candidate.type === 'capabilities'
      ),
      12_000
    )
    this.vault.setCapabilities(capabilitiesFromWorker(message))
    this.capabilitiesLoaded = true
  }

  private runWorkerForMessage<T extends AgentWorkerAuthMessage>(
    options: AgentWorkerOptions,
    accepts: (message: AgentWorkerAuthMessage) => message is T,
    timeoutMs: number
  ): Promise<T> {
    const child = this.createWorker(options)
    this.workers.add(child)
    const detach = bindCredentialBridge(child, this.vault)
    const detachModelsStore = bindModelsStoreBridge(child, this.database)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16 * 1024)
    })
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        detach()
        detachModelsStore()
        this.workers.delete(child)
        callback()
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      }
      const timeout = setTimeout(() => {
        finish(() => reject(new DesktopError('INTERNAL', 'The provider worker timed out.')))
      }, timeoutMs)
      child.on('message', (value: unknown) => {
        if (!isAuthWorkerMessage(value)) return
        if (!messageWithinLimit(value)) {
          finish(() => reject(new DesktopError('INTERNAL', 'The provider worker sent an oversized response.')))
          return
        }
        if (value.type === 'failed') {
          finish(() => reject(new DesktopError('INTERNAL', safeAuthError(value.message))))
          return
        }
        if (accepts(value)) finish(() => resolve(value))
      })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('exit', (code) => {
        finish(() => reject(new DesktopError(
          'INTERNAL',
          safeAuthError(stderr || `The provider worker exited with code ${String(code)}.`)
        )))
      })
    })
  }

  private async runExclusiveProviderOperation<T>(
    label: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.active || this.providerOperation) {
      throw new DesktopError('CONFLICT', 'Another provider operation is already in progress.')
    }
    this.providerOperation = label
    try {
      return await operation()
    } finally {
      if (this.providerOperation === label) this.providerOperation = undefined
    }
  }

  private validateLoginUrl(login: ActiveLogin, value: string): string {
    const allowedHosts = [
      ...(AUTH_HOSTS[login.provider] ?? []),
      ...login.approvedHosts
    ]
    if (!allowedHosts?.length) throw new Error('Provider has no approved account-login host.')
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      !allowedHosts.includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password
    ) throw new Error('Untrusted provider authorization URL.')
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
      throw new DesktopError('NOT_FOUND', 'That provider login is no longer active.')
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

export function capabilitiesFromWorker(
  message: Extract<AgentWorkerAuthMessage, { type: 'capabilities' }>
): AgentCapabilities {
  if (!Array.isArray(message.providers) || message.providers.length > 200) {
    throw new Error('Pi capability discovery returned an invalid provider list.')
  }
  const capabilities: AgentCapabilities = {}
  for (const item of message.providers as unknown[]) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof (item as { provider?: unknown }).provider !== 'string' ||
      typeof (item as { name?: unknown }).name !== 'string' ||
      typeof (item as { oauthAvailable?: unknown }).oauthAvailable !== 'boolean' ||
      typeof (item as { apiKeyAvailable?: unknown }).apiKeyAvailable !== 'boolean' ||
      typeof (item as { dynamicCatalog?: unknown }).dynamicCatalog !== 'boolean' ||
      !Array.isArray((item as { models?: unknown }).models)
    ) throw new Error('Pi capability discovery returned an invalid provider.')
    const provider = item as {
      provider: string
      name: string
      oauthAvailable: boolean
      apiKeyAvailable: boolean
      dynamicCatalog: boolean
      models: AgentWorkerModel[]
    }
    validateProviderId(provider.provider)
    if (!provider.name || provider.name.length > 300 || capabilities[provider.provider]) continue
    capabilities[provider.provider] = {
      name: provider.name,
      oauthAvailable: provider.oauthAvailable,
      apiKeyAvailable: provider.apiKeyAvailable,
      dynamicCatalog: provider.dynamicCatalog,
      models: sanitizeWorkerModels(provider.provider, provider.models, undefined, 'pi')
    }
  }
  return capabilities
}

function sanitizeWorkerModels(
  provider: AgentProviderId,
  models: unknown[],
  protocol?: AgentModel['protocol'],
  source: NonNullable<AgentModel['source']> = 'pi'
): AgentModel[] {
  if (!Array.isArray(models) || models.length > 2_000) {
    throw new Error('The provider returned an invalid model list.')
  }
  const seen = new Set<string>()
  const result: AgentModel[] = []
  for (const value of models) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const model = value as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    const name = typeof model.name === 'string' ? model.name.trim() : ''
    if (
      !id || id.length > 200 || seen.has(id) ||
      !name || name.length > 300 ||
      typeof model.supportsThinking !== 'boolean'
    ) continue
    seen.add(id)
    result.push({
      provider,
      id,
      name,
      supportsThinking: model.supportsThinking,
      ...(isApiProtocol(model.protocol) ? { protocol: model.protocol } : protocol ? { protocol } : {}),
      ...(typeof model.supportsVision === 'boolean' ? { supportsVision: model.supportsVision } : {}),
      ...(validInteger(model.contextWindow, 1, 4_000_000)
        ? { contextWindow: model.contextWindow as number }
        : {}),
      ...(validInteger(model.maxOutputTokens, 1, 1_000_000)
        ? { maxOutputTokens: model.maxOutputTokens as number }
        : {}),
      source,
      metadataConfirmed: source !== 'discovered',
      verified: source === 'pi'
    })
  }
  return result
}

function deduplicateModels(models: AgentModel[]): AgentModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = `${model.provider}\u0000${model.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function toWorkerProfile(profile: AgentProviderProfile): AgentWorkerProviderProfile {
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    endpointScope: profile.endpointScope,
    authScheme: profile.authScheme,
    catalogMode: profile.catalogMode,
    compatibility: { ...profile.compatibility },
    models: profile.models.map((model) => ({ ...model }))
  }
}

function defaultCompatibility(protocol: AgentProviderProfile['protocol']): AgentProviderCompatibility {
  if (protocol === 'anthropic-messages') {
    return {
      supportsEagerToolInputStreaming: false,
      supportsLongCacheRetention: false,
      supportsCacheControlOnTools: false,
      forceAdaptiveThinking: false,
      supportsStrictTools: false
    }
  }
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    supportsStrictMode: false,
    maxTokensField: 'max_tokens'
  }
}

export function verificationFingerprint(profile: AgentProviderProfile, model: AgentModel): string {
  const value = {
    baseUrl: profile.baseUrl,
    protocol: profile.protocol,
    endpointScope: profile.endpointScope,
    authScheme: profile.authScheme,
    compatibility: profile.compatibility,
    model: {
      id: model.id,
      supportsThinking: model.supportsThinking,
      supportsVision: model.supportsVision,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens
    }
  }
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
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
      'models',
      'verified',
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

function validateProviderId(value: string): void {
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new DesktopError('INVALID_PATH', 'The provider ID is invalid.')
  }
}

function isApiProtocol(value: unknown): value is NonNullable<AgentModel['protocol']> {
  return ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(String(value))
}

function validInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
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
      /((?:access_token|refresh_token|id_token|authorization_code|code_verifier|device_code|api_key|client_secret|password|access|refresh)\s*["']?\s*[:=]\s*["']?)[^"',}\s]+/gi,
      '$1[sensitive value removed]'
    )
    .replace(/(bearer\s+)[^\s"',}]+/gi, '$1[sensitive value removed]')
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[sensitive value removed]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT removed]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[sensitive value removed]')
    .slice(0, 2_000)
}
