import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { loadWorkbook, workbookToBytes } from '@office-kit/xlsx/io'
import { fromBuffer } from '@office-kit/xlsx/node'
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook'
import { getCell, setCell } from '@office-kit/xlsx/worksheet'
import { Document, HeadingLevel, Packer, Paragraph } from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PptxHandler, TextBuilder } from 'pptx-viewer-core'
import sharp from 'sharp'

// macOS font rasterization varies slightly across runner and host OS releases.
// Keep this scoped to onboarding visuals; semantic assertions still verify the content.
const ONBOARDING_SCREENSHOT_MAX_DIFF_PIXEL_RATIO = 0.02

async function createFirstEnvironment(window: import('@playwright/test').Page): Promise<void> {
  const skipTutorial = window.getByRole('button', { name: 'Skip tutorial' })
  await skipTutorial.waitFor({ state: 'visible' })
  await skipTutorial.click()
  await window.getByRole('button', { name: 'Create environment' }).click()
}

function namespaceWorkbookSheetElements(bytes: Uint8Array): Uint8Array {
  const archive = unzipSync(bytes)
  const workbookPart = archive['xl/workbook.xml']
  if (!workbookPart) throw new Error('The XLSX fixture has no workbook metadata.')
  const workbookXml = strFromU8(workbookPart)
    .replace('<workbook ', '<workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ')
    .replaceAll('<sheet ', '<x:sheet ')
    .replaceAll('</sheet>', '</x:sheet>')
  archive['xl/workbook.xml'] = strToU8(workbookXml)
  return zipSync(archive)
}

test('opens, edits, autosaves, and reopens a local XLSX workbook', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-xlsx-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-xlsx-workspace-'))
  const xlsxPath = join(workspace, 'budget.xlsx')
  const source = createWorkbook()
  const sourceSheet = addWorksheet(source, 'Budget')
  setCell(sourceSheet, 1, 1, 'Original budget')
  const initialBytes = namespaceWorkbookSheetElements(await workbookToBytes(source))
  await writeFile(xlsxPath, initialBytes)
  let application = await electron.launch({ args: ['.', xlsxPath, `--user-data-dir=${userData}`] })

  try {
    let window = await application.firstWindow()
    await createFirstEnvironment(window)
    const editor = window.locator('.aladdeen-xlsx-host')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await expect(editor.getByText('Budget', { exact: true })).toBeVisible({ timeout: 15_000 })
    const documentFooter = window.locator('footer').filter({ hasText: 'XLSX' })
    await expect(documentFooter).toContainText('Saved')
    await window.waitForTimeout(1_800)
    expect((await readFile(xlsxPath)).equals(Buffer.from(initialBytes))).toBe(true)

    const canvas = editor.locator('canvas[id^="univer-sheet-main-canvas_"]')
    await expect(canvas).toBeVisible()
    // Univer renders cell text on a small document canvas above the sheet canvas.
    // Target the sheet surface directly so Playwright does not mistake that render
    // layer for an interactive obstruction when the selected cell contains text.
    await canvas.click({ position: { x: 85, y: 38 }, force: true })
    await window.keyboard.insertText('Updated budget')
    await window.keyboard.press('Enter')

    await expect(documentFooter).toContainText('Saved', { timeout: 20_000 })
    await expect.poll(async () => {
      const saved = await loadWorkbook(fromBuffer(await readFile(xlsxPath)))
      const sheet = saved.sheets.find((candidate) => candidate.kind === 'worksheet')
      return sheet?.kind === 'worksheet' ? getCell(sheet.sheet, 1, 1)?.value : undefined
    }, { timeout: 20_000 }).toBe('Updated budget')

    await closeElectron(application)
    application = await electron.launch({ args: ['.', xlsxPath, `--user-data-dir=${userData}`] })
    window = await application.firstWindow()
    const reopened = window.locator('.aladdeen-xlsx-host')
    await expect(reopened).toBeVisible({ timeout: 30_000 })
    await expect(reopened.getByText('Budget', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(reopened.locator('canvas[id^="univer-sheet-main-canvas_"]')).toBeVisible()
  } finally {
    await closeElectron(application)
    await Promise.all([
      rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ])
  }
})

test('requires one compatibility copy and preserves unknown XLSX parts on later autosaves', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-xlsx-preserve-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-xlsx-preserve-workspace-'))
  const xlsxPath = join(workspace, 'preservation.xlsx')
  const copyPath = join(workspace, 'preservation copy.xlsx')
  const source = createWorkbook()
  const sourceSheet = addWorksheet(source, 'Preserved')
  setCell(sourceSheet, 1, 1, 'Original')
  const unknownPart = new TextEncoder().encode('<agent-extension keep="true"/>')
  source.passthrough = new Map([['customXml/item1.xml', unknownPart]])
  source.passthroughContentTypes = new Map([['customXml/item1.xml', 'application/xml']])
  await writeFile(xlsxPath, await workbookToBytes(source))
  const application = await electron.launch({ args: ['.', xlsxPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)
    const editor = window.locator('.aladdeen-xlsx-host')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await expect(editor.getByText(/Compatibility copy required to preserve custom XML/)).toBeVisible()
    await application.evaluate(({ dialog }, destination) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath: destination })
      })
    }, copyPath)

    await editor.getByRole('button', { name: /Save editable copy/ }).click()
    await expect(editor.getByText(/Compatibility features preserved in this editable copy/)).toBeVisible()
    await expect(access(copyPath)).resolves.toBeUndefined()

    const canvas = editor.locator('canvas[id^="univer-sheet-main-canvas_"]')
    await canvas.click({ position: { x: 85, y: 38 }, force: true })
    await window.keyboard.insertText('Copy edit')
    await window.keyboard.press('Enter')
    await expect.poll(async () => {
      const saved = await loadWorkbook(fromBuffer(await readFile(copyPath)))
      const sheet = saved.sheets.find((candidate) => candidate.kind === 'worksheet')
      return sheet?.kind === 'worksheet' ? getCell(sheet.sheet, 1, 1)?.value : undefined
    }, { timeout: 20_000 }).toBe('Copy edit')
    const preserved = await loadWorkbook(fromBuffer(await readFile(copyPath)))
    expect(preserved.passthrough?.get('customXml/item1.xml')).toEqual(unknownPart)
  } finally {
    await closeElectron(application)
    await Promise.all([
      rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ])
  }
})

