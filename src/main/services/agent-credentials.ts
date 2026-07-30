import { safeStorage } from 'electron'
import type { Credential, CredentialInfo } from '@earendil-works/pi-ai'
import { DesktopError } from '@main/errors'
import type { AppDatabase } from '@main/services/database'
import type {
  AgentAuthType,
  AgentCredentialStatus,
  AgentProvider,
  AgentProviderCredentialStatus
} from '@shared/contracts'

const CREDENTIAL_ENVELOPE_VERSION = 1
const MAX_CREDENTIAL_BYTES = 512 * 1024
export const AGENT_PROVIDERS: readonly AgentProvider[] = [
  'anthropic',
  'openai-codex',
  'kimi-coding',
  'openai',
  'google'
]

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface AgentProviderCapabilities {
  oauthAvailable: boolean
  apiKeyAvailable: boolean
  modelIds: string[]
}

export type AgentCapabilities = Record<AgentProvider, AgentProviderCapabilities>

interface CredentialEnvelope {
  version: typeof CREDENTIAL_ENVELOPE_VERSION
  credential: Credential
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  anthropic: {
    oauthAvailable: true,
    apiKeyAvailable: true,
    modelIds: ['claude-sonnet-4-5']
  },
  'openai-codex': {
    oauthAvailable: true,
    apiKeyAvailable: false,
    modelIds: ['gpt-5.5']
  },
  'kimi-coding': {
    oauthAvailable: true,
    apiKeyAvailable: true,
    modelIds: ['kimi-for-coding']
  },
  openai: {
    oauthAvailable: false,
    apiKeyAvailable: true,
    modelIds: []
  },
  google: {
    oauthAvailable: false,
    apiKeyAvailable: true,
    modelIds: []
  }
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined
}

export function validateCredential(value: unknown): Credential {
  const credential = plainObject(value)
  const serialized = JSON.stringify(value)
  if (
    !credential ||
    typeof serialized !== 'string' ||
    Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIAL_BYTES
  ) {
    throw new DesktopError('INVALID_PATH', 'The agent worker sent an invalid credential.')
  }
  if (credential.type === 'api_key') {
    if (credential.key !== undefined && (typeof credential.key !== 'string' || credential.key.length > 8_192)) {
      throw new DesktopError('INVALID_PATH', 'The agent worker sent an invalid API-key credential.')
    }
    const env = credential.env
    if (env !== undefined) {
      const entries = Object.entries(plainObject(env) ?? {})
      if (
        !plainObject(env) ||
        entries.length > 64 ||
        entries.some(([key, item]) => key.length > 200 || typeof item !== 'string' || item.length > 8_192)
      ) {
        throw new DesktopError('INVALID_PATH', 'The agent worker sent invalid credential environment values.')
      }
    }
    return JSON.parse(serialized) as Credential
  }
  if (
    credential.type === 'oauth' &&
    typeof credential.refresh === 'string' &&
    typeof credential.access === 'string' &&
    credential.refresh.length <= 256 * 1024 &&
    credential.access.length <= 256 * 1024 &&
    typeof credential.expires === 'number' &&
    Number.isFinite(credential.expires)
  ) {
    return JSON.parse(serialized) as Credential
  }
  throw new DesktopError('INVALID_PATH', 'The agent worker sent an unsupported credential type.')
}

function parseEnvelope(value: string): Credential | undefined {
  try {
    const envelope = plainObject(JSON.parse(value))
    if (envelope?.version !== CREDENTIAL_ENVELOPE_VERSION) return undefined
    return validateCredential(envelope.credential)
  } catch {
    return undefined
  }
}

export class AgentCredentialVault {
  private readonly reauthRequired = new Set<AgentProvider>()
  private capabilities: AgentCapabilities = DEFAULT_AGENT_CAPABILITIES

  constructor(
    private readonly database: AppDatabase,
    private readonly encryption: CredentialEncryption = safeStorage
  ) {}

  encryptionAvailable(): boolean {
    return this.encryption.isEncryptionAvailable()
  }

  setCapabilities(capabilities: AgentCapabilities): void {
    this.capabilities = capabilities
  }

  getCapabilities(): AgentCapabilities {
    return this.capabilities
  }

  async read(provider: AgentProvider): Promise<Credential | undefined> {
    const ciphertext = this.database.getAgentSecret(provider)
    if (!ciphertext) return undefined
    this.requireEncryption()
    let plaintext: string
    try {
      plaintext = this.encryption.decryptString(ciphertext)
    } catch (error) {
      throw new DesktopError(
        'INTERNAL',
        'The saved agent credential could not be decrypted.',
        error instanceof Error ? error.message : String(error)
      )
    }
    const credential = parseEnvelope(plaintext)
    if (credential) return credential
    if (!plaintext) throw new DesktopError('INTERNAL', 'The saved agent credential is empty.')

    // Versions before account login stored the decrypted API key as the raw
    // plaintext value. Migrate it immediately after the first successful read.
    const legacy: Credential = { type: 'api_key', key: plaintext }
    await this.write(provider, legacy)
    return legacy
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credentials: CredentialInfo[] = []
    for (const provider of AGENT_PROVIDERS) {
      const credential = await this.read(provider)
      if (credential) credentials.push({ providerId: provider, type: credential.type })
    }
    return credentials
  }

  async write(provider: AgentProvider, credential: unknown): Promise<void> {
    this.requireEncryption()
    const validated = validateCredential(credential)
    const envelope: CredentialEnvelope = {
      version: CREDENTIAL_ENVELOPE_VERSION,
      credential: validated
    }
    this.database.setAgentSecret(provider, this.encryption.encryptString(JSON.stringify(envelope)))
    this.reauthRequired.delete(provider)
  }

  delete(provider: AgentProvider): void {
    this.database.clearAgentSecret(provider)
    this.reauthRequired.delete(provider)
  }

  markReauthRequired(provider: AgentProvider): void {
    this.reauthRequired.add(provider)
  }

  async status(): Promise<AgentCredentialStatus> {
    const providers = {} as Record<AgentProvider, AgentProviderCredentialStatus>
    for (const provider of AGENT_PROVIDERS) {
      let credential: Credential | undefined
      const hasStoredCredential = this.database.getAgentSecret(provider) !== null
      try {
        credential = await this.read(provider)
      } catch {
        this.markReauthRequired(provider)
      }
      const capability = this.capabilities[provider]
      providers[provider] = {
        configured: credential !== undefined || hasStoredCredential,
        ...(credential ? { authType: credential.type as AgentAuthType } : {}),
        reauthRequired: this.reauthRequired.has(provider),
        oauthAvailable: capability.oauthAvailable,
        apiKeyAvailable: capability.apiKeyAvailable
      }
    }
    return {
      encryptionAvailable: this.encryptionAvailable(),
      providers
    }
  }

  private requireEncryption(): void {
    if (!this.encryptionAvailable()) {
      throw new DesktopError(
        'PERMISSION_DENIED',
        'Secure credential storage is unavailable. Aladdeen will not store credentials in plaintext.'
      )
    }
  }
}
