import { safeStorage } from 'electron'
import { DesktopError } from '@main/errors'
import type { AppDatabase } from '@main/services/database'
import type { AiProvider } from '@shared/ai'
import { AI_PROVIDERS } from '@shared/ai'

const CREDENTIAL_ENVELOPE_VERSION = 1
const MAX_CIPHERTEXT_BYTES = 512 * 1024

export interface AiCredentialEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export const defaultEncryption: AiCredentialEncryption = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value)
}

interface CredentialEnvelope {
  version: typeof CREDENTIAL_ENVELOPE_VERSION
  credential: string
}

export class AiSecretVault {
  constructor(
    private readonly database: AppDatabase,
    private readonly encryption: AiCredentialEncryption = defaultEncryption
  ) {}

  hasApiKey(provider: AiProvider): boolean {
    return this.database.getAiSecretCiphertext(provider) !== null
  }

  credentialStatus(): { encryptionAvailable: boolean; hasApiKey: Record<AiProvider, boolean> } {
    return {
      encryptionAvailable: this.encryption.isEncryptionAvailable(),
      hasApiKey: Object.fromEntries(
        AI_PROVIDERS.map((provider) => [provider, this.hasApiKey(provider)])
      ) as Record<AiProvider, boolean>
    }
  }

  setApiKey(provider: AiProvider, apiKey: string): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new DesktopError(
        'PERMISSION_DENIED',
        'Secure credential storage is unavailable. Aladdeen will not store the API key in plaintext.'
      )
    }
    const envelope: CredentialEnvelope = {
      version: CREDENTIAL_ENVELOPE_VERSION,
      credential: apiKey
    }
    const ciphertext = this.encryption.encryptString(JSON.stringify(envelope))
    if (ciphertext.byteLength > MAX_CIPHERTEXT_BYTES) {
      throw new DesktopError('VALIDATION_FAILED', 'The API key is too large to store securely.')
    }
    this.database.setAiSecretCiphertext(provider, ciphertext)
  }

  clearApiKey(provider: AiProvider): void {
    this.database.clearAiSecret(provider)
  }

  readApiKey(provider: AiProvider): string {
    const ciphertext = this.database.getAiSecretCiphertext(provider)
    if (!ciphertext) throw new DesktopError('NOT_FOUND', 'No API key is stored for this provider.')
    if (!this.encryption.isEncryptionAvailable()) {
      throw new DesktopError(
        'PERMISSION_DENIED',
        'Secure credential storage is unavailable, so the stored API key cannot be unlocked.'
      )
    }
    let envelope: CredentialEnvelope
    try {
      envelope = JSON.parse(this.encryption.decryptString(ciphertext)) as CredentialEnvelope
    } catch {
      throw new DesktopError('INTERNAL', 'The stored API key could not be decrypted.')
    }
    if (envelope.version !== CREDENTIAL_ENVELOPE_VERSION || typeof envelope.credential !== 'string') {
      throw new DesktopError('INTERNAL', 'The stored API key has an unsupported format.')
    }
    return envelope.credential
  }
}