test('opens, edits, autosaves, presents, and reopens a local PPTX without outbound requests', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-pptx-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-pptx-workspace-'))
  const pptxPath = join(workspace, 'briefing.pptx')
  const created = await PptxHandler.create({ title: 'Offline briefing', initialSlideCount: 1 })
  try {
    created.data.slides[0]!.elements.push(
      TextBuilder.create('Original briefing').position(120, 120).size(640, 100).build()
    )
    await writeFile(pptxPath, await created.handler.save(created.data.slides))
  } finally {
    created.handler.dispose()
  }
  let application = await electron.launch({ args: ['.', pptxPath, `--user-data-dir=${userData}`] })

  try {
    let window = await application.firstWindow()
    const outbound: string[] = []
    window.on('request', (request) => {
      if (/^https?:/i.test(request.url())) outbound.push(request.url())
    })
    await window.evaluate(() => {
      // Playwright's Electron window does not enter the OS fullscreen space;
      // exercise the viewer's supported presentation-mode fallback instead.
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        configurable: true,
        value: async () => { throw new DOMException('Fullscreen unavailable in the test window.') }
      })
    })
    await createFirstEnvironment(window)
    const editor = window.locator('.aladdeen-pptx-host')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    const textElement = editor.locator('.pptxv-stage [data-element-id][aria-label="Original briefing"]')
    await expect(textElement).toBeVisible({ timeout: 20_000 })
    await expect(editor.locator([
      '.pptxv-ai-toggle',
      '.pptxv-tabrow-share',
      '.pptxv-titlebar-autosave',
      '.pptxv-titlebar-status',
      '.pptxv-qat [aria-label="Save"]',
      '.pptxv-mobile-toolbar [aria-label="Save"]',
      '[aria-label="Settings & Shortcuts"]',
      '[data-pptx-collaboration]'
    ].join(', '))).toHaveCount(0)

    const commandSearch = editor.locator('.pptxv-titlebar-search')
    await expect(commandSearch).toBeVisible()
    expect((await commandSearch.boundingBox())?.width).toBeLessThanOrEqual(32)
    await expect(editor.getByRole('tab', { name: 'Insert', exact: true })).toBeVisible()
    await expect(editor.getByRole('tab', { name: 'Design', exact: true })).toBeVisible()
    await expect(editor.getByRole('tab', { name: 'Animations', exact: true })).toBeVisible()

    const ribbonTabs = [
      ['Insert', 'insert'],
      ['Draw', 'draw'],
      ['Design', 'design'],
      ['Transitions', 'transitions'],
      ['Animations', 'animations'],
      ['Slide Show', 'slide-show'],
      ['Review', 'review'],
      ['View', 'view']
    ] as const
    for (const [tabName, tabKey] of ribbonTabs) {
      await editor.getByRole('tab', { name: tabName, exact: true }).click()
      const ribbonContent = editor.locator('.pptxv-ribbon-tab-content:not([hidden])')
      await expect(ribbonContent).toHaveAttribute('data-aladdeen-ribbon-tab', tabKey)
      const layout = await ribbonContent.evaluate((root) => {
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
          .filter((button) => {
            const bounds = button.getBoundingClientRect()
            return bounds.width > 0 && bounds.height > 0
          })
          .map((button) => {
            const bounds = button.getBoundingClientRect()
            return {
              label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
              text: button.textContent?.trim() ?? '',
              clipped: button.scrollWidth > button.clientWidth + 1,
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom
            }
          })
        const overlaps: string[] = []
        for (let first = 0; first < buttons.length; first += 1) {
          for (let second = first + 1; second < buttons.length; second += 1) {
            const a = buttons[first]!
            const b = buttons[second]!
            const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (horizontal > 0.5 && vertical > 0.5) overlaps.push(`${a.label} / ${b.label}`)
          }
        }
        return {
          clipped: buttons.filter((button) => button.text && button.clipped).map((button) => button.label),
          overlaps,
          hiddenOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth)
        }
      })
      expect(layout.clipped, `${tabName} ribbon labels should fit their controls`).toEqual([])
      expect(layout.overlaps, `${tabName} ribbon controls should not overlap`).toEqual([])
      expect(
        layout.hiddenOverflowPx,
        `${tabName} ribbon should keep every control reachable without horizontal scrolling`
      ).toBeLessThanOrEqual(1)
    }
    await editor.getByRole('tab', { name: 'Home', exact: true }).click()

    const inspector = editor.locator('.pptxv-inspector')
    await expect(inspector).toBeHidden()
    await textElement.click()
    await editor.getByRole('button', { name: 'Toggle inspector panel' }).click()
    await expect(inspector).toBeVisible()
    const fillAndStroke = inspector.getByRole('button', { name: 'FILL & STROKE properties' })
    await expect(fillAndStroke).toHaveAttribute('aria-expanded', 'false')
    await fillAndStroke.click()
    await expect(fillAndStroke).toHaveAttribute('aria-expanded', 'true')
    await editor.getByRole('button', { name: 'Toggle inspector panel' }).click()
    await expect(inspector).toBeHidden()

    await textElement.dblclick()
    const inlineEditor = editor.locator('.pptxv-inline-editor')
    await expect(inlineEditor).toBeVisible()
    await expect(textElement.locator('.pptxv-text')).toHaveCSS('visibility', 'hidden')
    const elementBounds = await textElement.boundingBox()
    const editorBounds = await inlineEditor.boundingBox()
    expect(elementBounds).not.toBeNull()
    expect(editorBounds).not.toBeNull()
    expect(Math.abs(editorBounds!.x - elementBounds!.x)).toBeLessThan(2)
    expect(Math.abs(editorBounds!.y - elementBounds!.y)).toBeLessThan(2)
    await inlineEditor.press('ControlOrMeta+A')
    await window.keyboard.insertText('Updated briefing')
    await inlineEditor.press('Escape')

    const documentFooter = window.locator('footer').filter({ hasText: 'PPTX' })
    await expect(documentFooter).toContainText('Saved', { timeout: 20_000 })
    await expect.poll(async () => presentationTexts(pptxPath), { timeout: 20_000 }).toContain('Updated briefing')

    const present = editor.getByRole('button', { name: 'Present', exact: true })
    await expect(present).toBeVisible()
    await present.click()
    await expect(editor.locator('.pptxv.pptxv-presenting')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(editor.locator('.pptxv.pptxv-presenting')).toHaveCount(0)

    // Presenter view opens a scripted about:blank audience window (allowed by
    // the window-open policy) and overlays a compact control console.
    await editor.getByRole('tab', { name: 'Slide Show', exact: true }).click()
    await editor.getByRole('button', { name: 'Presenter view' }).click()
    const presenterConsole = editor.locator('.pptxv-presenter-console')
    await expect(presenterConsole).toBeVisible()
    const consoleBounds = await presenterConsole.boundingBox()
    const editorPaneBounds = await editor.boundingBox()
    expect(
      consoleBounds!.height,
      'presenter console should be a compact control bar, not a full-pane overlay'
    ).toBeLessThan(editorPaneBounds!.height / 4)
    await expect.poll(() => application.windows().length, { timeout: 10_000 }).toBe(2)
    await presenterConsole.getByRole('button', { name: 'End', exact: true }).click()
    await expect(editor.locator('.pptxv-presenter-console')).toHaveCount(0)
    await expect.poll(() => application.windows().length, { timeout: 10_000 }).toBe(1)

    // Parity dialogs mount on document.body, outside the viewer root that
    // carries the --pptx-* theme variables; the themed background must still
    // resolve there instead of rendering a transparent panel.
    await editor.getByRole('tab', { name: 'Slide Show', exact: true }).click()
    await editor.getByRole('button', { name: 'Set up slide show' }).click()
    const setupDialog = window.locator('.pptxv-parity-dialog')
    await expect(setupDialog).toBeVisible()
    const setupDialogBackground = await setupDialog.evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(
      setupDialogBackground,
      'Set Up Show dialog must have an opaque themed background'
    ).not.toBe('rgba(0, 0, 0, 0)')
    await setupDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(setupDialog).toBeHidden()
    expect(outbound).toEqual([])

    await closeElectron(application)
    application = await electron.launch({ args: ['.', pptxPath, `--user-data-dir=${userData}`] })
    window = await application.firstWindow()
    const reopened = window.locator('.aladdeen-pptx-host')
    await expect(reopened).toBeVisible({ timeout: 30_000 })
    await expect(reopened.locator('.pptxv-stage [data-element-id][aria-label="Updated briefing"]')).toBeVisible({ timeout: 20_000 })
  } finally {
    await closeElectron(application)
    await Promise.all([
      rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ])
  }
})

