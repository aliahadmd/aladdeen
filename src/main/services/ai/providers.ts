import { ANTHROPIC_API_VERSION } from '@shared/ai'
import type { AiReasoning } from '@shared/ai'
import type { AiContentBlock, AiToolName } from '@shared/ai'
import { DesktopError } from '@main/errors'

export interface AiToolDefinition {
  name: AiToolName
  description: string
  inputSchema: Record<string, unknown>
}

export interface AiProviderTurn {
  role: 'user' | 'assistant'
  blocks: AiContentBlock[]
}

export interface AiProviderRequest {
  model: string
  system: string
  turns: AiProviderTurn[]
  tools: AiToolDefinition[]
  reasoning: AiReasoning
}

export interface AiHttpRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export type AiStreamChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-use'; index: number; id: string; name: string }
  | { kind: 'tool-input'; index: number; partialJson: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'finish' }

const REASONING_EFFORT: Record<AiReasoning, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high'
}

// OpenAI-family reasoning models accept reasoning_effort; other models reject
// it with a 400, so the request builder only sets it for likely reasoning
// models and the service retries without it on a parameter error.
function supportsReasoningEffort(modelId: string): boolean {
  return /^(?:o[134]|gpt-5)/iu.test(modelId)
}

export function mapReasoningEffort(reasoning: AiReasoning): 'low' | 'medium' | 'high' {
  return REASONING_EFFORT[reasoning]
}

