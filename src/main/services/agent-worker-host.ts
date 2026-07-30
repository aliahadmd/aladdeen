import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { app } from 'electron'
import type { AgentCredentialVault } from '@main/services/agent-credentials'
import {
  AGENT_PROVIDERS,
  validateCredential
} from '@main/services/agent-credentials'
import type {
  AgentWorkerCredentialRequest,
  AgentWorkerCredentialResponse,
  AgentWorkerOptions
} from '@shared/agent-worker'

const MAX_IPC_BYTES = 768 * 1024

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
  if (request.operation === 'read' && !isAgentProvider(request.providerId)) {
    return {
      channel: 'credential-response',
      requestId: request.requestId,
      ok: true
    }
  }
  if (!isAgentProvider(request.providerId)) {
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

function isAgentProvider(value: string): value is typeof AGENT_PROVIDERS[number] {
  return AGENT_PROVIDERS.includes(value as typeof AGENT_PROVIDERS[number])
}

function messageWithinLimit(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_IPC_BYTES
  } catch {
    return false
  }
}

function workerEnvironment(options: AgentWorkerOptions): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !isProviderSecretName(key))
  ) as NodeJS.ProcessEnv
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    PI_DISABLE_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
    OTEL_SDK_DISABLED: 'true',
    NO_TELEMETRY: '1',
    ALADDEEN_PI_RUNTIME_ROOT: resolveRuntimeRoot(),
    ALADDEEN_AGENT_WORKER_OPTIONS: JSON.stringify(options)
  }
}

export function isProviderSecretName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    /(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS?)$/.test(upper) ||
    upper === 'AWS_ACCESS_KEY_ID'
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