async function presentationTexts(path: string): Promise<string[]> {
  const bytes = await readFile(path)
  const handler = new PptxHandler()
  try {
    const presentation = await handler.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { allowExternalImages: false }
    )
    return presentation.slides.flatMap((slide) => slide.elements.flatMap((element) => (
      'text' in element && typeof element.text === 'string' ? [element.text] : []
    )))
  } finally {
    handler.dispose()
  }
}

test('opens, scrolls, edits, autosaves, and reopens a DOCX through Eigenpal', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-docx-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-docx-workspace-'))
  const docxPath = join(workspace, 'proposal.docx')
  const source = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Eigenpal integration', heading: HeadingLevel.HEADING_1 }),
        ...Array.from({ length: 180 }, (_, index) => new Paragraph({
          text: index === 0
            ? 'Editable proposal paragraph'
            : `Proposal detail ${index + 1} keeps the document long enough to test native scrolling.`
        }))
      ]
    }]
  })
  await writeFile(docxPath, await Packer.toBuffer(source))
  const original = await readFile(docxPath)
  let application = await electron.launch({ args: ['.', docxPath, `--user-data-dir=${userData}`] })

  try {
    let window = await application.firstWindow()
    await createFirstEnvironment(window)
    const editor = window.locator('.ep-root.docx-editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await expect(editor).toContainText('Eigenpal integration')
    await expect(editor.getByText('Save As')).toBeVisible()

    const scrollContainer = editor.locator('.docx-editor__scroll-container')
    await scrollContainer.hover()
    await window.mouse.wheel(0, 1_100)
    await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await scrollContainer.evaluate((element) => { element.scrollTop = 0 })

    const editableRun = editor.getByText('Editable proposal paragraph', { exact: true })
    await expect(editableRun).toBeVisible()
    await editableRun.click()
    await window.keyboard.press('End')
    await window.keyboard.insertText(' updated in Aladdeen')
    await window.keyboard.press('Tab')
    await expect(editor).toContainText('updated in Aladdeen')
    await expect(window.getByText('Editing', { exact: true }).first()).toBeVisible()
    const documentFooter = window.locator('footer').filter({ hasText: 'DOCX' })
    await expect(documentFooter).toContainText('Saved', { timeout: 15_000 })
    await expect.poll(async () => {
      const current = await readFile(docxPath)
      return current.equals(original)
    }, { timeout: 15_000 }).toBe(false)

    await application.close()
    application = await electron.launch({ args: ['.', docxPath, `--user-data-dir=${userData}`] })
    window = await application.firstWindow()
    const reopened = window.locator('.ep-root.docx-editor')
    await expect(reopened).toBeVisible({ timeout: 15_000 })
    await expect(reopened).toContainText('updated in Aladdeen')
  } finally {
    await closeElectron(application)
    await Promise.all([
      rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ])
  }
})

