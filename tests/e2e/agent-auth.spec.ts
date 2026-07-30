import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

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

test('creates, discovers, verifies, and selects a loopback-compatible model', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-custom-provider-profile-'))
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
    await window.getByRole('switch', { name: 'Enable coding agent' }).click()

    await window.getByRole('button', { name: 'Add custom endpoint' }).click()
    await window.getByRole('button', { name: /Local server/i }).click()
    await window.getByLabel('Provider name').fill('Local Ollama')
    await window.getByRole('button', { name: /^Continue$/ }).click()
    await window.getByRole('button', { name: /^Continue$/ }).click()
    await window.getByRole('button', { name: 'Save provider' }).click()

    await window.getByRole('button', { name: 'Discover models' }).click()
    await expect(window.getByText(/Discovered Coder · Confirm metadata/)).toBeVisible()
    const defaultModel = window.getByLabel('Default agent model')
    await expect(defaultModel.locator('option[value="discovered-coder"]')).toBeDisabled()

    await window.getByRole('button', { name: 'Review', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Edit custom provider' })).toBeVisible()
    await window.getByRole('button', { name: /^Continue$/ }).click()
    await window.getByRole('button', { name: /^Continue$/ }).click()
    await window.getByRole('button', { name: 'Save changes' }).click()
    await expect(window.getByText(/Discovered Coder · Not verified/)).toBeVisible()

    window.once('dialog', (dialog) => void dialog.accept())
    await window.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(window.getByText(/Discovered Coder · Verified/)).toBeVisible()
    await expect(defaultModel.locator('option[value="discovered-coder"]')).toBeEnabled()
    await defaultModel.selectOption('discovered-coder')
    await expect(defaultModel).toHaveValue('discovered-coder')
  } finally {
    await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
