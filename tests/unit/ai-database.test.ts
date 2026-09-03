import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '@main/services/database'
import { AiSecretVault, type AiCredentialEncryption } from '@main/services/ai/secrets'
import type { AiChatMessage } from '@shared/ai'

const created: string[] = []

afterEach(() => {
  created.length = 0
})

async function createDatabase(): Promise<AppDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'aladdeen-db-ai-'))
  created.push(directory)
  return new AppDatabase(directory)
}

const fakeEncryption: AiCredentialEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.concat([Buffer.from('enc:'), Buffer.from(value, 'utf8').reverse()]),
  decryptString: (value) => Buffer.from(value.subarray(4)).reverse().toString('utf8')
}

describe('ai persistence', () => {
  it('stores API keys encrypted and refuses plaintext fallback', async () => {
    const database = await createDatabase()
    const vault = new AiSecretVault(database, fakeEncryption)
    vault.setApiKey('anthropic', 'sk-test-123')
    expect(vault.hasApiKey('anthropic')).toBe(true)
    expect(vault.hasApiKey('openai-compatible')).toBe(false)
    expect(vault.readApiKey('anthropic')).toBe('sk-test-123')
    // The raw row must never contain the plaintext key.
    const row = database.getAiSecretCiphertext('anthropic')
    expect(row?.toString('utf8').includes('sk-test-123')).toBe(false)

    vault.clearApiKey('anthropic')
    expect(vault.hasApiKey('anthropic')).toBe(false)

    const refusing: AiCredentialEncryption = {
      ...fakeEncryption,
      isEncryptionAvailable: () => false
    }
    const lockedVault = new AiSecretVault(database, refusing)
    expect(() => lockedVault.setApiKey('anthropic', 'sk-test')).toThrow(/plaintext/i)
    database.close()
  })

  it('round-trips provider profiles', async () => {
    const database = await createDatabase()
    expect(database.getAiProfile('openai-compatible')).toEqual({ baseUrl: '', allowLocal: false, manualModelId: '' })
    database.setAiProfile('openai-compatible', 'https://api.example.com', true, 'my-model')
    expect(database.getAiProfile('openai-compatible')).toEqual({
      baseUrl: 'https://api.example.com',
      allowLocal: true,
      manualModelId: 'my-model'
    })
    database.close()
  })

  it('persists chat sessions and messages with ordering', async () => {
    const database = await createDatabase()
    const session = database.createAiSession('session-1', 'New chat', null)
    expect(database.listAiSessions()).toEqual([session])

    const userMessage: AiChatMessage = {
      id: 'm1',
      role: 'user',
      blocks: [{ type: 'text', text: 'Summarize my notes' }],
      createdAt: 100
    }
    const assistantMessage: AiChatMessage = {
      id: 'm2',
      role: 'assistant',
      blocks: [
        { type: 'thinking', text: 'planning' },
        { type: 'text', text: 'Here is the summary.' }
      ],
      createdAt: 200
    }
    database.appendAiMessage('session-1', userMessage)
    database.appendAiMessage('session-1', assistantMessage)
    database.renameAiSession('session-1', 'Summarize my notes')

    const detail = database.getAiSession('session-1')
    expect(detail?.title).toBe('Summarize my notes')
    expect(detail?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(detail?.messages[1]?.blocks).toEqual(assistantMessage.blocks)

    database.replaceAiMessage('session-1', 'm2', [
      { type: 'text', text: 'Replaced final text.' }
    ])
    expect(database.getAiSession('session-1')?.messages[1]?.blocks).toEqual([
      { type: 'text', text: 'Replaced final text.' }
    ])

    database.deleteAiSession('session-1')
    expect(database.listAiSessions()).toEqual([])
    expect(database.getAiSession('session-1')).toBeNull()
    database.close()
  })
})