test('opens and renders a local PDF without outbound requests', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-pdf-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-pdf-workspace-'))
  const pdfPath = join(workspace, 'evidence.pdf')
  const source = await PDFDocument.create()
  const page = source.addPage([480, 320])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText('Local PDF evidence', { x: 48, y: 250, size: 22, font })
  await writeFile(pdfPath, await source.save())
  const application = await electron.launch({ args: ['.', pdfPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    const outbound: string[] = []
    window.on('request', (request) => {
      if (/^https?:/i.test(request.url())) outbound.push(request.url())
    })
    await createFirstEnvironment(window)
    const renderedPage = window.locator('.pdfViewer .page[data-page-number="1"]')
    await expect(renderedPage).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('Could not open this PDF')).toHaveCount(0)
    await expect(window.getByText('1 / 1', { exact: true })).toBeVisible()
    expect(outbound).toEqual([])
  } finally {
    await closeElectron(application)
    await Promise.all([
      rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    ])
  }
})

async function closeElectron(application: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  const closed = application.close().then(() => true).catch(() => false)
  if (await Promise.race([
    closed,
    new Promise<false>((resolveClose) => setTimeout(() => resolveClose(false), 2_000))
  ])) return
  const process = application.process()
  process.kill('SIGKILL')
  if (process.exitCode === null) {
    await new Promise<void>((resolveExit) => {
      process.once('exit', () => resolveExit())
    })
  }
}

test('opens and edits a dropped HTML document in place with contained local assets', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-html-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-html-workspace-'))
  const activePath = join(workspace, 'current.md')
  const htmlPath = join(workspace, 'field-notes.html')
  const imagePath = join(workspace, 'map.png')
  const originalHtml = `<!doctype html>
    <html><head><title>Field notes</title></head><body><main>
      <h1>Field notes</h1>
      <p>Opened directly and completely offline.</p>
      <img src="map.png" alt="Map">
    </main></body></html>`
  await writeFile(activePath, '# Current document\n', 'utf8')
  await writeFile(htmlPath, originalHtml, 'utf8')
  await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 48, g: 120, b: 214, alpha: 1 }
    }
  }).png().toFile(imagePath)
  const application = await electron.launch({ args: ['.', activePath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)
    await expect(window.getByRole('heading', { name: 'Current document' })).toBeVisible()
    await window.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'native-import-drop'
      input.hidden = true
      document.body.append(input)
    })
    await window.locator('#native-import-drop').setInputFiles(htmlPath)
    await window.evaluate(() => {
      const file = (document.querySelector<HTMLInputElement>('#native-import-drop'))?.files?.[0]
      if (!file) throw new Error('Test drop file was not attached.')
      const transfer = new DataTransfer()
      transfer.items.add(file)
      globalThis.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer }))
    })
    await expect(window.getByText('Open documents')).toBeVisible()
    await expect(window.getByText(/Original files stay in place/)).toBeVisible()
    await window.evaluate(() => {
      const file = (document.querySelector<HTMLInputElement>('#native-import-drop'))?.files?.[0]
      if (!file) throw new Error('Test drop file was not attached.')
      const transfer = new DataTransfer()
      transfer.items.add(file)
      globalThis.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }))
    })
    await expect(window.getByRole('tab', { name: /field-notes\.html/i })).toBeVisible()
    const preview = window.frameLocator('iframe[title="Preview of field-notes.html"]')
    await expect(preview.getByRole('heading', { name: 'Field notes' })).toBeVisible()
    await expect.poll(() => preview.locator('img').evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
    )).toBe(true)

    await window.getByRole('button', { name: 'Source' }).click()
    const editor = window.locator('.html-source-editor .cm-content')
    await editor.click()
    await window.keyboard.press('ControlOrMeta+A')
    await window.keyboard.insertText('<main><h1>Edited field notes</h1><p>Saved as HTML.</p></main>')
    await expect.poll(async () => readFile(htmlPath, 'utf8')).toContain('Edited field notes')
    await window.getByRole('button', { name: 'Preview' }).click()
    await expect(preview.getByRole('heading', { name: 'Edited field notes' })).toBeVisible()
    await expect(access(join(workspace, 'field-notes.md'))).rejects.toThrow()
    expect(await readFile(htmlPath, 'utf8')).not.toBe(originalHtml)
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})

