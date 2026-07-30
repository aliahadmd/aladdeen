import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { app } from 'electron'
import type { AgentCredentialVault } from '@main/services/agent-credentials'
import type { AppDatabase } from '@main/services/database'
import {
  validateCredential
} from '@main/services/agent-credentials'
import type {
  AgentWorkerCredentialRequest,
  AgentWorkerCredentialResponse,
  AgentWorkerModelsStoreRequest,
  AgentWorkerModelsStoreResponse,
  AgentWorkerOptions
} from '@shared/agent-worker'

const MAX_IPC_BYTES = 768 * 1024
const MAX_MODELS_STORE_IPC_BYTES = 3 * 1024 * 1024

export type AgentWorkerChild = ChildProcessByStdio<Writable, Readable, Readable>

export function spawnAgentWorker(
  options: AgentWorkerOptions,
  cwd = app.getAppPath()
): AgentWorkerChild {
  return spawn(process.execPath, [resolveWorkerPath()], {
    cwd,
    env: workerEnvironment(options),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  }) as unknown as AgentWorkerChild
}

export function bindCredentialBridge(
  child: AgentWorkerChild,
  vault: AgentCredentialVault
): () => void {
  const onMessage = (message: unknown): void => {
    if (!isCredentialRequest(message)) return
    if (!messageWithinLimit(message)) {
      child.kill('SIGTERM')
      return
    }
    void handleCredentialRequest(message, vault).then(
      (response) => {
        if (child.connected) child.send(response)
      },
      (error: unknown) => {
        const response: AgentWorkerCredentialResponse = {
          channel: 'credential-response',
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 2_000) : 'Credential storage failed.'
        }
        if (child.connected) child.send(response)
      }
    )
  }
  child.on('message', onMessage)
  return () => child.off('message', onMessage)
}

export function bindModelsStoreBridge(
  child: AgentWorkerChild,
  database: AppDatabase
): () => void {
  const onMessage = (message: unknown): void => {
    if (!isModelsStoreRequest(message)) return
    if (!messageWithinLimit(message, MAX_MODELS_STORE_IPC_BYTES)) {
      child.kill('SIGTERM')
      return
    }
    let response: AgentWorkerModelsStoreResponse
    try {
      if (message.operation === 'read') {
        response = {
          channel: 'models-store-response',
          requestId: message.requestId,
          ok: true,
          value: database.getAgentRuntimeModelCache(message.providerId)
        }
      } else if (message.operation === 'write') {
        database.setAgentRuntimeModelCache(
          message.providerId,
          sanitizeModelsStoreEntry(message.entry, message.providerId)
        )
        response = { channel: 'models-store-response', requestId: message.requestId, ok: true }
      } else {
        database.setAgentRuntimeModelCache(message.providerId, undefined)
        response = { channel: 'models-store-response', requestId: message.requestId, ok: true }
      }
    } catch (error) {
      response = {
        channel: 'models-store-response',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 2_000) : 'Model storage failed.'
      }
    }
    if (child.connected) child.send(response)
  }
  child.on('message', onMessage)
  return () => child.off('message', onMessage)
}

async function handleCredentialRequest(
  request: AgentWorkerCredentialRequest,
  vault: AgentCredentialVault
): Promise<AgentWorkerCredentialResponse> {
  if (request.operation === 'list') {
    return {
      channel: 'credential-response',
      requestId: request.requestId,
      ok: true,
      value: await vault.list()
    }
  }
  if (request.operation === 'read' && !isAgentProviderId(request.providerId)) {
    return {
      channel: 'credential-response',
      requestId: request.requestId,
      ok: true
    }
  }
  if (!isAgentProviderId(request.providerId)) {
    throw new Error('The agent worker requested an unsupported provider.')
  }
  if (request.operation === 'read') {
    return {
      channel: 'credential-response',
      requestId: request.requestId,
      ok: true,
      value: await vault.read(request.providerId)
    }
  }
  if (request.operation === 'write') {
    await vault.write(request.providerId, validateCredential(request.credential))
    return { channel: 'credential-response', requestId: request.requestId, ok: true }
  }
  vault.delete(request.providerId)
  return { channel: 'credential-response', requestId: request.requestId, ok: true }
}

function isCredentialRequest(value: unknown): value is AgentWorkerCredentialRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (
    request.channel !== 'credential' ||
    typeof request.requestId !== 'string' ||
    request.requestId.length > 200 ||
    !['read', 'list', 'write', 'delete'].includes(String(request.operation))
  ) {
    return false
  }
  if (request.operation === 'list') return true
  return typeof request.providerId === 'string' && request.providerId.length <= 200
}

