import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  app,
  type BrowserWindow
} from 'electron'
import { DesktopError } from '@main/errors'
import type { AgentCredentialVault } from '@main/services/agent-credentials'
import {
  bindCredentialBridge,
  bindModelsStoreBridge,
  spawnAgentWorker,
  type AgentWorkerChild
} from '@main/services/agent-worker-host'
import type { AppDatabase } from '@main/services/database'
import { PiRpcClient, type PiRpcRecord } from '@main/services/agent-rpc'
import { isCustomAgentProviderId } from '@shared/agent-providers'
import {
  IPC,
  type AgentApprovalDecision,
  type AgentEvent,
  type AgentModel,
  type AgentProvider,
  type AgentThinkingLevel
} from '@shared/contracts'

const TOOL_OUTPUT_LIMIT = 16 * 1024
const API_KEY_ENV: Partial<Record<AgentProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  'kimi-coding': 'KIMI_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY'
}

interface ActiveAgentSession {
  id: string
  provider: AgentProvider
  child: ChildProcessWithoutNullStreams | AgentWorkerChild
  client: PiRpcClient
  detachCredentialBridge?: () => void
  currentAssistantId?: string
  stderr: string
  pendingApprovals: Map<string, { toolName: string }>
  stopping: boolean
  terminationReason?: 'stopped' | 'crashed'
  ended: boolean
}

interface AgentEventMapping {
  events: AgentEvent[]
  currentAssistantId?: string
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function truncateText(value: string, limit = TOOL_OUTPUT_LIMIT): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= limit) return { text: value, truncated: false }
  return {
    text: `${bytes.subarray(0, limit).toString('utf8')}\n… output truncated by Aladdeen …`,
    truncated: true
  }
}

function sanitizeInput(input: unknown): Record<string, unknown> {
  const object = objectValue(input)
  if (!object) return {}
  try {
    const serialized = JSON.stringify(object)
    if (Buffer.byteLength(serialized) <= TOOL_OUTPUT_LIMIT) {
      return JSON.parse(serialized) as Record<string, unknown>
    }
    return { preview: truncateText(serialized).text, truncated: true }
  } catch {
    return { preview: '[Unserializable tool input]' }
  }
}

function toolOutput(value: unknown): { text: string; truncated: boolean } {
  const result = objectValue(value)
  const content = Array.isArray(result?.content) ? result.content : []
  const output = content
    .map((item) => {
      const block = objectValue(item)
      return block?.type === 'text' ? stringValue(block.text) ?? '' : ''
    })
    .filter(Boolean)
    .join('\n')
  if (output) return truncateText(output)
  if (value === undefined || value === null) return { text: '', truncated: false }
  try {
    return truncateText(JSON.stringify(value, null, 2))
  } catch {
    return { text: '[Unserializable tool output]', truncated: false }
  }
}

function messageIsAssistant(record: PiRpcRecord): boolean {
  return objectValue(record.message)?.role === 'assistant'
}

function assistantMessageId(record: PiRpcRecord, fallback: () => string): string {
  const message = objectValue(record.message)
  return stringValue(message?.id) ?? stringValue(message?.timestamp) ?? fallback()
}