test('onboards into a persistent environment', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Research stays on your Mac' })).toBeVisible()
    await expect(window.getByLabel('Step 1 of 4')).toBeVisible()

    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window).toHaveScreenshot('onboarding-1440-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: ONBOARDING_SCREENSHOT_MAX_DIFF_PIXEL_RATIO,
      threshold: 0.4
    })
    await window.setViewportSize({ width: 900, height: 700 })
    await expect(window).toHaveScreenshot('onboarding.png', {
      animations: 'disabled',
      maxDiffPixelRatio: ONBOARDING_SCREENSHOT_MAX_DIFF_PIXEL_RATIO,
      threshold: 0.4
    })
    await window.setViewportSize({ width: 640, height: 480 })
    await expect(window).toHaveScreenshot('onboarding-640-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: ONBOARDING_SCREENSHOT_MAX_DIFF_PIXEL_RATIO,
      threshold: 0.4
    })

    await window.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    for (const size of [
      { width: 1440, height: 900, name: 'onboarding-1440-dark.png' },
      { width: 900, height: 700, name: 'onboarding-900-dark.png' },
      { width: 640, height: 480, name: 'onboarding-640-dark.png' }
    ]) {
      await window.setViewportSize(size)
      await expect(window).toHaveScreenshot(size.name, {
        animations: 'disabled',
        maxDiffPixelRatio: ONBOARDING_SCREENSHOT_MAX_DIFF_PIXEL_RATIO,
        threshold: 0.4
      })
    }
    await window.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.dataset.theme = 'light'
    })
    await window.setViewportSize({ width: 640, height: 480 })

    await window.getByRole('button', { name: /Continue/ }).click()
    await expect(window.getByRole('heading', { name: 'Organize without moving anything' })).toBeVisible()
    await expect.poll(() => window.locator('.onboarding-scroll').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await window.getByRole('button', { name: /Continue/ }).click()
    await expect(window.getByRole('heading', { name: 'A workspace for every format' })).toBeVisible()
    await expect.poll(() => window.locator('.onboarding-scroll').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await window.getByRole('button', { name: /Continue/ }).click()
    await expect(window.getByRole('heading', { name: 'Find the passage, not just the file' })).toBeVisible()
    await expect.poll(() => window.locator('.onboarding-scroll').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await window.getByRole('button', { name: /Continue/ }).click()
    await expect(window.getByRole('heading', { name: 'Create your first environment' })).toBeVisible()
    await expect(window.getByLabel('Environment name')).toHaveValue('Personal')
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.getByRole('heading', { name: 'Your research, one calm workspace.' })).toBeVisible()
    await window.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(window.getByRole('button', { name: 'Switch environment' })).toContainText('Personal')
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('bulk-links a selectively indexed project and quick-opens files without filling recents', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-profile-'))
  const projectParent = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-library-'))
  const projectPath = join(projectParent, 'library')
  await mkdir(projectPath)
  await mkdir(join(projectPath, 'docs'))
  await mkdir(join(projectPath, 'archive'))
  await writeFile(join(projectPath, 'docs', 'guide.md'), '# Indexed guide\n', 'utf8')
  await writeFile(join(projectPath, 'archive', 'old.md'), '# Archived\n', 'utf8')
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await window.setViewportSize({ width: 685, height: 831 })
    await createFirstEnvironment(window)
    await application.evaluate(({ dialog }, folderPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [folderPath] })
      })
    }, projectPath)

    await window.keyboard.press('ControlOrMeta+Shift+O')
    await expect(window.getByRole('heading', { name: 'Add project folders' })).toBeVisible()
    await window.getByRole('button', { name: /Choose one or more folders/ }).click()
    await expect(window.getByRole('button', {
      name: new RegExp(`${basename(projectPath)}, 2 selected documents`, 'i')
    })).toBeVisible()
    const importDialog = window.locator('.project-import-dialog')
    const dialogLayout = await importDialog.evaluate((dialog) => {
      const candidateList = dialog.querySelector('.project-candidate-list')!.getBoundingClientRect()
      const scopeEditor = dialog.querySelector('.project-scope-editor')!.getBoundingClientRect()
      const bounds = dialog.getBoundingClientRect()
      return {
        width: bounds.width,
        fitsHorizontally: dialog.scrollWidth <= dialog.clientWidth,
        candidateAboveEditor: candidateList.bottom <= scopeEditor.top + 1
      }
    })
    expect(dialogLayout.width).toBeGreaterThan(640)
    expect(dialogLayout.fitsHorizontally).toBe(true)
    expect(dialogLayout.candidateAboveEditor).toBe(true)

    await window.setViewportSize({ width: 640, height: 480 })
    await expect(window.locator('.project-dialog-actions')).toBeInViewport()
    expect(await importDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
    })).toBe(true)
    await window.getByRole('radio', { name: /Selected folders and files/ }).click()
    await window.getByRole('checkbox', { name: 'Include docs' }).click()
    await window.getByRole('button', { name: 'Add 1 project' }).click()

    const projectRow = window.locator('.project-row').filter({ hasText: basename(projectPath) })
    await expect(projectRow).toContainText('1')
    await expect(window.locator('.tracked-file-row')).toHaveCount(0)

    await window.getByRole('button', { name: 'Show sidebar' }).click()
    const visibleProjectRow = window.locator('.project-row:visible').filter({ hasText: basename(projectPath) })
    await visibleProjectRow.hover()
    await visibleProjectRow.getByRole('button', { name: `Actions for ${basename(projectPath)}` }).click()
    await window.getByRole('menuitem', { name: 'Project settings' }).click()
    await expect(window.getByRole('heading', { name: 'Project settings' })).toBeVisible()
    await window.locator('.project-settings-context span').evaluate((location) => {
      location.textContent = '~/Research/library'
    })
    await window.locator('[data-sonner-toast]').evaluateAll((toasts) => toasts.forEach((toast) => toast.remove()))
    for (const size of [
      { width: 640, height: 480, name: '640' },
      { width: 900, height: 700, name: '900' },
      { width: 1440, height: 900, name: '1440' }
    ]) {
      await window.setViewportSize(size)
      await expect(window.locator('.project-dialog-actions')).toBeInViewport()
      await expect.poll(() => window.locator('.project-settings-body').evaluate(
        (body) => body.getBoundingClientRect().width
      )).toBeGreaterThan(Math.min(500, size.width - 100))
      await expect(window).toHaveScreenshot(`project-settings-${size.name}-light.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.01,
        threshold: 0.3
      })
    }
    await window.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    for (const size of [
      { width: 640, height: 480, name: '640' },
      { width: 900, height: 700, name: '900' },
      { width: 1440, height: 900, name: '1440' }
    ]) {
      await window.setViewportSize(size)
      await expect.poll(() => window.locator('.project-settings-body').evaluate(
        (body) => body.getBoundingClientRect().width
      )).toBeGreaterThan(Math.min(500, size.width - 100))
      await expect(window).toHaveScreenshot(`project-settings-${size.name}-dark.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.01,
        threshold: 0.3
      })
    }
    await window.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.dataset.theme = 'light'
    })
    await window.getByRole('button', { name: 'Close' }).click()

    await window.keyboard.press('ControlOrMeta+P')
    const quickOpen = window.getByPlaceholder('Search indexed documents…')
    await quickOpen.fill('guide')
    const guideResult = window.getByRole('option', { name: /guide\.md/ })
    await expect(guideResult).toContainText(`${basename(projectPath)} › docs/guide.md`)
    await guideResult.click()
    await expect(window.getByRole('heading', { name: 'Indexed guide' })).toBeVisible()
    await expect(window.locator('.tracked-file-row')).toHaveCount(1)

    await window.keyboard.press('ControlOrMeta+Shift+F')
    const contentSearch = window.getByRole('textbox', { name: 'Search document contents' })
    await expect(contentSearch).toBeVisible()
    await contentSearch.fill('Indexed guide')
    const contentMatch = window.getByRole('option', { name: /Indexed guide/ })
    await expect(contentMatch).toContainText('Indexed guide')
    await window.locator('[data-sonner-toast]').evaluateAll((toasts) => toasts.forEach((toast) => toast.remove()))
    await window.setViewportSize({ width: 640, height: 480 })
    await expect(window).toHaveScreenshot('global-search-640-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await window.setViewportSize({ width: 900, height: 700 })
    await expect(window).toHaveScreenshot('global-search-900-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window).toHaveScreenshot('global-search-1440-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await window.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.dataset.theme = 'dark'
    })
    await expect(window).toHaveScreenshot('global-search-1440-dark.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
    await contentMatch.click()
    await expect(window.locator('.cm-editor')).toBeVisible()
    await expect(window.locator('.cm-selectionBackground')).toBeVisible()
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(projectParent, { recursive: true, force: true })
    ])
  }
})

