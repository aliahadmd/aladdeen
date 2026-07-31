import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { AppDatabase } from '../../src/main/services/database'

test('connects subscription and native API providers without exposing credentials', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-agent-auth-profile-'))
  const fakeAuthWorker = resolve('tests/fixtures/fake-pi/auth-worker.mjs')
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ALADDEEN_AGENT_WORKER_PATH: fakeAuthWorker
    }
  })

  try {
    await application.evaluate(({ shell }) => {
      Object.defineProperty(shell, 'openExternal', {
        configurable: true,
        value: async () => ''
      })
    })
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('tab', { name: 'Coding agent' }).click()

    await expect(window.getByRole('button', { name: 'Continue with ChatGPT' })).toHaveCount(0)
    await expect(window.getByText(/Anthropic extra usage/i)).toBeVisible()
    await window.getByRole('switch', { name: 'Enable coding agent' }).click()
    await expect(window.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled()

    await window.getByRole('button', { name: 'Continue with ChatGPT' }).click()
    await expect(window.getByRole('dialog', { name: 'Connect provider' })).toBeVisible()
    await window.getByRole('button', { name: 'Browser', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await expect(window.getByText('renderer-must-not-see-this')).toHaveCount(0)
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByText('Connected · account').first()).toBeVisible()
    await expect(window.getByLabel('Default agent model')).toHaveValue('gpt-5.5')

    await window.getByRole('button', { name: 'Continue with Claude' }).click()
    await expect(window.getByText('Complete Claude login, then paste the authorization code.')).toBeVisible()
    await window.getByLabel('Login response').fill('one-time-claude-code')
    await window.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByLabel('Default agent model')).toHaveValue('claude-sonnet-4-5')

    await window.getByRole('button', { name: 'Continue with Kimi' }).click()
    await expect(window.getByText('KIMI-CODE')).toBeVisible()
    await expect(window.getByText('renderer-must-not-see-this')).toHaveCount(0)
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByLabel('Default agent model')).toHaveValue('kimi-for-coding')

    const kimiCard = window.getByRole('button', { name: 'Use Kimi Code' }).locator('../..')
    await kimiCard.getByRole('button', { name: 'API key', exact: true }).click()
    await window.getByLabel('Login response').fill('fake-kimi-api-key')
    await window.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(kimiCard.getByText(/Connected · API key/)).toBeVisible()
    await window.getByRole('button', { name: 'Disconnect Kimi Code' }).click()
    await expect(kimiCard.getByText(/1 model/)).toBeVisible()

    const deepSeekCard = window.getByRole('button', { name: 'Use DeepSeek' }).locator('../..')
    await deepSeekCard.getByRole('button', { name: 'API key', exact: true }).click()
    await window.getByLabel('Login response').fill('fake-deepseek-api-key')
    await window.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByText('Connected · API key').first()).toBeVisible()
    await expect(window.getByLabel('Default agent model')).toHaveValue('')
    await window.getByLabel('Default agent model').selectOption('deepseek-reasoner')

    const openRouterCard = window.getByRole('button', { name: 'Use OpenRouter' }).locator('../..')
    await openRouterCard.getByRole('button', { name: 'Continue with OpenRouter' }).click()
    await expect(window.getByText(/downstream providers/i)).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Provider connected' })).toBeVisible()
    await expect(window.getByText('renderer-must-not-see-this')).toHaveCount(0)
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByLabel('Default agent model')).toHaveValue('')

    await window.getByLabel('Search providers').fill('Groq')
    await window.getByRole('button', { name: 'Use Groq' }).click()
    await expect(window.getByLabel('Default agent model')).toHaveValue('')
  } finally {
    await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('migrates legacy custom endpoints to a native provider and allows explicit cleanup', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-legacy-provider-profile-'))
  const providerId = 'custom:123e4567-e89b-42d3-a456-426614174000'
  const seeded = new AppDatabase(userData)
  seeded.saveAgentProviderProfile({
    id: providerId,
    name: 'Local Ollama',
    protocol: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    endpointScope: 'loopback',
    authScheme: 'bearer',
    catalogMode: 'manual',
    compatibility: {},
    models: [{
      provider: providerId,
      id: 'old-local-model',
      name: 'Old Local Model',
      supportsThinking: false,
      source: 'custom'
    }],
    createdAt: 100,
    updatedAt: 100
  })
  seeded.setAgentSecret(providerId, Buffer.from('encrypted-legacy-record'))
  seeded.setSettings({
    ...seeded.getSettings(),
    agentEnabled: true,
    agentProvider: providerId,
    agentModelId: 'old-local-model'
  })
  seeded.close()
  const fakeAuthWorker = resolve('tests/fixtures/fake-pi/auth-worker.mjs')
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ALADDEEN_AGENT_WORKER_PATH: fakeAuthWorker
    }
  })

  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('tab', { name: 'Coding agent' }).click()
    await expect(window.getByRole('button', { name: 'Add custom endpoint' })).toHaveCount(0)
    await expect(window.getByRole('button', { name: 'Use Claude' })).toHaveAttribute('aria-pressed', 'true')
    await expect(window.getByLabel('Default agent model')).toHaveValue('claude-sonnet-4-5')
    await expect(window.getByText('Local Ollama')).toBeVisible()
    await expect(window.getByText(/127\.0\.0\.1|old-local-model|openai-completions/)).toHaveCount(0)
    window.once('dialog', (dialog) => void dialog.accept())
    await window.getByRole('button', { name: 'Disconnect and remove' }).click()
    await expect(window.getByText('Local Ollama')).toHaveCount(0)
  } finally {
    await application.close().catch(() => undefined)
    const verified = new AppDatabase(userData)
    expect(verified.getAgentProviderProfile(providerId)).toBeUndefined()
    expect(verified.getAgentSecret(providerId)).toBeNull()
    verified.close()
    await rm(userData, { recursive: true, force: true })
  }
})
