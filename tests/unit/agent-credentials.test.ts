// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('not available')
    },
    decryptString: () => {
      throw new Error('not available')
    }
  }
}))

import {
  AgentCredentialVault,
  type CredentialEncryption
} from '@main/services/agent-credentials'
import type { AppDatabase } from '@main/services/database'
import type { AgentProvider } from '@shared/contracts'

class FakeDatabase {
  readonly values = new Map<AgentProvider, Buffer>()

  getAgentSecret(provider: AgentProvider): Buffer | null {
    return this.values.get(provider) ?? null
  }

  setAgentSecret(provider: AgentProvider, ciphertext: Buffer): void {
    this.values.set(provider, ciphertext)
  }

  clearAgentSecret(provider: AgentProvider): void {
    this.values.delete(provider)
  }

  listAgentSecretProviderIds(): AgentProvider[] {
    return [...this.values.keys()].sort()
  }

  listAgentProviderProfiles(): [] {
    return []
  }

  getAgentProviderProfile(): undefined {
    return undefined
  }
}

class FakeEncryption implements CredentialEncryption {
  constructor(public available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(value: string): Buffer {
    if (!this.available) throw new Error('unavailable')
    return Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`)
  }

  decryptString(value: Buffer): string {
    if (!this.available) throw new Error('unavailable')
    const encoded = value.toString().replace(/^encrypted:/, '')
    return Buffer.from(encoded, 'base64').toString()
  }
}

function setup(available = true): {
  database: FakeDatabase
  encryption: FakeEncryption
  vault: AgentCredentialVault
} {
  const database = new FakeDatabase()
  const encryption = new FakeEncryption(available)
  const vault = new AgentCredentialVault(
    database as unknown as AppDatabase,
    encryption
  )
  return { database, encryption, vault }
}

describe('agent credential vault', () => {
  it('encrypts a versioned credential envelope and never exposes token fields in status', async () => {
    const { database, encryption, vault } = setup()
    await vault.write('openai-codex', {
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000
    })

    const ciphertext = database.values.get('openai-codex')
    expect(ciphertext?.toString()).not.toContain('access-token')
    const envelope = JSON.parse(encryption.decryptString(ciphertext!))
    expect(envelope).toMatchObject({
      version: 1,
      credential: { type: 'oauth', access: 'access-token', refresh: 'refresh-token' }
    })
    const status = await vault.status()
    expect(status.providers.find((item) => item.providerId === 'openai-codex')).toMatchObject({
      configured: true,
      authType: 'oauth',
      reauthRequired: false
    })
    expect(JSON.stringify(status)).not.toContain('access-token')
    expect(JSON.stringify(status)).not.toContain('refresh-token')
  })

  it('migrates legacy decrypted API-key strings on first successful read', async () => {
    const { database, encryption, vault } = setup()
    database.values.set('anthropic', encryption.encryptString('legacy-api-key'))

    await expect(vault.read('anthropic')).resolves.toEqual({
      type: 'api_key',
      key: 'legacy-api-key'
    })
    const rewritten = encryption.decryptString(database.values.get('anthropic')!)
    expect(JSON.parse(rewritten)).toEqual({
      version: 1,
      credential: { type: 'api_key', key: 'legacy-api-key' }
    })
  })

  it('replaces rotated OAuth refresh tokens and disconnects locally', async () => {
    const { database, vault } = setup()
    await vault.write('kimi-coding', {
      type: 'oauth',
      access: 'old-access',
      refresh: 'old-refresh',
      expires: 100
    })
    await vault.write('kimi-coding', {
      type: 'oauth',
      access: 'new-access',
      refresh: 'new-refresh',
      expires: 200
    })

    await expect(vault.read('kimi-coding')).resolves.toMatchObject({
      access: 'new-access',
      refresh: 'new-refresh',
      expires: 200
    })
    vault.delete('kimi-coding')
    expect(database.values.has('kimi-coding')).toBe(false)
    await expect(vault.read('kimi-coding')).resolves.toBeUndefined()
  })

  it('refuses all writes when secure storage is unavailable', async () => {
    const { database, vault } = setup(false)
    await expect(vault.write('openai', {
      type: 'api_key',
      key: 'test-api-key'
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(database.values.size).toBe(0)
    expect((await vault.status()).encryptionAvailable).toBe(false)
  })

  it('marks configured providers for reauthentication without changing their credential', async () => {
    const { vault } = setup()
    await vault.write('anthropic', { type: 'api_key', key: 'test-api-key' })
    vault.markReauthRequired('anthropic')
    expect((await vault.status()).providers.find((item) => item.providerId === 'anthropic')).toMatchObject({
      configured: true,
      authType: 'api_key',
      reauthRequired: true
    })
    await expect(vault.read('anthropic')).resolves.toEqual({ type: 'api_key', key: 'test-api-key' })
  })

  it('retains reauthentication state when a failed refresh removed the expired token', async () => {
    const { vault } = setup()
    vault.markReauthRequired('kimi-coding')
    expect((await vault.status()).providers.find((item) => item.providerId === 'kimi-coding')).toMatchObject({
      configured: false,
      reauthRequired: true
    })
  })
})