test('opens, previews, edits, and autosaves a Markdown file', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-workspace-'))
  const markdownPath = join(workspace, 'hello.md')
  const pdfPath = join(workspace, 'hello.pdf')
  const docxPath = join(workspace, 'hello.docx')
  await writeFile(markdownPath, '# Hello Aladdeen\n\n- [x] Preview works\n', 'utf8')
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await expect(window.getByText(/After setup, we’ll open/)).toBeVisible()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.getByRole('heading', { name: 'Hello Aladdeen' })).toBeVisible()
    await expect(window.getByRole('tab', { name: /hello\.md/i })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Individual files' })).toBeVisible()
    await expect(window.locator('.tracked-file-row')).toContainText('hello')
    await expect(window.locator('.tracked-file-copy strong')).toHaveText('hello')

    await window.keyboard.press('ControlOrMeta+Shift+F')
    await window.getByRole('button', { name: 'Entire environment' }).click()
    await window.getByRole('button', { name: 'Standalone files' }).click()
    await window.getByRole('textbox', { name: 'Search document contents' }).fill('Preview works')
    await expect(window.getByRole('option', { name: /Preview works/ })).toBeVisible()
    await window.keyboard.press('Escape')

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

    await window.locator('.preview-pane').getByText('Done.').click()
    await expect(window.locator('.cm-selectionBackground')).toBeVisible()
    expect(
      await window.evaluate(() => document.activeElement?.closest('.cm-editor') !== null)
    ).toBe(true)

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

test('flushes the latest edit before the application quits', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-close-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-close-file-'))
  const markdownPath = join(workspace, 'close-safe.md')
  await writeFile(markdownPath, '# Before\n', 'utf8')
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })
  let closed = false

  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)
    await window.getByRole('button', { name: 'Edit' }).click()
    const editor = window.locator('.cm-content')
    await editor.click()
    await window.keyboard.press('ControlOrMeta+A')
    await window.keyboard.insertText('# Saved during quit\n\nThe debounce must not lose this edit.')
    await application.close()
    closed = true
    await expect.poll(async () => readFile(markdownPath, 'utf8')).toContain('Saved during quit')
  } finally {
    if (!closed) await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})

