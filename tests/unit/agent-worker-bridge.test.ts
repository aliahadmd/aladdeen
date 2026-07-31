// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/application',
    isPackaged: false
  }
}))

import type { AgentCredentialVault } from '@main/services/agent-credentials'
import {
  bindCredentialBridge,
  bindModelsStoreBridge,
  resolveWorkerWorkingDirectory,
  workerEnvironment,
  type AgentWorkerChild
} from '@main/services/agent-worker-host'
import type { AppDatabase } from '@main/services/database'

class FakeChild extends EventEmitter {
  connected = true
  readonly send = vi.fn()
  readonly kill = vi.fn()
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('agent worker credential bridge', () => {
  let child: FakeChild
  let vault: {
    read: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    child = new FakeChild()
    vault = {
      read: vi.fn().mockResolvedValue({ type: 'api_key', key: 'secret-key' }),
      list: vi.fn().mockResolvedValue([{ providerId: 'anthropic', type: 'api_key' }]),
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn()
    }
  })

  it('uses a real Resources directory instead of app.asar in packaged builds', () => {
    expect(resolveWorkerWorkingDirectory(
      false,
      '/workspace/aladdeen',
      '/Applications/Aladdeen.app/Contents/Resources'
    )).toBe('/workspace/aladdeen')
    expect(resolveWorkerWorkingDirectory(
      true,
      '/Applications/Aladdeen.app/Contents/Resources/app.asar',
      '/Applications/Aladdeen.app/Contents/Resources'
    )).toBe('/Applications/Aladdeen.app/Contents/Resources')
  })

  it('serves read, list, write, and delete over child-process IPC', async () => {
    bindCredentialBridge(
      child as unknown as AgentWorkerChild,
      vault as unknown as AgentCredentialVault
    )

    child.emit('message', {
      channel: 'credential',
      requestId: 'read-1',
      operation: 'read',
      providerId: 'anthropic'
    })
    child.emit('message', {
      channel: 'credential',
      requestId: 'list-1',
      operation: 'list'
    })
    child.emit('message', {
      channel: 'credential',
      requestId: 'write-1',
      operation: 'write',
      providerId: 'kimi-coding',
      credential: {
        type: 'oauth',
        access: 'access',
        refresh: 'refresh',
        expires: 100
      }
    })
    child.emit('message', {
      channel: 'credential',
      requestId: 'delete-1',
      operation: 'delete',
      providerId: 'google'
    })
    await tick()

    expect(vault.read).toHaveBeenCalledWith('anthropic')
    expect(vault.list).toHaveBeenCalled()
    expect(vault.write).toHaveBeenCalledWith('kimi-coding', {
      type: 'oauth',
      access: 'access',
      refresh: 'refresh',
      expires: 100
    })
    expect(vault.delete).toHaveBeenCalledWith('google')
    expect(child.send).toHaveBeenCalledWith({
      channel: 'credential-response',
      requestId: 'read-1',
      ok: true,
      value: { type: 'api_key', key: 'secret-key' }
    })
    expect(child.send).toHaveBeenCalledWith({
      channel: 'credential-response',
      requestId: 'list-1',
      ok: true,
      value: [{ providerId: 'anthropic', type: 'api_key' }]
    })
  })

  it('rejects malformed credentials and kills workers that exceed the IPC limit', async () => {
    bindCredentialBridge(
      child as unknown as AgentWorkerChild,
      vault as unknown as AgentCredentialVault
    )
    child.emit('message', {
      channel: 'credential',
      requestId: 'bad-write',
      operation: 'write',
      providerId: 'anthropic',
      credential: { type: 'oauth', access: 'missing-fields' }
    })
    await tick()
    expect(child.send).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'credential-response',
      requestId: 'bad-write',
      ok: false
    }))