export function buildAnthropicRequest(
  request: AiProviderRequest,
  baseUrl: string,
  apiKey: string
): AiHttpRequest {
  const thinkingBudget: Record<AiReasoning, number> = {
    low: 4_096,
    medium: 8_192,
    high: 16_384,
    max: 32_768
  }
  const body = {
    model: request.model,
    max_tokens: thinkingBudget[request.reasoning] + 16_384,
    stream: true,
    system: request.system,
    messages: request.turns.map((turn) => ({
      role: turn.role,
      content: turn.blocks.map((block) => translateAnthropicBlock(block))
    })),
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    })),
    thinking: { type: 'enabled', budget_tokens: thinkingBudget[request.reasoning] }
  }
  return {
    url: `${baseUrl}/v1/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION
    },
    body: JSON.stringify(body)
  }
}

function translateAnthropicBlock(block: AiContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'thinking':
      return { type: 'thinking', thinking: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {})
      }
  }
}

export function buildOpenAiCompatibleRequest(
  request: AiProviderRequest,
  baseUrl: string,
  apiKey: string,
  options: { includeReasoningEffort?: boolean } = {}
): AiHttpRequest {
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: request.system }]
  for (const turn of request.turns) {
    const text = turn.blocks
      .filter((block): block is Extract<AiContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const toolUses = turn.blocks.filter(
      (block): block is Extract<AiContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
    )
    const toolResults = turn.blocks.filter(
      (block): block is Extract<AiContentBlock, { type: 'tool_result' }> => block.type === 'tool_result'
    )
    if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        ...(text !== '' ? { content: text } : {}),
        ...(toolUses.length > 0
          ? {
              tool_calls: toolUses.map((block) => ({
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input) }
              }))
            }
          : {})
      })
    } else {
      if (text !== '') messages.push({ role: 'user', content: text })
      for (const result of toolResults) {
        messages.push({ role: 'tool', tool_call_id: result.toolUseId, content: result.content })
      }
    }
  }
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...(request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema
            }
          }))
        }
      : {})
  }
  const includeReasoningEffort = options.includeReasoningEffort ?? supportsReasoningEffort(request.model)
  if (includeReasoningEffort) body.reasoning_effort = REASONING_EFFORT[request.reasoning]
  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }
}

export interface SseFrame {
  event: string | null
  data: string
}

async function* readableStreamToIterable(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseSseFrame(block: string): SseFrame | null {
  let event: string | null = null
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (event === null && dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

export async function* readSseFrames(
  stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  decoder: TextDecoder = new TextDecoder()
): AsyncGenerator<SseFrame> {
  const chunks: AsyncIterable<Uint8Array> = Symbol.asyncIterator in stream
    ? stream
    : readableStreamToIterable(stream as ReadableStream<Uint8Array>)
  let buffer = ''
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const frame = parseSseFrame(block)
      if (frame) yield frame
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  const trimmed = buffer.trim()
  if (trimmed !== '') {
    const frame = parseSseFrame(trimmed)
    if (frame) yield frame
  }
}

export type AnthropicFrameHandler = (frame: SseFrame) => AiStreamChunk[]

interface AnthropicBlockState {
  type: 'text' | 'thinking' | 'tool_use'
  id?: string
  name?: string
}

export function createAnthropicFrameHandler(): AnthropicFrameHandler {
  const blocks = new Map<number, AnthropicBlockState>()
  return (frame) => {
    if (frame.event === 'ping') return []
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(frame.data) as Record<string, unknown>
    } catch {
      return []
    }
    switch (frame.event ?? '') {
      case 'message_start': {
        const message = payload.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined
        const usage = message?.usage
        if (!usage) return []
        return [
          {
            kind: 'usage',
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0
          }
        ]
      }
      case 'content_block_start': {
        const index = payload.index as number
        const block = payload.content_block as { type: string; id?: string; name?: string }
        blocks.set(index, { type: block.type as AnthropicBlockState['type'], id: block.id, name: block.name })
        if (block.type === 'tool_use' && block.id && block.name) {
          return [{ kind: 'tool-use', index, id: block.id, name: block.name }]
        }
        return []
      }
      case 'content_block_delta': {
        const index = payload.index as number
        const delta = payload.delta as { type: string; text?: string; thinking?: string; partial_json?: string }
        if (delta.type === 'text_delta' && delta.text) return [{ kind: 'text', text: delta.text }]
        if (delta.type === 'thinking_delta' && delta.thinking) {
          return [{ kind: 'thinking', text: delta.thinking }]
        }
        if (delta.type === 'input_json_delta' && delta.partial_json) {
          return [{ kind: 'tool-input', index, partialJson: delta.partial_json }]
        }
        return []
      }
      case 'message_delta': {
        const delta = payload.delta as { stop_reason?: string } | undefined
        const usage = payload.usage as { output_tokens?: number } | undefined
        const chunks: AiStreamChunk[] = []
        if (usage?.output_tokens) chunks.push({ kind: 'usage', inputTokens: 0, outputTokens: usage.output_tokens })
        if (delta?.stop_reason && delta.stop_reason !== 'null') chunks.push({ kind: 'finish' })
        return chunks
      }
      case 'error': {
        const error = payload.error as { message?: string } | undefined
        throw new DesktopError('INTERNAL', error?.message ?? 'The provider stream reported an error.')
      }
      default:
        return []
    }
  }
}

export type OpenAiFrameHandler = (frame: SseFrame) => AiStreamChunk[]

interface OpenAiToolState {
  id: string
  name: string
}

export function createOpenAiFrameHandler(): OpenAiFrameHandler {
  const tools = new Map<number, OpenAiToolState>()
  return (frame) => {
    const data = frame.data.trim()
    if (data === '[DONE]') return [{ kind: 'finish' }]
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      return []
    }
    const choices = payload.choices as Array<Record<string, unknown>> | undefined
    const chunks: AiStreamChunk[] = []
    const choice = choices?.[0]
    if (choice) {
      const delta = choice.delta as {
        content?: string | null
        reasoning_content?: string | null
        reasoning?: string | null
        tool_calls?: Array<{
          index: number
          id?: string
          function?: { name?: string; arguments?: string }
        }>
      } | undefined
      if (delta?.reasoning_content) chunks.push({ kind: 'thinking', text: delta.reasoning_content })
      else if (delta?.reasoning) chunks.push({ kind: 'thinking', text: delta.reasoning })
      if (delta?.content) chunks.push({ kind: 'text', text: delta.content })
      for (const call of delta?.tool_calls ?? []) {
        const state = tools.get(call.index)
        if (call.id && call.function?.name && (!state || state.id !== call.id)) {
          tools.set(call.index, { id: call.id, name: call.function.name })
          chunks.push({ kind: 'tool-use', index: call.index, id: call.id, name: call.function.name })
        }
        if (call.function?.arguments) {
          chunks.push({ kind: 'tool-input', index: call.index, partialJson: call.function.arguments })
        }
      }
    }
    const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (usage) {
      chunks.push({
        kind: 'usage',
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0
      })
    }
    return chunks
  }
}

export function extractProviderErrorMessage(status: number, payload: string): DesktopError {
  let message = `The provider returned HTTP ${status}.`
  try {
    const parsed = JSON.parse(payload) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'object' && typeof parsed.error?.message === 'string') {
      message = parsed.error.message
    } else if (typeof parsed.error === 'string') {
      message = parsed.error
    } else if (typeof parsed.message === 'string') {
      message = parsed.message
    }
  } catch {
    if (payload.trim() !== '') message = payload.slice(0, 400)
  }
  const code = status === 401 || status === 403 ? 'PERMISSION_DENIED' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL'
  return new DesktopError(code, message)
}