test('keeps a long editor manually scrollable after preview-to-source navigation', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-scroll-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-scroll-workspace-'))
  const markdownPath = join(workspace, 'long-document.md')
  const paragraphs = Array.from(
    { length: 400 },
    (_, index) => `Paragraph ${index + 1} with unique navigation text ${index + 1}.`
  )
  await writeFile(markdownPath, ['# Long document', ...paragraphs].join('\n\n'), 'utf8')
  const application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)
    await expect(window.getByRole('heading', { name: 'Long document' })).toBeVisible()
    await window.getByRole('button', { name: 'Appearance' }).click()
    await window.getByRole('menuitem', { name: 'Dark' }).click()
    await window.getByRole('button', { name: 'Edit' }).click()

    const scroller = window.locator('.editor-pane .cm-scroller')
    await expect(window.locator('.editor-pane > .cm-theme')).toBeVisible()
    await expect.poll(() =>
      scroller.evaluate((element) => element.scrollHeight > element.clientHeight)
    ).toBe(true)
    await expect.poll(() => scroller.evaluate((element) => {
      const editorPane = element.closest<HTMLElement>('.editor-pane')
      const themeWrapper = element.parentElement?.parentElement
      return Boolean(
        editorPane &&
        themeWrapper &&
        Math.abs(themeWrapper.clientHeight - editorPane.clientHeight) <= 1 &&
        Math.abs(element.clientHeight - editorPane.clientHeight) <= 1
      )
    })).toBe(true)
    await expect(scroller).toHaveCSS('overflow-y', 'auto')
    const editorScrollbar = window.getByRole('scrollbar', { name: 'Editor scroll position' })
    await expect(editorScrollbar).toHaveAttribute('data-scrollable', 'true')
    await expect.poll(() => editorScrollbar.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return element.ownerDocument
        .elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 20)
        ?.closest('[data-panel-resize-handle-enabled]') === null
    })).toBe(true)

    const editorThumb = editorScrollbar.locator('.editor-scrollbar-thumb')
    const thumbBounds = await editorThumb.boundingBox()
    expect(thumbBounds).not.toBeNull()
    await scroller.evaluate((element) => { element.scrollTop = 0 })
    await window.mouse.move(
      thumbBounds!.x + thumbBounds!.width / 2,
      thumbBounds!.y + thumbBounds!.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(
      thumbBounds!.x + thumbBounds!.width / 2,
      thumbBounds!.y + thumbBounds!.height / 2 + 160,
      { steps: 8 }
    )
    await window.mouse.up()
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await scroller.evaluate((element) => { element.scrollTop = 0 })

    await scroller.hover()
    await window.mouse.wheel(0, 800)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    const previewTarget = window.locator('.preview-pane').getByText(paragraphs[349]!)
    await previewTarget.scrollIntoViewIfNeeded()
    await previewTarget.click()
    const revealedTop = await scroller.evaluate((element) => element.scrollTop)
    expect(revealedTop).toBeGreaterThan(0)

    // The reveal highlight and any unrelated renderer updates must not pull the
    // viewport back after the one-shot navigation command has been consumed.
    await window.waitForTimeout(1_000)
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(revealedTop)

    await scroller.hover()
    await window.mouse.wheel(0, -700)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(revealedTop)
    const manuallyScrolledTop = await scroller.evaluate((element) => element.scrollTop)

    await window.mouse.wheel(0, 900)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      manuallyScrolledTop
    )
  } finally {
    await application.close()
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true })
    ])
  }
})