export function mapPiEvent(
  record: PiRpcRecord,
  sessionId: string,
  currentAssistantId?: string,
  createId: () => string = randomUUID
): AgentEventMapping {
  const events: AgentEvent[] = []
  let messageId = currentAssistantId
  const type = stringValue(record.type)

  if (type === 'agent_start') {
    events.push({ type: 'run-state', sessionId, state: 'running' })
  } else if (type === 'agent_settled') {
    events.push({ type: 'run-state', sessionId, state: 'idle' })
  } else if (type === 'message_start' && messageIsAssistant(record)) {
    messageId = assistantMessageId(record, createId)
    events.push({ type: 'assistant-start', sessionId, messageId })
  } else if (type === 'message_update') {
    const update = objectValue(record.assistantMessageEvent)
    const updateType = stringValue(update?.type)
    if (!messageId) {
      messageId = assistantMessageId(record, createId)
      events.push({ type: 'assistant-start', sessionId, messageId })
    }
    if (updateType === 'text_delta') {
      events.push({ type: 'text-delta', sessionId, messageId, delta: stringValue(update?.delta) ?? '' })
    } else if (updateType === 'thinking_delta') {
      events.push({ type: 'thinking-delta', sessionId, messageId, delta: stringValue(update?.delta) ?? '' })
    } else if (updateType === 'text_end' || updateType === 'thinking_end') {
      events.push({
        type: 'block-end',
        sessionId,
        messageId,
        block: updateType === 'text_end' ? 'text' : 'thinking',
        contentIndex: numberValue(update?.contentIndex) ?? 0
      })
    } else if (updateType === 'error') {
      const error = (
        stringValue(update?.error) ??
        stringValue(objectValue(record.message)?.errorMessage)
      )?.slice(0, 2_000)
      const reason = stringValue(update?.reason)
      events.push({
        type: 'assistant-end',
        sessionId,
        messageId,
        stopReason: reason,
        error
      })
      if (error && reason !== 'aborted') {
        events.push({
          type: 'session-error',
          sessionId,
          code: isAuthFailure(error) ? 'AUTH_FAILED' : 'AGENT_UNAVAILABLE',
          message: error
        })
      }
      messageId = undefined
    }
  } else if (type === 'message_end' && messageIsAssistant(record)) {
    messageId ??= assistantMessageId(record, createId)
    const message = objectValue(record.message)
    const error = stringValue(message?.errorMessage)?.slice(0, 2_000)
    const stopReason = stringValue(message?.stopReason)
    events.push({
      type: 'assistant-end',
      sessionId,
      messageId,
      stopReason,
      error
    })
    if (error && stopReason !== 'aborted') {
      events.push({
        type: 'session-error',
        sessionId,
        code: isAuthFailure(error) ? 'AUTH_FAILED' : 'AGENT_UNAVAILABLE',
        message: error
      })
    }
    messageId = undefined
  } else if (type === 'tool_execution_start') {
    events.push({
      type: 'tool-start',
      sessionId,
      toolCallId: stringValue(record.toolCallId) ?? createId(),
      toolName: stringValue(record.toolName) ?? 'tool',
      input: sanitizeInput(record.args)
    })
  } else if (type === 'tool_execution_update') {
    const output = toolOutput(record.partialResult)
    events.push({
      type: 'tool-update',
      sessionId,
      toolCallId: stringValue(record.toolCallId) ?? createId(),
      output: output.text,
      truncated: output.truncated
    })
  } else if (type === 'tool_execution_end') {
    const output = toolOutput(record.result)
    events.push({
      type: 'tool-end',
      sessionId,
      toolCallId: stringValue(record.toolCallId) ?? createId(),
      output: output.text,
      truncated: output.truncated,
      isError: record.isError === true
    })
  } else if (type === 'auto_retry_start') {
    events.push({
      type: 'retry',
      sessionId,
      phase: 'start',
      attempt: numberValue(record.attempt) ?? 1,
      maxAttempts: numberValue(record.maxAttempts),
      delayMs: numberValue(record.delayMs),
      message: stringValue(record.errorMessage)?.slice(0, 2_000)
    })
  } else if (type === 'auto_retry_end') {
    events.push({
      type: 'retry',
      sessionId,
      phase: 'end',
      attempt: numberValue(record.attempt) ?? 1,
      success: record.success === true,
      message: stringValue(record.finalError)?.slice(0, 2_000)
    })
  } else if (type === 'compaction_start' || type === 'compaction_end') {
    events.push({
      type: 'compaction',
      sessionId,
      phase: type === 'compaction_start' ? 'start' : 'end',
      reason: stringValue(record.reason),
      message: stringValue(record.errorMessage)?.slice(0, 2_000)
    })
  } else if (type === 'extension_error') {
    events.push({
      type: 'session-error',
      sessionId,
      code: 'PROTOCOL_ERROR',
      message: (stringValue(record.error) ?? 'The agent approval extension failed.').slice(0, 2_000)
    })
  }

  return { events, currentAssistantId: messageId }
}

function toAgentModel(value: unknown): AgentModel {
  const model = objectValue(value) ?? {}
  return {
    provider: stringValue(model.provider) ?? 'unknown',
    id: stringValue(model.id) ?? '',
    name: stringValue(model.name) ?? stringValue(model.id) ?? 'Unknown model',
    supportsThinking: model.reasoning === true || model.supportsThinking === true,
    ...(typeof model.api === 'string' ? { protocol: model.api as AgentModel['protocol'] } : {}),
    ...(Array.isArray(model.input) ? { supportsVision: model.input.includes('image') } : {}),
    ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === 'number' ? { maxOutputTokens: model.maxTokens } : {})
  }
}

function isAuthFailure(message: string): boolean {
  return /auth|api.?key|unauthori[sz]ed|forbidden|401|403/i.test(message)
}