function isModelsStoreRequest(value: unknown): value is AgentWorkerModelsStoreRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (
    request.channel !== 'models-store' ||
    typeof request.requestId !== 'string' ||
    request.requestId.length > 200 ||
    !['read', 'write', 'delete'].includes(String(request.operation)) ||
    typeof request.providerId !== 'string' ||
    !isAgentProviderId(request.providerId)
  ) return false
  return request.operation !== 'write' || 'entry' in request
}

function isAgentProviderId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,199}$/.test(value)
}

function messageWithinLimit(value: unknown, limit = MAX_IPC_BYTES): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= limit
  } catch {
    return false
  }
}

const SENSITIVE_MODEL_KEY = /authorization|proxy|cookie|api.?key|token|secret|password|credential|(^|_)env($|_)/iu

function sanitizedCatalogValue(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('The provider model catalog is too deeply nested.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('The provider model catalog contains an invalid number.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 64 * 1024) throw new Error('The provider model catalog contains an oversized value.')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error('The provider model catalog contains an oversized list.')
    return value.map((item) => sanitizedCatalogValue(item, depth + 1))
  }
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 1_000) throw new Error('The provider model catalog contains too many fields.')
  return Object.fromEntries(entries.flatMap(([key, item]) => {
    if (key.length > 200 || SENSITIVE_MODEL_KEY.test(key)) return []
    const sanitized = sanitizedCatalogValue(item, depth + 1)
    return sanitized === undefined ? [] : [[key, sanitized]]
  }))
}

export function sanitizeModelsStoreEntry(value: unknown, providerId: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The agent worker sent an invalid model-store entry.')
  }
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.models) || source.models.length > 2_000) {
    throw new Error('The agent worker sent an invalid model list.')
  }
  const models = source.models.map((item) => {
    const sanitized = sanitizedCatalogValue(item)
    if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
      throw new Error('The agent worker sent an invalid model.')
    }
    const model = sanitized as Record<string, unknown>
    if (typeof model.id !== 'string' || !model.id || model.id.length > 200) {
      throw new Error('The agent worker sent a model with an invalid ID.')
    }
    return { ...model, provider: providerId }
  })
  const entry = {
    models,
    ...(typeof source.lastModified === 'number' && Number.isFinite(source.lastModified)
      ? { lastModified: source.lastModified }
      : {}),
    ...(typeof source.checkedAt === 'number' && Number.isFinite(source.checkedAt)
      ? { checkedAt: source.checkedAt }
      : {}),
    ...(typeof source.etag === 'string' && source.etag.length <= 8_192
      ? { etag: source.etag }
      : {})
  }
  if (Buffer.byteLength(JSON.stringify(entry), 'utf8') > 2 * 1024 * 1024) {
    throw new Error('The provider model catalog exceeded the 2 MiB limit.')
  }
  return entry
}

export function workerEnvironment(options: AgentWorkerOptions): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => (
      !isProviderSecretName(key) && !isProxyEnvironmentName(key)
    ))
  ) as NodeJS.ProcessEnv
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    PI_DISABLE_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    OTEL_SDK_DISABLED: 'true',
    NO_TELEMETRY: '1',
    ...(options.mode === 'refresh' ? {} : { PI_OFFLINE: '1' }),
    ALADDEEN_PI_RUNTIME_ROOT: resolveRuntimeRoot(),
    ALADDEEN_AGENT_WORKER_OPTIONS: JSON.stringify(options)
  }
}

export function isProxyEnvironmentName(name: string): boolean {
  return name.toUpperCase().includes('PROXY')
}

export function isProviderSecretName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    /(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS?)$/.test(upper) ||
    ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE']
      .includes(upper)
  )
}

export function resolveRuntimeRoot(): string {
  if (process.env.ALADDEEN_PI_RUNTIME_ROOT) {
    return isAbsolute(process.env.ALADDEEN_PI_RUNTIME_ROOT)
      ? process.env.ALADDEEN_PI_RUNTIME_ROOT
      : resolve(app.getAppPath(), process.env.ALADDEEN_PI_RUNTIME_ROOT)
  }
  return app.isPackaged ? join(process.resourcesPath, 'pi-runtime') : app.getAppPath()
}

export function resolveWorkerPath(): string {
  if (process.env.ALADDEEN_AGENT_WORKER_PATH) {
    return isAbsolute(process.env.ALADDEEN_AGENT_WORKER_PATH)
      ? process.env.ALADDEEN_AGENT_WORKER_PATH
      : resolve(app.getAppPath(), process.env.ALADDEEN_AGENT_WORKER_PATH)
  }
  const appPath = app.getAppPath()
  if (app.isPackaged && appPath.endsWith('app.asar')) {
    const unpacked = join(`${appPath}.unpacked`, 'out', 'worker', 'agent-worker', 'index.js')
    if (existsSync(unpacked)) return unpacked
  }
  return join(appPath, 'out', 'worker', 'agent-worker', 'index.js')
}
