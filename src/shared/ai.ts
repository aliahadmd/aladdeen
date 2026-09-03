export const AI_PROVIDERS = ['anthropic', 'openai-compatible'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const AI_REASONING_LEVELS = ['low', 'medium', 'high', 'max'] as const
export type AiReasoning = (typeof AI_REASONING_LEVELS)[number]

export const AI_MODES = ['plan', 'ask', 'full'] as const
export type AiMode = (typeof AI_MODES)[number]

export const AI_MODE_DESCRIPTIONS: Record<AiMode, string> = {
  plan: 'Read-only. The AI can list and read files but never changes them.',
  ask: 'The AI proposes file changes and waits for your approval each time.',
  full: 'The AI applies file changes directly. External edits still block writes.'
}

export const AI_PANEL_MIN_WIDTH = 300
export const AI_PANEL_DEFAULT_WIDTH = 380
export const AI_PANEL_MAX_WIDTH = 560

// Extended-thinking budgets in tokens per reasoning level (Anthropic); the
// OpenAI-compatible provider maps these onto reasoning_effort instead.
export const AI_THINKING_BUDGETS: Record<AiReasoning, number> = {
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  max: 32_768
}

export const AI_TOOLS = ['list_files', 'read_file', 'write_file'] as const
export type AiToolName = (typeof AI_TOOLS)[number]

export interface AiMentionedFile {
  projectId: string
  relativePath: string
  fileId?: string
}

export interface AiTextBlock {
  type: 'text'
  text: string
}

export interface AiThinkingBlock {
  type: 'thinking'
  text: string
}

export interface AiToolUseBlock {
  type: 'tool_use'
  id: string
  name: AiToolName
  input: Record<string, unknown>
}

export interface AiToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError: boolean
}

export type AiContentBlock = AiTextBlock | AiThinkingBlock | AiToolUseBlock | AiToolResultBlock

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: AiContentBlock[]
  createdAt: number
}

export interface AiSessionSummary {
  id: string
  title: string
  projectId: string | null
  createdAt: number
  updatedAt: number
}

export interface AiSessionDetail extends AiSessionSummary {
  messages: AiChatMessage[]
}

export interface AiModelInfo {
  provider: AiProvider
  id: string
  label: string
}

export interface AiCredentialStatus {
  encryptionAvailable: boolean
  hasApiKey: Record<AiProvider, boolean>
}

export interface AiProviderProfileInfo {
  provider: AiProvider
  baseUrl: string
  allowLocal: boolean
  manualModelId: string
}

export interface AiUsageInfo {
  inputTokens: number
  outputTokens: number
}

export type AiRunStatus = 'idle' | 'streaming' | 'awaiting-approval'

export type AiEvent =
  | { type: 'run-started'; sessionId: string; messageId: string }
  | { type: 'thinking-delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'text-delta'; sessionId: string; messageId: string; delta: string }
  | {
      type: 'tool-started'
      sessionId: string
      messageId: string
      toolUseId: string
      name: AiToolName
      input: Record<string, unknown>
    }
  | {
      type: 'tool-finished'
      sessionId: string
      messageId: string
      toolUseId: string
      summary: string
      isError: boolean
    }
  | {
      type: 'approval-requested'
      sessionId: string
      requestId: string
      toolUseId: string
      name: AiToolName
      input: Record<string, unknown>
    }
  | { type: 'approval-resolved'; sessionId: string; requestId: string; approved: boolean }
  | { type: 'usage'; sessionId: string; usage: AiUsageInfo }
  | { type: 'run-completed'; sessionId: string; messageId: string }
  | { type: 'run-cancelled'; sessionId: string }
  | { type: 'run-error'; sessionId: string; code: string; message: string }

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_API_VERSION = '2023-06-01'
export const ANTHROPIC_DEFAULT_MODEL_ID = 'claude-sonnet-4-5'
