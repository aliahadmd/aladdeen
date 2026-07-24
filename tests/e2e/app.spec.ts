import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

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
    await expect(window.locator('.tracked-file-row')).toContainText('hello')
    await expect(window.locator('.tracked-file-copy strong')).toHaveText('hello')

    await window.getByRole('button', { name: 'Edit' }).click()
    const editor = window.locator('.cm-content')
    await expect(editor).toBeVisible()
    await editor.click()
    await window.keyboard.press('ControlOrMeta+A')
    await window.keyboard.insertText(
      '# Edited offline\n\nAutosave keeps this on disk.\n\n## Ignored subsection\n\n# Final chapter\n\nDone.'
    )
    await expect(window.getByRole('heading', { name: 'Edited offline' })).toBeVisible()
    await expect.poll(async () => readFile(markdownPath, 'utf8')).toContain('Autosave keeps this on disk.')

    await window.getByRole('button', { name: 'Preview' }).click()
    await window.setViewportSize({ width: 900, height: 700 })
    const outlineTrigger = window.getByRole('button', { name: '2 level 1 headings' })
    await expect(outlineTrigger).toBeVisible()
    await outlineTrigger.hover()
    const outline = window.getByRole('navigation', { name: 'Level 1 headings' })
    await expect(outline.getByRole('button', { name: 'Edited offline' })).toBeVisible()
    await expect(outline.getByRole('button', { name: 'Final chapter' })).toBeVisible()
    await expect(outline.getByRole('button', { name: 'Ignored subsection' })).toHaveCount(0)
    await expect(window).toHaveScreenshot('heading-outline-open.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await window.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    await expect(window).toHaveScreenshot('heading-outline-open-dark.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await window.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.dataset.theme = 'light'
    })
    await outline.getByRole('button', { name: 'Final chapter' }).click()
    await expect(window.getByRole('heading', { name: 'Final chapter' })).toBeInViewport()
    await expect(outline.getByRole('button', { name: 'Final chapter' })).toHaveAttribute('aria-current', 'location')

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
      await window.getByRole('button', { name: 'Show sidebar' }).click()
      const sheet = window.getByRole('dialog', { name: 'Environment files' })
      await expect(sheet.locator('.sheet-panel')).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'New file' })).toBeVisible()
      await expect(sheet.getByRole('heading', { name: 'Projects' })).toBeVisible()
      const box = await sheet.locator('.sheet-panel').boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width)
      if (size.width === 640) {
        await sheet.getByRole('button', { name: 'Appearance' }).click()
        await expect(window.getByRole('menuitem', { name: 'System' })).toBeVisible()
        await window.getByRole('menuitem', { name: 'System' }).click()
        await expect(window).toHaveScreenshot('compact-sidebar.png', { animations: 'disabled', maxDiffPixelRatio: 0.01 })
      }
      await sheet.getByRole('button', { name: 'Close sidebar' }).last().click()
    }
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('uses compact document chrome and persists the desktop sidebar layout', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-chrome-'))
  let application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    let window = await application.firstWindow()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.locator('.topbar')).toHaveCount(0)
    await expect(window.locator('.sidebar')).toHaveCSS('width', '320px')

    const resizer = window.getByRole('separator', { name: 'Resize sidebar' })
    await resizer.focus()
    await resizer.press('ArrowRight')
    await expect(window.locator('.sidebar')).toHaveCSS('width', '336px')

    await window.getByRole('button', { name: 'Settings' }).click()
    const settings = window.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expect(settings.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    await settings.getByRole('button', { name: 'Close settings' }).click()

    await window.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(window.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await expect.poll(async () => {
      const result = await window.evaluate(() => globalThis.window.fluidmd.settings.get())
      return result.ok ? result.value : null
    }).toMatchObject({ sidebarWidth: 336, sidebarCollapsed: true })

    await application.close()
    application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
    window = await application.firstWindow()
    await expect(window.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await window.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(window.locator('.sidebar')).toHaveCSS('width', '336px')
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('renders extended Markdown safely and responsively', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-markdown-'))
  const workspace = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-markdown-file-'))
  const markdownPath = join(workspace, 'compatibility.md')
  const fixture = await readFile(resolve('tests/fixtures/markdown-compatibility.md'), 'utf8')
  await writeFile(markdownPath, fixture, 'utf8')
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    const remoteRequests: string[] = []
    window.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url())
    })
    await window.getByRole('button', { name: 'Create environment' }).click()

    await expect(window.getByRole('article', { name: 'FluidMD Compatibility' })).toBeVisible()
    await expect(window.getByText('title: "FluidMD Compatibility"')).toHaveCount(0)
    await expect(window.locator('.markdown-toc')).toHaveCount(1)
    await expect(window.locator('.markdown-callout')).toContainText('Local first')
    await expect(window.locator('dl')).toContainText('A definition with formatting.')
    await expect(window.locator('.katex')).toHaveCount(3)
    await expect(window.locator('section[data-footnotes]')).toContainText('Stored on disk.')
    await expect(window.locator('.markdown-body script')).toHaveCount(0)
    await expect(window.locator('.mermaid-svg svg')).toBeVisible({ timeout: 10_000 })
    expect(remoteRequests).toEqual([])

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 900, height: 700 },
      { width: 640, height: 480 }
    ]) {
      await window.setViewportSize(viewport)
      for (const theme of ['light', 'dark'] as const) {
        await window.evaluate((nextTheme) => {
          document.documentElement.classList.toggle('dark', nextTheme === 'dark')
          document.documentElement.dataset.theme = nextTheme
        }, theme)
        await expect(window).toHaveScreenshot(`markdown-${viewport.width}-${theme}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.01
        })
      }
    }
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})

test('exports extended Markdown structure to PDF and DOCX', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-export-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'fluidmd-e2e-export-file-'))
  const markdownPath = join(workspace, 'export-compatibility.md')
  const pdfPath = join(workspace, 'export-compatibility.pdf')
  const docxPath = join(workspace, 'export-compatibility.docx')
  const fixture = await readFile(resolve('tests/fixtures/markdown-compatibility.md'), 'utf8')
  await writeFile(markdownPath, `${fixture}\n\n![Local image](pixel.png)\n`, 'utf8')
  await writeFile(
    join(workspace, 'pixel.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.locator('.mermaid-svg svg')).toBeVisible({ timeout: 10_000 })

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
        timeout: 20_000
      })
      .toBe('%PDF')
    expect((await readFile(pdfPath)).length).toBeGreaterThan(10_000)

    await application.evaluate(({ dialog }, filePath) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath })
      })
    }, docxPath)
    await window.getByRole('button', { name: /Export/ }).click()
    await window.getByRole('menuitem', { name: /Export as DOCX/ }).click()
    await expect
      .poll(async () => readFile(docxPath).then((buffer) => buffer.length).catch(() => 0), { timeout: 20_000 })
      .toBeGreaterThan(0)
    const docx = await readFile(docxPath)
    const archive = unzipSync(new Uint8Array(docx))
    const documentXml = strFromU8(archive['word/document.xml']!)
    const coreXml = strFromU8(archive['docProps/core.xml']!)
    const footnotesXml = strFromU8(archive['word/footnotes.xml']!)

    expect(coreXml).toContain('FluidMD Compatibility')
    expect(coreXml).toContain('offline, markdown')
    expect(documentXml).toContain('A definition with ')
    expect(documentXml).toContain('Local first')
    expect(documentXml).toContain('Mermaid diagram')
    expect(documentXml).toContain('E = mc^2')
    expect(footnotesXml).toContain('Stored on disk.')
    expect(Object.keys(archive).some((name) => name.startsWith('word/media/'))).toBe(true)
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})