test('restores tabs independently for each environment', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-environments-'))
  const folder = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-files-'))
  const markdownPath = join(folder, 'persistent.md')
  await writeFile(markdownPath, '# Persistent tab\n', 'utf8')
  let application = await electron.launch({ args: ['.', markdownPath, `--user-data-dir=${userData}`] })

  try {
    let window = await application.firstWindow()
    await createFirstEnvironment(window)
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
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-compact-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)

    for (const size of [{ width: 900, height: 700 }, { width: 640, height: 480 }]) {
      await window.setViewportSize(size)
      await window.getByRole('button', { name: 'Show sidebar' }).click()
      const sheet = window.getByRole('dialog', { name: 'Environment files' })
      await expect(sheet.locator('.sheet-panel')).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'New document' })).toBeVisible()
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
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-chrome-'))
  let application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    let window = await application.firstWindow()
    await createFirstEnvironment(window)
    await expect(window.locator('.topbar')).toHaveCount(0)
    await expect(window.locator('.sidebar')).toHaveCSS('width', '320px')

    const resizer = window.getByRole('separator', { name: 'Resize sidebar' })
    await resizer.focus()
    await resizer.press('ArrowRight')
    await expect(window.locator('.sidebar')).toHaveCSS('width', '336px')

    await window.getByRole('button', { name: 'Settings' }).click()
    const settings = window.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await settings.getByRole('tab', { name: 'Keyboard shortcuts' }).click()
    await expect(settings.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    await expect(settings.getByText('Quick open')).toBeVisible()
    await settings.getByRole('button', { name: 'Close settings' }).click()

    await window.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(window.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await expect.poll(async () => {
      const result = await window.evaluate(() => globalThis.window.aladdeen.settings.get())
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

test('renders responsive settings navigation in light and dark themes', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-settings-'))
  const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await application.firstWindow()
    await createFirstEnvironment(window)
    await window.getByRole('button', { name: 'Settings' }).click()
    const settings = window.getByRole('dialog', { name: 'Settings' })
    const categoryTabs = settings.getByRole('tablist', { name: 'Settings categories' })

    await expect(settings.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    await expect(settings.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expect(settings.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0)

    const viewports = [
      { width: 1440, height: 900 },
      { width: 900, height: 700 },
      { width: 640, height: 480 }
    ]

    for (const theme of ['light', 'dark'] as const) {
      await window.evaluate((nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark')
        document.documentElement.dataset.theme = nextTheme
      }, theme)

      for (const viewport of viewports) {
        await window.setViewportSize(viewport)
        await expect(categoryTabs).toHaveAttribute('aria-orientation', viewport.width <= 720 ? 'horizontal' : 'vertical')
        expect(await settings.evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect()
          return {
            fitsViewport:
              bounds.left >= 0 &&
              bounds.top >= 0 &&
              bounds.right <= innerWidth &&
              bounds.bottom <= innerHeight,
            clipsHorizontally: dialog.scrollWidth > dialog.clientWidth
          }
        })).toEqual({ fitsViewport: true, clipsHorizontally: false })
        await expect(window).toHaveScreenshot(`settings-${viewport.width}-${theme}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.01
        })
      }
    }

    await settings.getByRole('tab', { name: 'Reading' }).click()
    await expect(settings.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
      await window.evaluate((nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark')
        document.documentElement.dataset.theme = nextTheme
      }, theme)
      for (const viewport of viewports) {
        await window.setViewportSize(viewport)
        await expect(window).toHaveScreenshot(`reading-settings-${viewport.width}-${theme}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.01
        })
      }
    }

    const surfacePalettes = {
      light: [
        ['Default', 'rgb(255, 255, 255)', 'rgb(35, 35, 44)'],
        ['Paper', 'rgb(251, 248, 241)', 'rgb(48, 43, 36)'],
        ['Sage', 'rgb(243, 247, 242)', 'rgb(41, 49, 40)'],
        ['Slate', 'rgb(243, 245, 247)', 'rgb(37, 42, 49)']
      ],
      dark: [
        ['Default', 'rgb(37, 37, 41)', 'rgb(237, 237, 241)'],
        ['Paper', 'rgb(28, 25, 21)', 'rgb(237, 230, 218)'],
        ['Sage', 'rgb(23, 27, 24)', 'rgb(227, 234, 226)'],
        ['Slate', 'rgb(24, 27, 32)', 'rgb(230, 233, 238)']
      ]
    } as const
    const readingSample = settings.locator('.reading-settings-preview')
    for (const theme of ['light', 'dark'] as const) {
      await window.evaluate((nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark')
        document.documentElement.dataset.theme = nextTheme
      }, theme)
      for (const [surface, background, foreground] of surfacePalettes[theme]) {
        await settings.getByRole('button', { name: surface, exact: true }).click()
        await expect(readingSample).toHaveCSS('background-color', background)
        await expect(readingSample).toHaveCSS('color', foreground)
      }
    }

    await settings.getByRole('button', { name: /Iowan Made for long reading/ }).click()
    await settings.locator('input[type="range"]').fill('20')
    await settings.getByRole('button', { name: 'Sage' }).click()
    await expect(readingSample).toHaveAttribute('data-reading-font', 'iowan')
    await expect(readingSample).toHaveAttribute('data-reading-surface', 'sage')
    await expect(readingSample).toHaveCSS('font-size', '20px')
    await expect(readingSample).toHaveCSS('background-color', 'rgb(23, 27, 24)')
    await settings.getByRole('button', { name: 'Reset' }).click()

    await settings.getByRole('tab', { name: 'About' }).click()
    await expect(settings.getByRole('heading', { name: 'About' })).toBeVisible()
    await expect(settings.getByText(/original disk locations/i)).toBeVisible()
    const developerEmail = settings.getByRole('button', { name: /Email: ali@aliahad\.com/i })
    await developerEmail.scrollIntoViewIfNeeded()
    await expect(developerEmail).toBeInViewport()
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('renders extended Markdown safely and responsively', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-markdown-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-markdown-file-'))
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
    await createFirstEnvironment(window)

    await expect(window.getByRole('article', { name: 'Aladdeen Compatibility' })).toBeVisible()
    await expect(window.getByText('title: "Aladdeen Compatibility"')).toHaveCount(0)
    await expect(window.locator('.markdown-toc')).toHaveCount(1)
    await expect(window.locator('.markdown-callout')).toContainText('Local first')
    await expect(window.locator('dl')).toContainText('A definition with formatting.')
    await expect(window.locator('.katex')).toHaveCount(3)
    await expect(window.locator('section[data-footnotes]')).toContainText('Stored on disk.')
    await expect(window.locator('.markdown-body script')).toHaveCount(0)
    await expect(window.locator('.mermaid-svg svg')).toBeVisible({ timeout: 10_000 })
    expect(remoteRequests).toEqual([])
    await window.locator('.active-document-location, .tracked-file-copy small').evaluateAll((locations) => {
      locations.forEach((location) => {
        location.textContent = 'Local file'
      })
    })

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 900, height: 700 },
      { width: 640, height: 480 }
    ]) {
      await window.setViewportSize(viewport)
      await expect.poll(() => window.locator('.markdown-body').evaluate(
        (body) => body.getBoundingClientRect().width
      )).toBeGreaterThan(Math.min(500, viewport.width - 100))
      for (const theme of ['light', 'dark'] as const) {
        await window.evaluate((nextTheme) => {
          document.documentElement.classList.toggle('dark', nextTheme === 'dark')
          document.documentElement.dataset.theme = nextTheme
        }, theme)
        await expect(window).toHaveScreenshot(`markdown-${viewport.width}-${theme}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.01,
          // CoreText edge colors vary across macOS hosts; solid geometry still uses the strict 1% cap.
          threshold: 0.4
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
  const userData = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-export-profile-'))
  const workspace = await mkdtemp(join(tmpdir(), 'aladdeen-e2e-export-file-'))
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
    await createFirstEnvironment(window)
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

    expect(coreXml).toContain('Aladdeen Compatibility')
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
