import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AssistantMessage,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential,
  CredentialInfo,
  CredentialStore,
  ModelsStore,
  ModelsStoreEntry
} from '@earendil-works/pi-ai'
import type {
  AgentWorkerControlMessage,
  AgentWorkerMessage,
  AgentWorkerOptions
} from './contracts.js'
import {
  discoverCustomModels,
  registerCustomProvider
} from './custom-provider.js'

const MAX_IPC_BYTES = 3 * 1024 * 1024
const WORKER_OPTIONS_ENV = 'ALADDEEN_AGENT_WORKER_OPTIONS'
const RUNTIME_ROOT_ENV = 'ALADDEEN_PI_RUNTIME_ROOT'

type PiModule = typeof import('@earendil-works/pi-coding-agent')
type PiModelRuntime = Awaited<ReturnType<PiModule['ModelRuntime']['create']>>

const options = parseOptions(process.env[WORKER_OPTIONS_ENV])
const abortController = new AbortController()
const credentialResponses = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()
const modelsStoreResponses = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()
const promptResponses = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void; cleanup: () => void }
>()

process.on('message', (message: AgentWorkerControlMessage) => {
  if (!ipcMessageWithinLimit(message)) return
  if (message.channel === 'models-store-response') {
    const pending = modelsStoreResponses.get(message.requestId)
    if (!pending) return
    modelsStoreResponses.delete(message.requestId)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error))
    return
  }
  if (message.channel === 'credential-response') {
    const pending = credentialResponses.get(message.requestId)
    if (!pending) return
    credentialResponses.delete(message.requestId)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error))
    return
  }
  if (message.channel !== 'auth-control') return
  if (message.type === 'cancel') {
    abortController.abort()
    rejectPrompts(new Error('Login cancelled.'))
    return
  }
  const pending = promptResponses.get(message.promptId)
  if (!pending) return
  promptResponses.delete(message.promptId)
  pending.cleanup()
  pending.resolve(message.value)
})

process.on('disconnect', () => {
  abortController.abort()
  rejectPrompts(new Error('The Aladdeen credential bridge disconnected.'))
  for (const pending of modelsStoreResponses.values()) {
    pending.reject(new Error('The Aladdeen model-store bridge disconnected.'))
  }
  modelsStoreResponses.clear()
})

class IpcCredentialStore implements CredentialStore {
  private readonly queues = new Map<string, Promise<unknown>>()

  async read(providerId: string): Promise<Credential | undefined> {
    return requestCredential('read', providerId) as Promise<Credential | undefined>
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return requestCredential('list') as Promise<readonly CredentialInfo[]>
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    const previous = this.queues.get(providerId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      const current = await this.read(providerId)
      const next = await fn(current)
      if (next === undefined) return current
      await requestCredential('write', providerId, next)
      return next
    })
    this.queues.set(providerId, operation)
    try {
      return await operation
    } finally {
      if (this.queues.get(providerId) === operation) this.queues.delete(providerId)
    }
  }

  async delete(providerId: string): Promise<void> {
    const previous = this.queues.get(providerId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      await requestCredential('delete', providerId)
    })
    this.queues.set(providerId, operation)
    try {
      await operation
    } finally {
      if (this.queues.get(providerId) === operation) this.queues.delete(providerId)
    }
  }
}

class IpcModelsStore implements ModelsStore {
  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    return requestModelsStore('read', providerId) as Promise<ModelsStoreEntry | undefined>
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    await requestModelsStore('write', providerId, entry)
  }

  async delete(providerId: string): Promise<void> {
    await requestModelsStore('delete', providerId)
  }
}

