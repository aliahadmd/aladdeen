export type AgentProvider = string
export type AgentAuthType = 'oauth' | 'api_key'
export type AgentApiProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
export type AgentEndpointScope = 'public_https' | 'loopback'
export type AgentAuthScheme = 'bearer' | 'x-api-key' | 'none'

export type AgentAuthPromptType = 'text' | 'secret' | 'select' | 'manual_code'

export interface AgentAuthPromptOption {
  id: string
  label: string
  description?: string
}

export interface AgentWorkerModel {
  provider: string
  id: string
  name: string
  supportsThinking: boolean
  protocol?: AgentApiProtocol
  supportsVision?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  source?: 'pi' | 'custom' | 'discovered'
  verified?: boolean
}

export interface AgentWorkerProviderProfile {
  id: string
  name: string
  protocol: AgentApiProtocol
  baseUrl: string
  endpointScope: AgentEndpointScope
  authScheme: AgentAuthScheme
  catalogMode: 'manual' | 'remote'
  compatibility: Record<string, unknown>
  models: AgentWorkerModel[]
}

export type AgentWorkerMode =
  | 'session'
  | 'login'
  | 'capabilities'
  | 'refresh'
  | 'discover'
  | 'verify'

export interface AgentWorkerOptions {
  mode: AgentWorkerMode
  provider?: AgentProvider
  authType?: AgentAuthType
  modelId?: string
  profile?: AgentWorkerProviderProfile
  thinkingLevel?: string
  cwd?: string
  sessionDirectory?: string
  agentDirectory?: string
  approvalExtensionPath?: string
}

export type AgentWorkerCredentialRequest =
  | { channel: 'credential'; requestId: string; operation: 'read'; providerId: string }
  | { channel: 'credential'; requestId: string; operation: 'list' }
  | { channel: 'credential'; requestId: string; operation: 'write'; providerId: string; credential: unknown }
  | { channel: 'credential'; requestId: string; operation: 'delete'; providerId: string }

export type AgentWorkerCredentialResponse =
  | { channel: 'credential-response'; requestId: string; ok: true; value?: unknown }
  | { channel: 'credential-response'; requestId: string; ok: false; error: string }

export type AgentWorkerModelsStoreRequest =
  | { channel: 'models-store'; requestId: string; operation: 'read'; providerId: string }
  | {
      channel: 'models-store'
      requestId: string
      operation: 'write'
      providerId: string
      entry: unknown
    }
  | { channel: 'models-store'; requestId: string; operation: 'delete'; providerId: string }

export type AgentWorkerModelsStoreResponse =
  | { channel: 'models-store-response'; requestId: string; ok: true; value?: unknown }
  | { channel: 'models-store-response'; requestId: string; ok: false; error: string }

export type AgentWorkerAuthMessage =
  | { channel: 'auth'; type: 'ready' }
  | {
      channel: 'auth'
      type: 'capabilities'
      providers: Array<{
        provider: string
        name: string
        oauthAvailable: boolean
        apiKeyAvailable: boolean
        dynamicCatalog: boolean
        models: AgentWorkerModel[]
      }>
    }
  | { channel: 'auth'; type: 'models'; provider: string; models: AgentWorkerModel[] }
  | { channel: 'auth'; type: 'verified'; provider: string; model: AgentWorkerModel }
  | { channel: 'auth'; type: 'url'; url: string; kind: 'browser' | 'device' }
  | {
      channel: 'auth'
      type: 'device-code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | {
      channel: 'auth'
      type: 'prompt'
      promptId: string
      promptType: AgentAuthPromptType
      message: string
      placeholder?: string
      options?: AgentAuthPromptOption[]
    }
  | { channel: 'auth'; type: 'progress'; message: string }
  | { channel: 'auth'; type: 'completed' }
  | { channel: 'auth'; type: 'failed'; message: string }
  | { channel: 'auth'; type: 'cancelled' }

export type AgentWorkerControlMessage =
  | AgentWorkerCredentialResponse
  | AgentWorkerModelsStoreResponse
  | { channel: 'auth-control'; type: 'prompt-response'; promptId: string; value: string }
  | { channel: 'auth-control'; type: 'cancel' }

export type AgentWorkerMessage =
  | AgentWorkerCredentialRequest
  | AgentWorkerModelsStoreRequest
  | AgentWorkerAuthMessage
