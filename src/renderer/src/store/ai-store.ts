import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  AiChatMessage,
  AiContentBlock,
  AiEvent,
  AiModelInfo,
  AiMentionedFile,
  AiRunStatus,
  AiSessionSummary,
  AiUsageInfo
} from '@shared/contracts'

export interface AiApprovalRequest {
  requestId: string
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

export interface AiState {
  sessions: AiSessionSummary[]
  activeSessionId: string | null
  messagesBySession: Record<string, AiChatMessage[]>
  runStatus: AiRunStatus
  streamingMessageId: string | null
  pendingApproval: AiApprovalRequest | null
  usage: AiUsageInfo | null
  error: string | null
  models: AiModelInfo[]
  modelsLoading: boolean
  setSessions(sessions: AiSessionSummary[]): void
  openSession(session: AiSessionSummary, messages: AiChatMessage[]): void
  setActiveSession(sessionId: string | null): void
  setModels(models: AiModelInfo[]): void
  setModelsLoading(loading: boolean): void
  applyEvent(event: AiEvent): void
  reset(): void
}

export const initialAiState = {
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  runStatus: 'idle' as AiRunStatus,
  streamingMessageId: null,
  pendingApproval: null,
  usage: null,
  error: null,
  models: [],
  modelsLoading: false
}

function appendDelta(
  blocks: AiContentBlock[],
  kind: 'text' | 'thinking',
  delta: string
): AiContentBlock[] {
  const next = [...blocks]
  const last = next[next.length - 1]
  if (last && last.type === kind) {
    next[next.length - 1] = { ...last, text: last.text + delta }
  } else {
    next.push(kind === 'text' ? { type: 'text', text: delta } : { type: 'thinking', text: delta })
  }
  return next
}

export function applyAiEvent(
  state: Pick<AiState, 'activeSessionId' | 'messagesBySession' | 'runStatus' | 'streamingMessageId' | 'pendingApproval' | 'usage'>,
  event: AiEvent
): Partial<AiState> {
  // Live events only drive the chat that is open; background sessions reload
  // their persisted transcript from the database when switched to.
  if (state.activeSessionId !== null && state.activeSessionId !== event.sessionId) return {}
  const sessionId = event.sessionId
  const messages = state.messagesBySession[sessionId] ?? []
  const lastMessage = messages[messages.length - 1]
  const withMessages = (updated: AiChatMessage[]): Pick<AiState, 'messagesBySession'> => ({
    messagesBySession: { ...state.messagesBySession, [sessionId]: updated }
  })

  switch (event.type) {
    case 'run-started': {
      if (!lastMessage || lastMessage.id !== event.messageId) {
        return {
          runStatus: 'streaming',
          streamingMessageId: event.messageId,
          usage: null,
          ...withMessages([
            ...messages,
            { id: event.messageId, role: 'assistant', blocks: [], createdAt: Date.now() }
          ])
        }
      }
      return { runStatus: 'streaming', streamingMessageId: event.messageId, usage: null }
    }
    case 'thinking-delta':
    case 'text-delta': {
      if (!lastMessage) return {}
      const kind = event.type === 'text-delta' ? 'text' : 'thinking'
      return withMessages([
        ...messages.slice(0, -1),
        { ...lastMessage, blocks: appendDelta(lastMessage.blocks, kind, event.delta) }
      ])
    }
    case 'tool-started':
      return { runStatus: 'streaming', pendingApproval: null }
    case 'tool-finished':
      return {}
    case 'approval-requested':
      return {
        runStatus: 'awaiting-approval',
        pendingApproval: {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          name: event.name,
          input: event.input
        }
      }
    case 'approval-resolved':
      return state.pendingApproval?.requestId === event.requestId
        ? { runStatus: 'streaming', pendingApproval: null }
        : {}
    case 'usage':
      return { usage: event.usage }
    case 'run-completed':
    case 'run-cancelled':
    case 'run-error':
      return {
        runStatus: 'idle',
        streamingMessageId: null,
        pendingApproval: null,
        ...(event.type === 'run-error' ? { error: event.message } : {})
      }
    default:
      return {}
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  ...initialAiState,
  setSessions: (sessions) => set({ sessions }),
  openSession: (session, messages) =>
    set((state) => ({
      activeSessionId: session.id,
      messagesBySession: { ...state.messagesBySession, [session.id]: messages },
      runStatus: 'idle',
      streamingMessageId: null,
      pendingApproval: null
    })),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setModels: (models) => set({ models }),
  setModelsLoading: (modelsLoading) => set({ modelsLoading }),
  applyEvent: (event) => {
    const state = get()
    if (state.activeSessionId !== event.sessionId) return
    set(applyAiEvent(state, event))
    if (event.type === 'run-error') toast.error(event.message)
  },
  reset: () => set(initialAiState)
}))

export async function refreshAiSessions(): Promise<void> {
  const result = await window.aladdeen.ai.listSessions()
  if (result.ok) useAiStore.getState().setSessions(result.value)
}

export async function sendAiMessage(content: string, mentionedFiles: AiMentionedFile[]): Promise<void> {
  const state = useAiStore.getState()
  const sessionId = state.activeSessionId
  if (!sessionId || state.runStatus !== 'idle') return
  const userMessage: AiChatMessage = {
    id: `local-${crypto.randomUUID()}`,
    role: 'user',
    blocks: [{ type: 'text', text: content }],
    createdAt: Date.now()
  }
  useAiStore.setState((current) => ({
    messagesBySession: {
      ...current.messagesBySession,
      [sessionId]: [...(current.messagesBySession[sessionId] ?? []), userMessage]
    }
  }))
  const result = await window.aladdeen.ai.send(sessionId, content, mentionedFiles)
  if (!result.ok) {
    toast.error(result.error.message)
    useAiStore.setState((current) => ({
      messagesBySession: {
        ...current.messagesBySession,
        [sessionId]: (current.messagesBySession[sessionId] ?? []).filter(
          (message) => message.id !== userMessage.id
        )
      },
      runStatus: 'idle'
    }))
  }
}
