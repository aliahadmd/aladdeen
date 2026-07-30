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
  type AgentWorkerChild
} from '@main/services/agent-worker-host'

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
})
