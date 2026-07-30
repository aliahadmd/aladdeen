export type AgentProvider =
  | 'anthropic'
  | 'openai-codex'
  | 'kimi-coding'
  | 'openai'
  | 'google'

export type AgentAuthPromptType = 'text' | 'secret' | 'select' | 'manual_code'

export interface AgentAuthPromptOption {
  id: string
  label: string
  description?: string
}

export type AgentWorkerMode = 'session' | 'login' | 'capabilities'

export interface AgentWorkerOptions {
  mode: AgentWorkerMode
  provider?: AgentProvider
  modelId?: string
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

export type AgentWorkerAuthMessage =
  | { channel: 'auth'; type: 'ready' }
  | {
      channel: 'auth'
      type: 'capabilities'
      providers: Array<{
        provider: string
        oauthAvailable: boolean
        apiKeyAvailable: boolean
        models: Array<{
          provider: string
          id: string
          name: string
          supportsThinking: boolean
        }>
      }>
    }
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
  | { channel: 'auth-control'; type: 'prompt-response'; promptId: string; value: string }
  | { channel: 'auth-control'; type: 'cancel' }

export type AgentWorkerMessage = AgentWorkerCredentialRequest | AgentWorkerAuthMessage
