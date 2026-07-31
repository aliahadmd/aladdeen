#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { setTimeout } from 'node:timers'

const options = JSON.parse(process.env.ALADDEEN_AGENT_WORKER_OPTIONS || '{}')
const pendingCredentials = new Map()

process.on('message', (message) => {
  if (message?.channel === 'credential-response') {
    const resolve = pendingCredentials.get(message.requestId)
    if (!resolve) return
    pendingCredentials.delete(message.requestId)
    resolve(message)
    return
  }
  if (message?.channel !== 'auth-control') return
  if (message.type === 'cancel') {
    send({ channel: 'auth', type: 'cancelled' })
    finish()
    return
  }
  if (message.type !== 'prompt-response') return
  if (options.authType === 'api_key') {
    void persistApiKey(message.value)
    return
  }
  if (options.provider === 'openai-codex') {
    if (message.value === 'device_code') {
      send({
        channel: 'auth',
        type: 'device-code',
        userCode: 'CODE-X55',
        verificationUri: 'https://auth.openai.com/codex/device',
        expiresInSeconds: 900
      })
    } else {
      send({
        channel: 'auth',
        type: 'url',
        kind: 'browser',
        url: 'https://auth.openai.com/oauth/authorize?state=renderer-must-not-see-this'
      })
    }
    void persistOAuth()
  } else if (options.provider === 'anthropic') {
    void persistOAuth()
  }
})

function send(message) {
  if (process.connected && process.send) process.send(message)
}

async function persistOAuth() {
  const requestId = randomUUID()
  const response = new Promise((resolve) => pendingCredentials.set(requestId, resolve))
  send({
    channel: 'credential',
    requestId,
    operation: 'write',
    providerId: options.provider,
    credential: {
      type: 'oauth',
      access: `fake-access-${options.provider}`,
      refresh: `fake-refresh-${options.provider}`,
      expires: Date.now() + 3_600_000
    }
  })
  const result = await response
  if (!result.ok) {
    send({ channel: 'auth', type: 'failed', message: result.error || 'Credential write failed.' })
    finish(1)
    return
  }
  send({ channel: 'auth', type: 'completed' })
  finish()
}

async function persistApiKey(key) {
  const requestId = randomUUID()
  const response = new Promise((resolve) => pendingCredentials.set(requestId, resolve))
  send({
    channel: 'credential',
    requestId,
    operation: 'write',
    providerId: options.provider,
    credential: { type: 'api_key', key }
  })
  const result = await response
  if (!result.ok) {
    send({ channel: 'auth', type: 'failed', message: result.error || 'Credential write failed.' })
    finish(1)
    return
  }
  send({ channel: 'auth', type: 'completed' })
  finish()
}

function finish(code = 0) {
  process.exitCode = code
  setTimeout(() => {
    if (process.connected) process.disconnect()
    process.exit(code)
  }, 30)
}

setTimeout(() => {
  if (options.mode === 'capabilities') {
    send({
      channel: 'auth',
      type: 'capabilities',
      providers: [
        {
          provider: 'anthropic',
          name: 'Anthropic',
          oauthAvailable: true,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'anthropic',
            id: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            supportsThinking: true
          }, {
            provider: 'anthropic',
            id: 'claude-opus-4-5',
            name: 'Claude Opus 4.5',
            supportsThinking: true
          }, {
            provider: 'anthropic',
            id: 'claude-haiku-4-5',
            name: 'Claude Haiku 4.5',
            supportsThinking: false
          }]
        },
        {
          provider: 'openai-codex',
          name: 'OpenAI Codex',
          oauthAvailable: true,
          apiKeyAvailable: false,
          dynamicCatalog: false,
          models: [{
            provider: 'openai-codex',
            id: 'gpt-5.5',
            name: 'GPT-5.5',
            supportsThinking: true
          }, {
            provider: 'openai-codex',
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            supportsThinking: true
          }]
        },
        {
          provider: 'kimi-coding',
          name: 'Kimi Coding',
          oauthAvailable: true,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'kimi-coding',
            id: 'kimi-for-coding',
            name: 'Kimi for Coding',
            supportsThinking: true
          }]
        },
        {
          provider: 'openai',
          name: 'OpenAI',
          oauthAvailable: false,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'openai',
            id: 'gpt-5',
            name: 'GPT-5',
            supportsThinking: true
          }]
        },
        {
          provider: 'google',
          name: 'Google',
          oauthAvailable: false,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'google',
            id: 'gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            supportsThinking: true
          }]
        },
        {
          provider: 'deepseek',
          name: 'DeepSeek',
          oauthAvailable: false,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'deepseek',
            id: 'deepseek-reasoner',
            name: 'DeepSeek Reasoner',
            supportsThinking: true,
            protocol: 'openai-completions'
          }]
        },
        {
          provider: 'openrouter',
          name: 'OpenRouter',
          oauthAvailable: true,
          apiKeyAvailable: true,
          dynamicCatalog: true,
          models: [{
            provider: 'openrouter',
            id: 'openrouter/auto',
            name: 'OpenRouter Auto',
            supportsThinking: false,
            protocol: 'openai-completions'
          }]
        },
        {
          provider: 'groq',
          name: 'Groq',
          oauthAvailable: false,
          apiKeyAvailable: true,
          dynamicCatalog: false,
          models: [{
            provider: 'groq',
            id: 'llama-3.3-70b-versatile',
            name: 'Llama 3.3 70B',
            supportsThinking: false,
            protocol: 'openai-completions'
          }]
        }
      ]
    })
    finish()
    return
  }
  if (options.mode === 'refresh') {
    send({
      channel: 'auth',
      type: 'models',
      provider: options.provider,
      models: []
    })
    finish()
    return
  }
  if (options.mode !== 'login') {
    finish(1)
    return
  }

  send({ channel: 'auth', type: 'ready' })
  if (options.authType === 'api_key') {
    send({
      channel: 'auth',
      type: 'prompt',
      promptId: randomUUID(),
      promptType: 'secret',
      message: `Enter the API key for ${options.provider}`
    })
    return
  }
  if (options.provider === 'openai-codex') {
    send({
      channel: 'auth',
      type: 'prompt',
      promptId: randomUUID(),
      promptType: 'select',
      message: 'Choose a Codex login method',
      options: [
        { id: 'browser', label: 'Browser' },
        { id: 'device_code', label: 'Device code' }
      ]
    })
  } else if (options.provider === 'anthropic') {
    send({
      channel: 'auth',
      type: 'url',
      kind: 'browser',
      url: 'https://claude.ai/oauth/authorize?state=renderer-must-not-see-this'
    })
    send({
      channel: 'auth',
      type: 'prompt',
      promptId: randomUUID(),
      promptType: 'manual_code',
      message: 'Complete Claude login, then paste the authorization code.',
      placeholder: 'http://localhost:53692/callback'
    })
  } else if (options.provider === 'kimi-coding') {
    send({
      channel: 'auth',
      type: 'device-code',
      userCode: 'KIMI-CODE',
      verificationUri: 'https://www.kimi.com/code?code=renderer-must-not-see-this',
      expiresInSeconds: 900
    })
    setTimeout(() => void persistOAuth(), 1_000)
  } else if (options.provider === 'openrouter') {
    send({
      channel: 'auth',
      type: 'url',
      kind: 'browser',
      url: 'https://openrouter.ai/auth?state=renderer-must-not-see-this'
    })
    setTimeout(() => void persistOAuth(), 100)
  } else {
    send({ channel: 'auth', type: 'failed', message: 'Unsupported fake provider.' })
    finish(1)
  }
}, 50)
