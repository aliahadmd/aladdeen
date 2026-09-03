import { describe, expect, it } from 'vitest'
import {
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  createAnthropicFrameHandler,
  createOpenAiFrameHandler,
  mapReasoningEffort,
  openAiEndpointCandidates,
  parseSseFrame,
  readSseFrames
} from '@main/services/ai/providers'
import type { AiProviderRequest } from '@main/services/ai/providers'

const baseRequest: AiProviderRequest = {
  model: 'test-model',
  system: 'system prompt',
  turns: [
    { role: 'user', blocks: [{ type: 'text', text: 'hello' }] },
    {
      role: 'assistant',
      blocks: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { project_id: 'p', relative_path: 'a.md' } }]
    },
    {
      role: 'user',
      blocks: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'file body', isError: false }]
    }
  ],
  tools: [
    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }
  ],
  reasoning: 'high'
}

async function* streamOf(chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield new TextEncoder().encode(chunk)
}

describe('ai providers', () => {
  it('builds Anthropic requests with thinking budgets and canonical blocks', () => {
    const request = buildAnthropicRequest(baseRequest, 'https://api.anthropic.com', 'key-123')
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers['x-api-key']).toBe('key-123')
    expect(request.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(request.body) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(true)
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16_384 })
    expect(body.max_tokens).toBe(16_384 + 16_384)
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    expect(messages[1]?.content[0]).toEqual({
      type: 'tool_use',
      id: 'tool-1',
      name: 'read_file',
      input: { project_id: 'p', relative_path: 'a.md' }
    })
    expect(messages[2]?.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'tool-1', content: 'file body' })
  })

  it('builds OpenAI-compatible requests with tool messages and reasoning effort heuristics', () => {
    const request = buildOpenAiCompatibleRequest(baseRequest, 'https://api.example.com', 'key-456')
    expect(request.url).toBe('https://api.example.com/v1/chat/completions')
    expect(request.headers.authorization).toBe('Bearer key-456')
    const body = JSON.parse(request.body) as {
      messages: Array<Record<string, unknown>>
      reasoning_effort?: string
      tools: Array<{ function: { name: string } }>
    }
    expect(body.messages).toHaveLength(4)
    expect((body.messages[2] as Record<string, unknown> | undefined)?.tool_calls).toEqual([{
      id: 'tool-1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"project_id":"p","relative_path":"a.md"}' }
    }])
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'tool-1', content: 'file body' })
    // 'test-model' is not a known reasoning model, so effort is omitted.
    expect(body.reasoning_effort).toBeUndefined()
    expect(mapReasoningEffort('max')).toBe('high')
  })

  it('joins endpoint URLs tolerating bases with or without a /v1 suffix', () => {
    expect(openAiEndpointCandidates('https://api.deepseek.com', 'models')).toEqual([
      'https://api.deepseek.com/v1/models',
      'https://api.deepseek.com/models'
    ])
    expect(openAiEndpointCandidates('https://api.example.com/', 'chat/completions')).toEqual([
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/chat/completions'
    ])
    expect(openAiEndpointCandidates('https://api.example.com/v1', 'models')).toEqual([
      'https://api.example.com/v1/models'
    ])
    expect(openAiEndpointCandidates('https://127.0.0.1:11434/v1/', 'models')).toEqual([
      'https://127.0.0.1:11434/v1/models'
    ])
  })

  it('parses SSE frames including split chunks and multi-line data', async () => {
    const frames: string[] = []
    for await (const frame of readSseFrames(streamOf([
      'event: content_block_delta\ndata: {"a":1}\n\n',
      'event: content_bl',
      'ock_delta\ndata: {"b":2}\n\ndata: [DONE]\n\n'
    ]))) {
      frames.push(`${frame.event ?? ''}|${frame.data}`)
    }
    expect(frames).toEqual([
      'content_block_delta|{"a":1}',
      'content_block_delta|{"b":2}',
      '|[DONE]'
    ])
    expect(parseSseFrame('event: ping\n\n')).toEqual({ event: 'ping', data: '' })
    expect(parseSseFrame('')).toBeNull()
  })

  it('translates Anthropic stream frames into canonical chunks', () => {
    const handler = createAnthropicFrameHandler()
    const collected: string[] = []
    const frames = [
      'event: message_start\ndata: {"message":{"usage":{"input_tokens":10,"output_tokens":1}}}',
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"thinking"}}',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"Let me"}}',
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"t1","name":"read_file"}}',
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}',
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"text_delta","text":"Hi"}}',
      'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":21}}',
      'event: ping\ndata: {}'
    ]
    for (const frame of frames) {
      for (const chunk of handler(parseSseFrame(frame)!)) collected.push(`${chunk.kind}`)
    }
    expect(collected).toEqual([
      'usage', 'thinking', 'tool-use', 'tool-input', 'text', 'usage', 'finish'
    ])
  })

  it('translates OpenAI stream frames including tool-call accumulation and [DONE]', () => {
    const handler = createOpenAiFrameHandler()
    const events: Array<Record<string, unknown>> = []
    const frames = [
      'data: {"choices":[{"delta":{"reasoning_content":"plan"}}]}',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"write_file","arguments":"{\\"rel"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ative_path\\":\\"a.md\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":7}}',
      'data: [DONE]'
    ]
    for (const frame of frames) {
      for (const chunk of handler(parseSseFrame(frame)!)) events.push(chunk as Record<string, unknown>)
    }
    expect(events.map((event) => event.kind)).toEqual([
      'thinking', 'text', 'tool-use', 'tool-input', 'tool-input', 'usage', 'finish'
    ])
    expect(events[2]).toMatchObject({ id: 'c1', name: 'write_file' })
    expect(events[4]).toMatchObject({ partialJson: 'ative_path":"a.md"}' })
  })
})
