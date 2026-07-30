import { describe, expect, it } from 'vitest'
import {
  applyAgentEvent,
  type AgentReducerState
} from '@renderer/store/app-store'

const initial: AgentReducerState = {
  runState: 'idle',
  transcript: [],
  pendingApprovals: {}
}

describe('agent transcript reducer', () => {
  it('accumulates assistant deltas and upserts tool output', () => {
    let state = applyAgentEvent(initial, {
      type: 'assistant-start',
      sessionId: 'session',
      messageId: 'assistant'
    })
    state = applyAgentEvent(state, {
      type: 'text-delta',
      sessionId: 'session',
      messageId: 'assistant',
      delta: 'Hello '
    })
    state = applyAgentEvent(state, {
      type: 'text-delta',
      sessionId: 'session',
      messageId: 'assistant',
      delta: 'world'
    })
    state = applyAgentEvent(state, {
      type: 'tool-start',
      sessionId: 'session',
      toolCallId: 'tool-1',
      toolName: 'read',
      input: { path: 'README.md' }
    })
    state = applyAgentEvent(state, {
      type: 'tool-end',
      sessionId: 'session',
      toolCallId: 'tool-1',
      output: 'contents',
      truncated: false,
      isError: false
    })

    expect(state.transcript[0]).toMatchObject({ kind: 'assistant', text: 'Hello world' })
    expect(state.transcript[1]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool-1',
      status: 'complete',
      output: 'contents'
    })
  })

  it('tracks pending approvals and their resolved outcome', () => {
    let state = applyAgentEvent(initial, {
      type: 'approval-request',
      sessionId: 'session',
      requestId: 'approval-1',
      toolName: 'bash',
      input: { command: 'pnpm test' }
    })
    expect(state.pendingApprovals).toEqual({ 'approval-1': true })
    state = applyAgentEvent(state, {
      type: 'approval-resolved',
      sessionId: 'session',
      requestId: 'approval-1',
      decision: 'deny'
    })
    expect(state.pendingApprovals).toEqual({})
    expect(state.transcript[0]).toMatchObject({ kind: 'approval', decision: 'deny' })
  })

  it('preserves a streaming abort error when the final message-end event has no error', () => {
    let state = applyAgentEvent(initial, {
      type: 'assistant-start',
      sessionId: 'session',
      messageId: 'assistant'
    })
    state = applyAgentEvent(state, {
      type: 'assistant-end',
      sessionId: 'session',
      messageId: 'assistant',
      stopReason: 'aborted',
      error: 'Stopped by the user.'
    })
    state = applyAgentEvent(state, {
      type: 'assistant-end',
      sessionId: 'session',
      messageId: 'assistant',
      stopReason: 'aborted'
    })
    expect(state.transcript[0]).toMatchObject({
      kind: 'assistant',
      error: 'Stopped by the user.'
    })
  })
})