async function main(): Promise<void> {
  const pi = await loadPi()
  const credentialStore = new IpcCredentialStore()
  const modelRuntime = await pi.ModelRuntime.create({
    credentials: credentialStore,
    modelsStore: new IpcModelsStore(),
    modelsPath: null,
    // Network catalog access is always explicit below. Keeping create() offline
    // prevents it from refreshing every configured dynamic provider.
    allowModelNetwork: false
  })
  const runtimeRoot = required(process.env[RUNTIME_ROOT_ENV], 'pi runtime')
  if (options.profile) {
    await registerCustomProvider(modelRuntime, options.profile, runtimeRoot)
  }

  if (options.mode === 'capabilities') {
    await sendFlushed({
      channel: 'auth',
      type: 'capabilities',
      providers: modelRuntime.getProviders().map((provider) => ({
        provider: provider.id,
        name: provider.name,
        oauthAvailable: provider.auth.oauth !== undefined,
        apiKeyAvailable: provider.auth.apiKey?.login !== undefined,
        dynamicCatalog: provider.refreshModels !== undefined,
        models: provider.getModels().map((model) => ({
          provider: provider.id,
          id: model.id,
          name: model.name,
          supportsThinking: model.reasoning,
          protocol: model.api as never,
          supportsVision: model.input.includes('image'),
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxTokens,
          source: 'pi'
        }))
      }))
    })
    return
  }
  if (options.mode === 'login') {
    await runLogin(modelRuntime)
    return
  }
  if (options.mode === 'discover') {
    const profile = required(options.profile, 'custom provider profile')
    const credential = await credentialStore.read(profile.id)
    await sendFlushed({
      channel: 'auth',
      type: 'models',
      provider: profile.id,
      models: await discoverCustomModels(profile, credential)
    })
    return
  }
  if (options.mode === 'refresh') {
    const provider = required(options.provider, 'provider')
    for (const candidate of modelRuntime.getProviders()) {
      if (candidate.id !== provider) modelRuntime.unregisterProvider(candidate.id)
    }
    const refresh = await modelRuntime.refresh({
      allowNetwork: true,
      force: true,
      signal: abortController.signal
    })
    const refreshError = refresh.errors.get(provider)
    if (refreshError) throw refreshError
    await sendFlushed({
      channel: 'auth',
      type: 'models',
      provider,
      models: modelRuntime.getModels(provider).map((model) => ({
        provider,
        id: model.id,
        name: model.name,
        supportsThinking: model.reasoning,
        protocol: model.api as never,
        supportsVision: model.input.includes('image'),
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxTokens,
        source: options.profile ? 'custom' : 'pi'
      }))
    })
    return
  }
  if (options.mode === 'verify') {
    await runVerification(modelRuntime)
    return
  }
  await runSession(pi, modelRuntime)
}

async function runLogin(modelRuntime: PiModelRuntime): Promise<void> {
  const provider = required(options.provider, 'provider')
  const runtimeProvider = modelRuntime.getProvider(provider)
  const authType = options.authType ?? 'oauth'
  if (
    !runtimeProvider ||
    authType === 'oauth' && !runtimeProvider.auth.oauth ||
    authType === 'api_key' && !runtimeProvider.auth.apiKey?.login
  ) {
    throw new Error(`${provider} does not support ${authType === 'oauth' ? 'account' : 'API-key'} login in this pi runtime.`)
  }
  send({ channel: 'auth', type: 'ready' })
  const interaction: AuthInteraction = {
    signal: abortController.signal,
    prompt: promptUser,
    notify: notifyAuth
  }
  try {
    await modelRuntime.login(provider, authType, interaction)
    if (abortController.signal.aborted) {
      send({ channel: 'auth', type: 'cancelled' })
      return
    }
    send({ channel: 'auth', type: 'completed' })
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      send({ channel: 'auth', type: 'cancelled' })
      return
    }
    send({ channel: 'auth', type: 'failed', message: safeError(error) })
    process.exitCode = 1
  }
}

async function consumeVerificationStream(
  stream: ReturnType<PiModelRuntime['streamSimple']>
): Promise<AssistantMessage> {
  let started = false
  let terminal: AssistantMessage | undefined
  for await (const event of stream) {
    if (event.type === 'start') started = true
    if (event.type === 'done') terminal = event.message
    if (event.type === 'error') throw new Error(event.error.errorMessage ?? 'The provider stream failed.')
  }
  if (!started || !terminal) throw new Error('The provider did not return a valid streaming response.')
  return terminal
}