export class AgentService {
  private active?: ActiveAgentSession

  constructor(
    private readonly database: AppDatabase,
    private readonly vault: AgentCredentialVault,
    private readonly userDataPath: string,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async startSession(projectId: string): Promise<{ sessionId: string }> {
    const settings = this.database.getSettings()
    if (!settings.agentEnabled) {
      throw new DesktopError('PERMISSION_DENIED', 'Enable the coding agent in Settings before starting a session.')
    }
    const project = this.database.getProject(projectId)
    if (!project) throw new DesktopError('NOT_FOUND', 'The active project no longer exists.')
    if (isCustomAgentProviderId(settings.agentProvider)) {
      throw new DesktopError(
        'NOT_FOUND',
        'This saved custom endpoint is no longer supported. Choose a pi provider in Settings.'
      )
    }
    if (!settings.agentModelId) {
      throw new DesktopError('NOT_FOUND', 'Choose a default model in Agent Settings.')
    }
    if (!this.vault.encryptionAvailable()) {
      throw new DesktopError(
        'PERMISSION_DENIED',
        'Secure credential storage is unavailable on this Mac, so the agent cannot start.'
      )
    }
    const credential = await this.vault.read(settings.agentProvider)
    if (!credential) {
      throw new DesktopError('NOT_FOUND', `Connect ${settings.agentProvider} in Agent Settings.`)
    }

    if (this.active) await this.terminateSession(this.active, 'stopped')

    const sessionId = randomUUID()
    const sessionDirectory = join(this.userDataPath, 'pi-agent', 'sessions')
    const configDirectory = join(this.userDataPath, 'pi-agent', 'config')
    mkdirSync(sessionDirectory, { recursive: true })
    mkdirSync(configDirectory, { recursive: true })

    const legacyCliPath = this.resolveLegacyCliPath()
    const child = legacyCliPath
      ? spawn(process.execPath, [
          legacyCliPath,
          '--mode', 'rpc',
          '--provider', settings.agentProvider,
          '--model', settings.agentModelId,
          '--session-dir', sessionDirectory,
          '--no-approve',
          '--tools', 'read,grep,find,ls,edit,write,bash',
          '-e', this.resolveApprovalsExtensionPath()
        ], {
          cwd: project.path,
          env: this.legacySpawnEnvironment(settings.agentProvider, credential, configDirectory),
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : spawnAgentWorker({
          mode: 'session',
          provider: settings.agentProvider,
          modelId: settings.agentModelId,
          thinkingLevel: settings.agentThinkingLevel,
          cwd: project.path,
          sessionDirectory,
          agentDirectory: configDirectory,
          approvalExtensionPath: this.resolveApprovalsExtensionPath()
        }, project.path)
    const detachCredentialBridge = legacyCliPath
      ? undefined
      : bindCredentialBridge(child as AgentWorkerChild, this.vault)
    const detachModelsStoreBridge = legacyCliPath
      ? undefined
      : bindModelsStoreBridge(child as AgentWorkerChild, this.database)
    const client = new PiRpcClient(child.stdin, child.stdout)
    const session: ActiveAgentSession = {
      id: sessionId,
      provider: settings.agentProvider,
      child,
      client,
      ...(legacyCliPath ? {} : {
        detachCredentialBridge: () => {
          detachCredentialBridge?.()
          detachModelsStoreBridge?.()
        }
      }),
      stderr: '',
      pendingApprovals: new Map(),
      stopping: false,
      ended: false
    }
    this.active = session
    this.bindSession(session)

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    }).catch((error: unknown) => {
      this.active = undefined
      session.detachCredentialBridge?.()
      client.close()
      throw new DesktopError(
        'INTERNAL',
        'Aladdeen could not start the pi coding agent.',
        error instanceof Error ? error.message : String(error)
      )
    })

    try {
      await client.send({ type: 'get_state' }, 5_000)
      await client.send({ type: 'set_thinking_level', level: settings.agentThinkingLevel }, 5_000)
    } catch (error) {
      await this.terminateSession(session, 'crashed')
      throw new DesktopError(
        'INTERNAL',
        'The pi coding agent did not finish starting.',
        error instanceof Error ? error.message : String(error)
      )
    }
    this.emit({ type: 'run-state', sessionId, state: 'idle' })
    return { sessionId }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId)
    await this.terminateSession(session, 'stopped')
  }

