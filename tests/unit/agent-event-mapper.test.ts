// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mapPiEvent } from '@main/services/agent'

describe('pi event mapper', () => {
  it('maps assistant deltas and tool lifecycle events to sanitized renderer events', () => {
    const started = mapPiEvent(
      { type: 'message_start', message: { role: 'assistant', id: 'message-1' } },
      'session-1',
      undefined,
      () => 'generated'
    )
    expect(started).toEqual({
      currentAssistantId: 'message-1',
      events: [{ type: 'assistant-start', sessionId: 'session-1', messageId: 'message-1' }]
    })

    const delta = mapPiEvent({
      type: 'message_update',
      message: { role: 'assistant' },
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Considering…' }
    }, 'session-1', started.currentAssistantId)
    expect(delta.events[0]).toEqual({
      type: 'thinking-delta',
      sessionId: 'session-1',
      messageId: 'message-1',
      delta: 'Considering…'
    })

    const tool = mapPiEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'read',
      args: { path: 'README.md' }
    }, 'session-1')
    expect(tool.events[0]).toEqual({
      type: 'tool-start',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'README.md' }
    })
  })

  it('caps tool output sent to the renderer', () => {
    const mapped = mapPiEvent({
      type: 'tool_execution_update',
      toolCallId: 'call-large',
      partialResult: { content: [{ type: 'text', text: 'x'.repeat(40_000) }] }
    }, 'session-1')
    expect(mapped.events[0]).toMatchObject({
      type: 'tool-update',
      toolCallId: 'call-large',
      truncated: true
    })
    const output = (mapped.events[0] as { output: string }).output
    expect(Buffer.byteLength(output)).toBeLessThan(17_000)
  })

  it('classifies provider credential failures', () => {
    const mapped = mapPiEvent({
      type: 'message_update',
      message: { role: 'assistant', id: 'assistant-auth' },
      assistantMessageEvent: {
        type: 'error',
        reason: 'error',
        error: '401 unauthorized: invalid API key'
      }
    }, 'session-1', 'assistant-auth')
    expect(mapped.events).toContainEqual({
      type: 'session-error',
      sessionId: 'session-1',
      code: 'AUTH_FAILED',
      message: '401 unauthorized: invalid API key'
    })
  })
})
