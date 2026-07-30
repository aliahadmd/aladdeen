#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { clearInterval, setInterval } from 'node:timers'

let promptNumber = 0
let pendingApproval
let activeTimer
let activeMessageId
let alwaysAllowed = false
let shuttingDown = false

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function settle(messageId, text, stopReason = 'stop') {
  send({
    type: 'message_end',
    message: { role: 'assistant', id: messageId, stopReason, content: [{ type: 'text', text }] }
  })
  send({ type: 'agent_settled' })
}

function startScriptedPrompt(message) {
  promptNumber += 1
  activeMessageId = `assistant-${promptNumber}`
  send({ type: 'agent_start' })
  send({ type: 'message_start', message: { role: 'assistant', id: activeMessageId, content: [] } })
  send({
    type: 'message_update',
    message: { role: 'assistant', id: activeMessageId },
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Checking the active project.' }
  })
  send({
    type: 'message_update',
    message: { role: 'assistant', id: activeMessageId },
    assistantMessageEvent: { type: 'thinking_end', contentIndex: 0 }
  })

  if (/abort/i.test(message)) {
    let step = 0
    activeTimer = setInterval(() => {
      step += 1
      send({
        type: 'message_update',
        message: { role: 'assistant', id: activeMessageId },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: `stream-${step} ` }
      })
    }, 100)
    return
  }

  send({
    type: 'tool_execution_start',
    toolCallId: `read-${promptNumber}`,
    toolName: 'read',
    args: { path: 'notes.md' }
  })
  send({
    type: 'tool_execution_end',
    toolCallId: `read-${promptNumber}`,
    toolName: 'read',
    result: { content: [{ type: 'text', text: '# Fake project notes' }] },
    isError: false
  })

  if (alwaysAllowed) {
    finishApproval('allow-always')
    return
  }
  pendingApproval = `approval-${promptNumber}`
  send({
    type: 'extension_ui_request',
    id: pendingApproval,
    method: 'select',
    title: JSON.stringify({
      kind: 'aladdeen-approval',
      toolCallId: `bash-${promptNumber}`,
      toolName: 'bash',
      input: { command: 'printf fake-pi' }
    }),
    options: ['allow', 'allow-always', 'deny']
  })
}

function finishApproval(decision) {
  if (decision === 'allow-always') alwaysAllowed = true
  const denied = decision === 'deny' || decision === 'cancelled'
  send({
    type: 'tool_execution_start',
    toolCallId: `bash-${promptNumber}`,
    toolName: 'bash',
    args: { command: 'printf fake-pi' }
  })
  send({
    type: 'tool_execution_end',
    toolCallId: `bash-${promptNumber}`,
    toolName: 'bash',
    result: {
      content: [{ type: 'text', text: denied ? 'Command denied by the user.' : 'fake-pi' }]
    },
    isError: denied
  })
  const text = denied ? 'The command was denied.' : 'The approved command completed.'
  send({
    type: 'message_update',
    message: { role: 'assistant', id: activeMessageId },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: text }
  })
  settle(activeMessageId, text)
  pendingApproval = undefined
}

function stopStreaming() {
  if (activeTimer) clearInterval(activeTimer)
  activeTimer = undefined
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (command.type === 'extension_ui_response') {
    if (command.id === pendingApproval) {
      finishApproval(command.cancelled ? 'cancelled' : command.value)
    }
    return
  }
  if (command.type === 'get_available_models') {
    send({
      type: 'response',
      id: command.id,
      command: command.type,
      success: true,
      data: {
        models: [{
          provider: 'anthropic',
          id: 'claude-sonnet-4-5',
          name: 'Fake Claude',
          reasoning: true
        }]
      }
    })
    return
  }
  if (command.type === 'set_model') {
    send({
      type: 'response',
      id: command.id,
      command: command.type,
      success: true,
      data: {
        provider: command.provider,
        id: command.modelId,
        name: 'Fake model',
        reasoning: true
      }
    })
    return
  }
  if (command.type === 'abort') {
    send({ type: 'response', id: command.id, command: command.type, success: true })
    stopStreaming()
    if (activeMessageId) {
      send({
        type: 'message_update',
        message: { role: 'assistant', id: activeMessageId },
        assistantMessageEvent: { type: 'error', reason: 'aborted', error: 'Stopped by the user.' }
      })
      settle(activeMessageId, '', 'aborted')
      activeMessageId = undefined
    }
    return
  }
  send({ type: 'response', id: command.id, command: command.type, success: true })
  if (command.type === 'prompt') startScriptedPrompt(command.message)
})

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  stopStreaming()
  if (process.env.ALADDEEN_FAKE_PI_SENTINEL) {
    appendFileSync(process.env.ALADDEEN_FAKE_PI_SENTINEL, `${signal}\n`)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
input.on('close', () => shutdown('STDIN_END'))
