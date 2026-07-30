import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('streams agent output, gates tools, aborts, and shuts down the child', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-agent-profile-'))
  const projectPath = await mkdtemp(join(tmpdir(), 'aladdeen-agent-project-'))
  const sentinel = join(userData, 'fake-pi-shutdown.txt')
  await writeFile(join(projectPath, 'notes.md'), '# Agent fixture\n', 'utf8')
  const fakePi = resolve('tests/fixtures/fake-pi/cli.mjs')
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ALADDEEN_PI_CLI_PATH: fakePi,
      ALADDEEN_FAKE_PI_SENTINEL: sentinel
    }
  })
  let shutdownVerified = false

  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await window.getByRole('button', { name: 'Create environment' }).click()

    await application.evaluate(({ dialog }, folder) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [folder] })
      })
    }, projectPath)
    await window.getByRole('button', { name: 'Add project' }).click()
    await window.getByRole('menuitem', { name: 'Add existing folder' }).click()
    await expect(window.getByRole('heading', { name: 'Add project folders' })).toBeVisible()
    await window.getByRole('button', { name: 'Choose one or more folders' }).click()
    await window.getByRole('button', { name: 'Add 1 project' }).click()
    await expect(window.getByText(projectPath.split('/').pop()!, { exact: true }).first()).toBeVisible()

    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('tab', { name: 'Coding agent' }).click()
    await window.getByLabel('anthropic API key').fill('test-api-key-not-real')
    await window.getByRole('button', { name: 'Save key' }).click()
    await expect(window.getByText('Key saved')).toBeVisible()
    await window.getByRole('switch', { name: /coding agent/i }).click()
    await window.getByRole('button', { name: 'Close settings' }).click()

    await expect(window.getByRole('complementary').filter({ hasText: 'Coding agent' })).toBeVisible()
    const composer = window.getByLabel('Message the coding agent')
    await composer.fill('Inspect and run the fixture')
    await composer.press('Enter')
    await expect(window.getByText('Checking the active project.')).toBeHidden()
    await expect(window.getByText('Approve bash')).toBeVisible()
    await window.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(window.getByText('The approved command completed.')).toBeVisible()

    await composer.fill('Please abort this stream')
    await composer.press('Enter')
    await expect(window.getByText(/stream-1/)).toBeVisible()
    await window.getByRole('button', { name: 'Stop agent' }).click()
    await expect(window.getByText('Stopped by the user.')).toBeVisible()

    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('tab', { name: 'Coding agent' }).click()
    await window.getByRole('switch', { name: 'Disable coding agent' }).click()
    await expect.poll(
      async () => readFile(sentinel, 'utf8').catch(() => ''),
      { timeout: 10_000 }
    ).toMatch(/SIGTERM|STDIN_END/)
    shutdownVerified = true
  } finally {
    await application.close().catch(() => undefined)
    if (!shutdownVerified) {
      const shutdown = await readFile(sentinel, 'utf8').catch(() => '')
      if (!shutdown) process.stderr.write('Fake pi did not record shutdown before the test failed.\n')
    }
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(projectPath, { recursive: true, force: true })
    ])
  }
})