    child.emit('message', {
      channel: 'credential',
      requestId: 'oversized',
      operation: 'write',
      providerId: 'anthropic',
      credential: { type: 'api_key', key: 'x'.repeat(800 * 1024) }
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('detaches cleanly when a worker crashes', async () => {
    const detach = bindCredentialBridge(
      child as unknown as AgentWorkerChild,
      vault as unknown as AgentCredentialVault
    )
    detach()
    child.connected = false
    child.emit('message', {
      channel: 'credential',
      requestId: 'after-crash',
      operation: 'list'
    })
    await tick()
    expect(child.send).not.toHaveBeenCalled()
  })

  it('persists sanitized provider model metadata through the model-store bridge', () => {
    const database = {
      getAgentRuntimeModelCache: vi.fn().mockReturnValue({
        models: [{ id: 'cached', provider: 'openrouter' }]
      }),
      setAgentRuntimeModelCache: vi.fn()
    }
    bindModelsStoreBridge(
      child as unknown as AgentWorkerChild,
      database as unknown as AppDatabase
    )
    child.emit('message', {
      channel: 'models-store',
      requestId: 'read-models',
      operation: 'read',
      providerId: 'openrouter'
    })
    child.emit('message', {
      channel: 'models-store',
      requestId: 'write-models',
      operation: 'write',
      providerId: 'openrouter',
      entry: {
        checkedAt: 100,
        etag: '"catalog-v1"',
        models: [{
          id: 'deepseek/deepseek-r1',
          provider: 'attacker-controlled',
          name: 'DeepSeek R1',
          api: 'openai-completions',
          headers: {
            authorization: 'Bearer must-not-persist',
            'x-safe-routing-header': 'allowed'
          }
        }]
      }
    })
    child.emit('message', {
      channel: 'models-store',
      requestId: 'delete-models',
      operation: 'delete',
      providerId: 'openrouter'
    })

    expect(child.send).toHaveBeenCalledWith({
      channel: 'models-store-response',
      requestId: 'read-models',
      ok: true,
      value: { models: [{ id: 'cached', provider: 'openrouter' }] }
    })
    const persisted = database.setAgentRuntimeModelCache.mock.calls[0]?.[1]
    expect(persisted).toMatchObject({
      checkedAt: 100,
      models: [{
        id: 'deepseek/deepseek-r1',
        provider: 'openrouter',
        headers: { 'x-safe-routing-header': 'allowed' }
      }]
    })
    expect(JSON.stringify(persisted)).not.toContain('must-not-persist')
    expect(database.setAgentRuntimeModelCache).toHaveBeenLastCalledWith('openrouter', undefined)
  })

  it('kills a worker that sends an oversized model-store message', () => {
    const database = {
      getAgentRuntimeModelCache: vi.fn(),
      setAgentRuntimeModelCache: vi.fn()
    }
    bindModelsStoreBridge(
      child as unknown as AgentWorkerChild,
      database as unknown as AppDatabase
    )
    child.emit('message', {
      channel: 'models-store',
      requestId: 'oversized-models',
      operation: 'write',
      providerId: 'openrouter',
      entry: { models: [{ id: 'x', description: 'x'.repeat(3 * 1024 * 1024) }] }
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(database.setAgentRuntimeModelCache).not.toHaveBeenCalled()
  })

  it('keeps normal workers offline for catalogs and strips ambient credentials and proxies', () => {
    const previous = {
      openai: process.env.OPENAI_API_KEY,
      aws: process.env.AWS_SECRET_ACCESS_KEY,
      proxy: process.env.npm_config_https_proxy
    }
    process.env.OPENAI_API_KEY = 'ambient-openai-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'ambient-aws-key'
    process.env.npm_config_https_proxy = 'http://127.0.0.1:9999'
    try {
      const normal = workerEnvironment({ mode: 'capabilities' })
      expect(normal.PI_OFFLINE).toBe('1')
      expect(normal.OPENAI_API_KEY).toBeUndefined()
      expect(normal.AWS_SECRET_ACCESS_KEY).toBeUndefined()
      expect(normal.npm_config_https_proxy).toBeUndefined()

      const refresh = workerEnvironment({ mode: 'refresh', provider: 'openrouter' })
      expect(refresh.PI_OFFLINE).toBeUndefined()
    } finally {
      if (previous.openai === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previous.openai
      if (previous.aws === undefined) delete process.env.AWS_SECRET_ACCESS_KEY
      else process.env.AWS_SECRET_ACCESS_KEY = previous.aws
      if (previous.proxy === undefined) delete process.env.npm_config_https_proxy
      else process.env.npm_config_https_proxy = previous.proxy
    }
  })
})