async function runVerification(modelRuntime: PiModelRuntime): Promise<void> {
  const provider = required(options.provider, 'provider')
  const modelId = required(options.modelId, 'model')
  const model = modelRuntime.getModel(provider, modelId)
  if (!model) throw new Error(`Model ${provider}/${modelId} is unavailable.`)
  const signal = AbortSignal.any([abortController.signal, AbortSignal.timeout(60_000)])
  const userMessage = {
    role: 'user' as const,
    content: 'Call aladdeen_compatibility_probe exactly once with value "ok". Do not answer in text.',
    timestamp: Date.now()
  }
  const first = await consumeVerificationStream(modelRuntime.streamSimple(model, {
    systemPrompt: 'This is a compatibility check. Follow the user instruction exactly.',
    messages: [userMessage],
    tools: [{
      name: 'aladdeen_compatibility_probe',
      description: 'Verifies that this model can call coding-agent tools.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string', const: 'ok' } },
        required: ['value'],
        additionalProperties: false
      } as never
    }]
  }, {
    signal,
    maxTokens: 64,
    onPayload(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
      const record = payload as Record<string, unknown>
      if (model.api === 'anthropic-messages') {
        return {
          ...record,
          tool_choice: { type: 'tool', name: 'aladdeen_compatibility_probe' }
        }
      }
      if (model.api === 'openai-responses') {
        return {
          ...record,
          tool_choice: { type: 'function', name: 'aladdeen_compatibility_probe' }
        }
      }
      return {
        ...record,
        tool_choice: {
          type: 'function',
          function: { name: 'aladdeen_compatibility_probe' }
        }
      }
    },
    ...(model.reasoning ? { reasoning: 'medium' as const } : {})
  }))
  const toolCall = first.content.find((block) => block.type === 'toolCall')
  if (
    !toolCall ||
    toolCall.name !== 'aladdeen_compatibility_probe' ||
    toolCall.arguments.value !== 'ok'
  ) {
    throw new Error('The model did not produce the required valid tool call.')
  }
  const second = await consumeVerificationStream(modelRuntime.streamSimple(model, {
    systemPrompt: 'This is a compatibility check. After a successful tool result, reply ALADDEEN_OK.',
    messages: [
      userMessage,
      first,
      {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: 'success' }],
        isError: false,
        timestamp: Date.now()
      }
    ]
  }, { signal, maxTokens: 64 }))
  const text = second.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (!text.includes('ALADDEEN_OK')) {
    throw new Error('The model could not continue after a tool result.')
  }
  await sendFlushed({
    channel: 'auth',
    type: 'verified',
    provider,
    model: {
      provider,
      id: model.id,
      name: model.name,
      supportsThinking: model.reasoning,
      protocol: model.api as never,
      supportsVision: model.input.includes('image'),
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      source: options.profile ? 'custom' : 'pi',
      verified: true
    }
  })
}

async function runSession(pi: PiModule, modelRuntime: PiModelRuntime): Promise<never> {
  const cwd = required(options.cwd, 'cwd')
  const agentDir = required(options.agentDirectory, 'agent directory')
  const sessionDirectory = required(options.sessionDirectory, 'session directory')
  const provider = required(options.provider, 'provider')
  const modelId = required(options.modelId, 'model')
  const approvalExtensionPath = required(options.approvalExtensionPath, 'approval extension')
  const model = modelRuntime.getModel(provider, modelId)
  if (!model) throw new Error(`Model ${provider}/${modelId} is not available in the pinned pi runtime.`)

  const createRuntime: import('@earendil-works/pi-coding-agent').CreateAgentSessionRuntimeFactory =
    async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
      const services = await pi.createAgentSessionServices({
        cwd: runtimeCwd,
        agentDir,
        modelRuntime,
        resourceLoaderOptions: {
          additionalExtensionPaths: [approvalExtensionPath]
        }
      })
      return {
        ...(await pi.createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model,
          thinkingLevel: options.thinkingLevel as never,
          tools: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash']
        })),
        services,
        diagnostics: services.diagnostics
      }
    }

  const runtime = await pi.createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: pi.SessionManager.create(cwd, sessionDirectory)
  })
  return pi.runRpcMode(runtime)
}

async function promptUser(prompt: AuthPrompt): Promise<string> {
  if (abortController.signal.aborted || prompt.signal?.aborted) throw new Error('Login cancelled.')
  const promptId = randomUUID()
  send({
    channel: 'auth',
    type: 'prompt',
    promptId,
    promptType: prompt.type,
    message: prompt.message.slice(0, 2_000),
    ...('placeholder' in prompt && prompt.placeholder
      ? { placeholder: prompt.placeholder.slice(0, 500) }
      : {}),
    ...(prompt.type === 'select'
      ? {
          options: prompt.options.slice(0, 20).map((option) => ({
            id: option.id.slice(0, 200),
            label: option.label.slice(0, 500),
            ...(option.description ? { description: option.description.slice(0, 1_000) } : {})
          }))
        }
      : {})
  })
  return new Promise<string>((resolve, reject) => {
    const onAbort = (): void => {
      promptResponses.delete(promptId)
      cleanup()
      reject(new Error('Login cancelled.'))
    }
    const cleanup = (): void => {
      abortController.signal.removeEventListener('abort', onAbort)
      prompt.signal?.removeEventListener('abort', onAbort)
    }
    abortController.signal.addEventListener('abort', onAbort, { once: true })
    prompt.signal?.addEventListener('abort', onAbort, { once: true })
    promptResponses.set(promptId, { resolve, reject, cleanup })
  })
}

