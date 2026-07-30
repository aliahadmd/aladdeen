import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('connects Codex, Claude, and Kimi accounts, then replaces and disconnects a credential', async () => {
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

    await expect(window.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled()
    await expect(window.getByText(/Anthropic extra usage/i)).toBeVisible()
    await window.getByRole('switch', { name: 'Enable coding agent' }).click()
    await expect(window.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled()

    await window.getByRole('button', { name: 'Continue with ChatGPT' }).click()
    await expect(window.getByRole('dialog', { name: 'Connect provider account' })).toBeVisible()
    await window.getByRole('button', { name: 'Browser', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Account connected' })).toBeVisible()
    await expect(window.getByText('renderer-must-not-see-this')).toHaveCount(0)
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByText('Connected · account').first()).toBeVisible()
    await expect(window.getByLabel('Agent model ID')).toHaveValue('gpt-5.5')

    await window.getByRole('button', { name: 'Continue with Claude' }).click()
    await expect(window.getByText('Complete Claude login, then paste the authorization code.')).toBeVisible()
    await window.getByLabel('Login response').fill('one-time-claude-code')
    await window.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Account connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByLabel('Agent model ID')).toHaveValue('claude-sonnet-4-5')

    await window.getByRole('button', { name: 'Continue with Kimi' }).click()
    await expect(window.getByText('KIMI-CODE')).toBeVisible()
    await expect(window.getByText('renderer-must-not-see-this')).toHaveCount(0)
    await expect(window.getByRole('heading', { name: 'Account connected' })).toBeVisible()
    await window.getByRole('button', { name: 'Done' }).click()
    await expect(window.getByLabel('Agent model ID')).toHaveValue('kimi-for-coding')

    await window.getByLabel('kimi-coding API key').fill('fake-kimi-api-key')
    await window.getByRole('button', { name: 'Use API key' }).click()
    await expect(window.getByText('API key saved')).toBeVisible()
    await window.getByRole('button', { name: 'Disconnect Kimi Code' }).click()
    const kimiCard = window.getByRole('button', { name: 'Use Kimi Code' }).locator('../..')
    await expect(kimiCard.getByText('Not connected')).toBeVisible()
  } finally {
    await application.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
