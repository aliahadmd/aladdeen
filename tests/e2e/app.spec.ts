import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('onboards into a persistent environment', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Create your first environment' })).toBeVisible()
    await expect(window.getByLabel('Environment name')).toHaveValue('Personal')
    await expect(window).toHaveScreenshot('onboarding.png', { animations: 'disabled', maxDiffPixelRatio: 0.01 })
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.getByRole('button', { name: 'Switch environment' })).toContainText('Personal')
    await expect(window.getByRole('heading', { name: 'Your Markdown, one calm place.' })).toBeVisible()
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('opens, previews, edits, and autosaves a Markdown file', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-workspace-'))
  const markdownPath = join(workspace, 'hello.md')
  const pdfPath = join(workspace, 'hello.pdf')
  const docxPath = join(workspace, 'hello.docx')
  await writeFile(markdownPath, '# Hello FluidMD\n\n- [x] Preview works\n', 'utf8')
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await expect(window.getByText(/After setup, we’ll open/)).toBeVisible()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.getByRole('heading', { name: 'Hello FluidMD' })).toBeVisible()
    await expect(window.getByRole('tab', { name: /hello\.md/i })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Individual files' })).toBeVisible()
    await expect(window.locator('.tracked-file-row')).toContainText('hello.md')

    await window.getByRole('button', { name: 'Edit' }).click()
    const editor = window.locator('.cm-content')
    await expect(editor).toBeVisible()
    await editor.click()
    await window.keyboard.press('ControlOrMeta+A')
    await window.keyboard.type('# Edited offline\n\nAutosave keeps this on disk.')
    await expect(window.getByRole('heading', { name: 'Edited offline' })).toBeVisible()
    await expect.poll(async () => readFile(markdownPath, 'utf8')).toContain('Autosave keeps this on disk.')

    await application.evaluate(({ dialog }, filePath) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath })
      })
    }, pdfPath)
    await window.getByRole('button', { name: /Export/ }).click()
    await window.getByRole('menuitem', { name: /Export as PDF/ }).click()
    await expect
      .poll(async () => readFile(pdfPath).then((buffer) => buffer.subarray(0, 4).toString()).catch(() => ''), {
        timeout: 10_000
      })
      .toBe('%PDF')

    await application.evaluate(({ dialog }, filePath) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath })
      })
    }, docxPath)
    await window.getByRole('button', { name: /Export/ }).click()
    await window.getByRole('menuitem', { name: /Export as DOCX/ }).click()
    await expect
      .poll(async () => readFile(docxPath).then((buffer) => buffer.subarray(0, 2).toString()).catch(() => ''), {
        timeout: 10_000
      })
      .toBe('PK')
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})

test('restores tabs independently for each environment', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-environments-'))
  const folder = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-files-'))
  const markdownPath = join(folder, 'persistent.md')
  await writeFile(markdownPath, '# Persistent tab\n', 'utf8')
  let application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    let window = await application.firstWindow()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.getByRole('tab', { name: /persistent\.md/i })).toBeVisible()

    await window.getByRole('button', { name: 'Switch environment' }).click()
    await window.getByRole('menuitem', { name: 'New environment' }).click()
    await window.getByPlaceholder('Environment name').fill('Work')
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Switch environment' })).toContainText('Work')
    await expect(window.getByRole('tab', { name: /persistent\.md/i })).toHaveCount(0)

    await window.getByRole('button', { name: 'Switch environment' }).click()
    await window.getByRole('menuitem', { name: 'Personal' }).click()
    await expect(window.getByRole('tab', { name: /persistent\.md/i })).toBeVisible()

    await application.close()
    application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
    window = await application.firstWindow()
    await expect(window.getByRole('button', { name: 'Switch environment' })).toContainText('Personal')
    await expect(window.getByRole('tab', { name: /persistent\.md/i })).toBeVisible()
  } finally {
    await application.close()
    await Promise.all([rm(userData, { recursive: true, force: true }), rm(folder, { recursive: true, force: true })])
  }
})

test('keeps the environment sidebar usable at compact window sizes', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-compact-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Create environment' }).click()

    for (const size of [{ width: 900, height: 700 }, { width: 640, height: 480 }]) {
      await window.setViewportSize(size)
      await window.getByRole('button', { name: 'Toggle sidebar' }).click()
      const sheet = window.getByRole('dialog', { name: 'Environment files' })
      await expect(sheet.locator('.sheet-panel')).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'New file' })).toBeVisible()
      await expect(sheet.getByRole('heading', { name: 'Projects' })).toBeVisible()
      const box = await sheet.locator('.sheet-panel').boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width)
      if (size.width === 640) await expect(window).toHaveScreenshot('compact-sidebar.png', { animations: 'disabled', maxDiffPixelRatio: 0.01 })
      await sheet.getByRole('button', { name: 'Close sidebar' }).last().click()
    }
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})