function notifyAuth(event: AuthEvent): void {
  if (event.type === 'auth_url') {
    send({ channel: 'auth', type: 'url', url: event.url, kind: 'browser' })
    if (event.instructions) {
      send({ channel: 'auth', type: 'progress', message: event.instructions.slice(0, 2_000) })
    }
    return
  }
  if (event.type === 'device_code') {
    send({
      channel: 'auth',
      type: 'device-code',
      userCode: event.userCode.slice(0, 200),
      verificationUri: event.verificationUri,
      intervalSeconds: event.intervalSeconds,
      expiresInSeconds: event.expiresInSeconds
    })
    return
  }
  send({
    channel: 'auth',
    type: 'progress',
    message: event.message.slice(0, 2_000)
  })
}

function requestCredential(
  operation: 'read' | 'list' | 'write' | 'delete',
  providerId?: string,
  credential?: Credential
): Promise<unknown> {
  const requestId = randomUUID()
  send({
    channel: 'credential',
    requestId,
    operation,
    ...(providerId ? { providerId } : {}),
    ...(credential ? { credential } : {})
  } as AgentWorkerMessage)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      credentialResponses.delete(requestId)
      reject(new Error('The encrypted credential bridge timed out.'))
    }, 15_000)
    credentialResponses.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}

function requestModelsStore(
  operation: 'read' | 'write' | 'delete',
  providerId: string,
  entry?: unknown
): Promise<unknown> {
  if (!process.send || !process.connected) {
    return Promise.reject(new Error('The Aladdeen model-store bridge is unavailable.'))
  }
  const requestId = randomUUID()
  const response = new Promise<unknown>((resolve, reject) => {
    modelsStoreResponses.set(requestId, { resolve, reject })
  })
  const message = operation === 'write'
    ? { channel: 'models-store' as const, requestId, operation, providerId, entry }
    : { channel: 'models-store' as const, requestId, operation, providerId }
  if (!ipcMessageWithinLimit(message)) {
    modelsStoreResponses.delete(requestId)
    return Promise.reject(new Error('The model-store message exceeded the IPC limit.'))
  }
  process.send(message)
  return response
}

function send(message: AgentWorkerMessage): void {
  if (!process.send || !process.connected) throw new Error('The encrypted credential bridge is unavailable.')
  if (!ipcMessageWithinLimit(message)) throw new Error('The agent worker IPC message is too large.')
  process.send(message)
}

function sendFlushed(message: AgentWorkerMessage): Promise<void> {
  if (!process.send || !process.connected) {
    return Promise.reject(new Error('The encrypted credential bridge is unavailable.'))
  }
  if (!ipcMessageWithinLimit(message)) {
    return Promise.reject(new Error('The agent worker IPC message is too large.'))
  }
  return new Promise<void>((resolve, reject) => {
    process.send?.(message, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function parseOptions(value: string | undefined): AgentWorkerOptions {
  if (!value || Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('Missing agent worker options.')
  const parsed = JSON.parse(value) as AgentWorkerOptions
  if (
    !parsed ||
    !['session', 'login', 'capabilities', 'refresh', 'discover', 'verify'].includes(parsed.mode)
  ) {
    throw new Error('Invalid agent worker mode.')
  }
  return parsed
}

async function loadPi(): Promise<PiModule> {
  const runtimeRoot = required(process.env[RUNTIME_ROOT_ENV], 'pi runtime')
  const entry = join(
    runtimeRoot,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'index.js'
  )
  return import(pathToFileURL(entry).href) as Promise<PiModule>
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === '') throw new Error(`Missing ${label}.`)
  return value
}

function ipcMessageWithinLimit(message: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(message), 'utf8') <= MAX_IPC_BYTES
  } catch {
    return false
  }
}

function rejectPrompts(error: Error): void {
  for (const pending of promptResponses.values()) {
    pending.cleanup()
    pending.reject(error)
  }
  promptResponses.clear()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`)
}

function safeError(error: unknown): string {
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

void main().then(() => {
  if (options.mode !== 'session') {
    setImmediate(() => {
      if (process.connected) process.disconnect()
      setTimeout(() => process.exit(process.exitCode ?? 0), 50)
    })
  }
}).catch((error: unknown) => {
  if (options.mode !== 'session' && options.mode !== 'capabilities') {
    send({
      channel: 'auth',
      type: abortController.signal.aborted ? 'cancelled' : 'failed',
      ...(abortController.signal.aborted ? {} : { message: safeError(error) })
    } as AgentWorkerMessage)
  } else {
    process.stderr.write(`${safeError(error)}\n`)
  }
  process.exitCode = 1
  setImmediate(() => {
    if (process.connected) process.disconnect()
    setTimeout(() => process.exit(process.exitCode ?? 1), 50)
  })
})
