import { describe, expect, it } from 'vitest'
import { applyAiEvent, initialAiState } from '@renderer/store/ai-store'
import type { AiEvent } from '@shared/contracts'

type AiReducerState = Parameters<typeof applyAiEvent>[0]

const sessionId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'

function baseMessages() {
  return {
    [sessionId]: [
      { id: 'user-1', role: 'user' as const, blocks: [{ type: 'text' as const, text: 'hello' }], createdAt: 1 }
    ]
  }
}

describe('applyAiEvent reducer', () => {
  it('creates a streaming assistant message on run-started and appends deltas', () => {
    let state: AiReducerState = {
      ...initialAiState,
      activeSessionId: sessionId,
      messagesBySession: baseMessages()
    }
    state = {
      ...state,
      ...applyAiEvent(state, { type: 'run-started', sessionId, messageId })
    }
    expect(state.runStatus).toBe('streaming')
    expect(state.messagesBySession[sessionId]).toHaveLength(2)

    state = {
      ...state,
      ...applyAiEvent(state, { type: 'thinking-delta', sessionId, messageId, delta: 'hmm ' })
    }
    state = {
      ...state,
      ...applyAiEvent(state, { type: 'text-delta', sessionId, messageId, delta: 'Answer' })
    }
    const blocks = state.messagesBySession[sessionId]?.[1]?.blocks ?? []
    expect(blocks[0]).toEqual({ type: 'thinking', text: 'hmm ' })
    expect(blocks[1]).toEqual({ type: 'text', text: 'Answer' })

    state = {
      ...state,
      ...applyAiEvent(state, { type: 'text-delta', sessionId, messageId, delta: ' continues' })
    }
    expect(state.messagesBySession[sessionId]?.[1]?.blocks[1]).toEqual({ type: 'text', text: 'Answer continues' })
  })

  it('routes approval requests through pendingApproval and clears on resolution', () => {
    let state: AiReducerState = {
      ...initialAiState,
      activeSessionId: sessionId,
      messagesBySession: baseMessages(),
      runStatus: 'streaming' as const
    }
    const event: AiEvent = {
      type: 'approval-requested',
      sessionId,
      requestId: 'req-1',
      toolUseId: 't1',
      name: 'write_file',
      input: { relative_path: 'a.md' }
    }
    state = { ...state, ...applyAiEvent(state, event) }
    expect(state.runStatus).toBe('awaiting-approval')
    expect(state.pendingApproval?.requestId).toBe('req-1')

    state = {
      ...state,
      ...applyAiEvent(state, { type: 'approval-resolved', sessionId, requestId: 'req-1', approved: true })
    }
    expect(state.runStatus).toBe('streaming')
    expect(state.pendingApproval).toBeNull()
  })

  it('finalizes runs and captures errors, ignoring foreign sessions', () => {
    let state: AiReducerState = {
      ...initialAiState,
      activeSessionId: sessionId,
      messagesBySession: baseMessages(),
      runStatus: 'streaming' as const
    }
    state = {
      ...state,
      ...applyAiEvent(state, { type: 'run-error', sessionId: '99999999-9999-4999-8999-999999999999', code: 'INTERNAL', message: 'nope' })
    }
    expect(state.runStatus).toBe('streaming')

    state = {
      ...state,
      ...applyAiEvent(state, { type: 'run-completed', sessionId, messageId })
    }
    expect(state.runStatus).toBe('idle')
    expect(state.streamingMessageId).toBeNull()
  })
})