  async prompt(sessionId: string, message: string, steer = false): Promise<void> {
    const session = this.requireSession(sessionId)
    await session.client.send({
      type: 'prompt',
      message,
      ...(steer ? { streamingBehavior: 'steer' } : {})
    })
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId)
    this.emit({ type: 'run-state', sessionId, state: 'aborting' })
    await this.cancelPendingApprovals(session)
    await session.client.send({ type: 'abort' })
  }

  async respondApproval(
    sessionId: string,
    requestId: string,
    decision: Exclude<AgentApprovalDecision, 'cancelled'>
  ): Promise<void> {
    const session = this.requireSession(sessionId)
    if (!session.pendingApprovals.has(requestId)) {
      throw new DesktopError('NOT_FOUND', 'That approval request is no longer pending.')
    }
    session.pendingApprovals.delete(requestId)
    await session.client.notify({ type: 'extension_ui_response', id: requestId, value: decision })
    this.emit({ type: 'approval-resolved', sessionId, requestId, decision })
  }

  async setModel(sessionId: string, provider: AgentProvider, modelId: string): Promise<AgentModel> {
    const session = this.requireSession(sessionId)
    if (provider !== session.provider) {
      throw new DesktopError(
        'INVALID_PATH',
        'Start a new session to switch providers.'
      )
    }
    const response = await session.client.send({ type: 'set_model', provider, modelId })
    return toAgentModel(response.data)
  }

  async getModels(sessionId: string): Promise<AgentModel[]> {
    const session = this.requireSession(sessionId)
    const response = await session.client.send({ type: 'get_available_models' })
    const data = objectValue(response.data)
    return (Array.isArray(data?.models) ? data.models : []).map(toAgentModel)
  }

  async setThinkingLevel(sessionId: string, level: AgentThinkingLevel): Promise<void> {
    const session = this.requireSession(sessionId)
    await session.client.send({ type: 'set_thinking_level', level })
  }

  async applyConfiguredThinkingLevel(level: AgentThinkingLevel): Promise<void> {
    if (!this.active) return
    await this.active.client.send({ type: 'set_thinking_level', level })
  }

  hasActiveSession(): boolean {
    return this.active !== undefined
  }

  async close(): Promise<void> {
    if (this.active) await this.terminateSession(this.active, 'stopped')
  }

  async closeProvider(provider: AgentProvider): Promise<void> {
    if (this.active?.provider === provider) await this.terminateSession(this.active, 'stopped')
  }

  private bindSession(session: ActiveAgentSession): void {
    session.client.on('event', (record: PiRpcRecord) => {
      if (this.active !== session) return
      if (record.type === 'extension_ui_request') {
        this.handleExtensionUiRequest(session, record)
        return
      }
      const mapped = mapPiEvent(record, session.id, session.currentAssistantId)
      session.currentAssistantId = mapped.currentAssistantId
      for (const event of mapped.events) {
        if (event.type === 'session-error' && event.code === 'AUTH_FAILED') {
          this.vault.markReauthRequired(session.provider)
        }
        this.emit(event)
      }
    })
    session.client.on('protocol-error', (error: Error) => {
      if (this.active !== session) return
      this.emitSessionError(session, 'PROTOCOL_ERROR', error)
      void this.terminateSession(session, 'crashed')
    })
    session.client.on('error', (error: Error) => {
      if (this.active !== session || session.stopping) return
      this.emitSessionError(session, 'PROTOCOL_ERROR', error)
    })
    session.child.stderr.on('data', (chunk: Buffer | string) => {
      const combined = `${session.stderr}${String(chunk)}`
      session.stderr = combined.slice(-TOOL_OUTPUT_LIMIT)
    })
    session.child.on('error', (error) => {
      if (this.active !== session || session.stopping) return
      this.emitSessionError(session, 'SPAWN_FAILED', error)
    })
    session.child.on('exit', (code, signal) => {
      session.detachCredentialBridge?.()
      session.client.close()
      if (session.ended) return
      session.ended = true
      if (this.active === session) this.active = undefined
      if (session.stopping) {
        this.emit({
          type: 'session-ended',
          sessionId: session.id,
          reason: session.terminationReason ?? 'stopped'
        })
        return
      }
      const detail = session.stderr.trim() || `Pi exited with ${signal ?? `code ${String(code)}`}.`
      if (isAuthFailure(detail)) this.vault.markReauthRequired(session.provider)
      this.emit({
        type: 'session-error',
        sessionId: session.id,
        code: isAuthFailure(detail) ? 'AUTH_FAILED' : 'CRASHED',
        message: truncateText(detail, 2_000).text
      })
      this.emit({ type: 'session-ended', sessionId: session.id, reason: code === 0 ? 'exited' : 'crashed' })
    })
  }

  private handleExtensionUiRequest(session: ActiveAgentSession, record: PiRpcRecord): void {
    if (record.method !== 'select' || typeof record.id !== 'string') return
    let payload: Record<string, unknown> | undefined
    try {
      payload = objectValue(JSON.parse(stringValue(record.title) ?? ''))
    } catch {
      payload = undefined
    }
    if (payload?.kind !== 'aladdeen-approval') {
      void session.client.notify({ type: 'extension_ui_response', id: record.id, cancelled: true })
      return
    }
    const toolName = stringValue(payload.toolName) ?? 'tool'
    session.pendingApprovals.set(record.id, { toolName })
    this.emit({
      type: 'approval-request',
      sessionId: session.id,
      requestId: record.id,
      toolCallId: stringValue(payload.toolCallId),
      toolName,
      input: sanitizeInput(payload.input)
    })
  }

  private async cancelPendingApprovals(session: ActiveAgentSession): Promise<void> {
    const pending = [...session.pendingApprovals.keys()]
    session.pendingApprovals.clear()
    await Promise.allSettled(pending.map(async (requestId) => {
      await session.client.notify({ type: 'extension_ui_response', id: requestId, cancelled: true })
      this.emit({
        type: 'approval-resolved',
        sessionId: session.id,
        requestId,
        decision: 'cancelled'
      })
    }))
  }

  private async terminateSession(
    session: ActiveAgentSession,
    reason: 'stopped' | 'crashed'
  ): Promise<void> {
    if (session.stopping) return
    session.stopping = true
    session.terminationReason = reason
    await this.cancelPendingApprovals(session)
    await session.client.send({ type: 'abort' }, 2_000).catch(() => undefined)
    session.child.stdin.end()
    if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolve) => session.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000))
    ])
    if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL')
    session.client.close()
    if (this.active === session) this.active = undefined
    if (!session.ended) {
      session.ended = true
      this.emit({ type: 'session-ended', sessionId: session.id, reason })
    }
  }

  private requireSession(sessionId: string): ActiveAgentSession {
    if (!this.active || this.active.id !== sessionId) {
      throw new DesktopError('NOT_FOUND', 'That agent session is no longer active.')
    }
    return this.active
  }

  private emitSessionError(
    session: ActiveAgentSession,
    code: Extract<AgentEvent, { type: 'session-error' }>['code'],
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    if (isAuthFailure(message)) this.vault.markReauthRequired(session.provider)
    this.emit({
      type: 'session-error',
      sessionId: session.id,
      code: isAuthFailure(message) ? 'AUTH_FAILED' : code,
      message: message.slice(0, 2_000)
    })
  }

  private emit(event: AgentEvent): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.agentEvent, event)
  }

  private legacySpawnEnvironment(
    provider: AgentProvider,
    credential: Awaited<ReturnType<AgentCredentialVault['read']>>,
    configDirectory: string
  ): NodeJS.ProcessEnv {
    if (credential?.type !== 'api_key' || !credential.key) {
      throw new DesktopError('INVALID_PATH', 'The legacy pi CLI test override only supports API-key credentials.')
    }
    const keyName = API_KEY_ENV[provider]
    if (!keyName) throw new DesktopError('INVALID_PATH', `${provider} does not support API-key authentication.`)
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().endsWith('_API_KEY'))
    ) as NodeJS.ProcessEnv
    return {
      ...environment,
      ELECTRON_RUN_AS_NODE: '1',
      PI_CODING_AGENT_DIR: configDirectory,
      PI_DISABLE_UPDATE_CHECK: '1',
      DO_NOT_TRACK: '1',
      OTEL_SDK_DISABLED: 'true',
      NO_TELEMETRY: '1',
      [keyName]: credential.key
    }
  }

  private resolveLegacyCliPath(): string | undefined {
    if (!process.env.ALADDEEN_PI_CLI_PATH) return undefined
    return isAbsolute(process.env.ALADDEEN_PI_CLI_PATH)
      ? process.env.ALADDEEN_PI_CLI_PATH
      : resolve(app.getAppPath(), process.env.ALADDEEN_PI_CLI_PATH)
  }

  private resolveApprovalsExtensionPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'pi', 'aladdeen-approvals.ts')
      : join(app.getAppPath(), 'resources', 'pi', 'aladdeen-approvals.ts')
  }
}
