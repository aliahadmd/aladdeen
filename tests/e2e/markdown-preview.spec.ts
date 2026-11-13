import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'

const wideGraph = `flowchart LR
accTitle: Research workflow
accDescr: The harness connects user requests, context, execution, permissions and tools.
A[User prompt: investigate the evidence] --> B[AI Harness]
B --> C[Context and Memory Manager]
C -->|Prompt, history and tool schemas| D[LLM: Stateless Brain]
D -->|Text or tool call request| E[Execution Loop and Limits]
E -->|Verify safety| F[Permissions and Sandbox]
F -->|Execute| G[Tools: Files, Terminal, MCP]
G -->|Observation: stdout, stderr and file contents| C
C -->|Final verified answer| A`

test('inspects Markdown diagrams, images, tables, code and math without losing the reading position', async () => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'aladdeen-preview-'))
  const filePath = join(root, 'inspection.md')
  const columns = Array.from({ length: 10 }, (_, index) => `Column_${index}_with_a_long_unbroken_identifier`)
  const table = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n${Array.from({ length: 30 }, (_, row) => `| ${columns.map((_, column) => `Row ${row + 1}, column ${column + 1}`).join(' | ')} |`).join('\n')}`
  const source = `# Inspection\n\n## A wide diagram\n\n\`\`\`mermaid\n${wideGraph}\n\`\`\`\n\n## Repeated diagram\n\n\`\`\`mermaid\n${wideGraph}\n\`\`\`\n\n## Outline map\n\n\`\`\`markdown\n# Research\n- Evidence\n  - Sources\n  - Interviews\n- Findings\n\`\`\`\n\n## Wide table\n\n${table}\n\n## Code\n\n\`\`\`js\nconst raw = "${'long-value-'.repeat(40)}";\n\`\`\`\n\n## Figure\n\n![Research figure](figure.png)\n\n## Equation\n\n$$\n${Array.from({ length: 40 }, (_, index) => `x_{${index}}^{2}`).join(' + ')} = y\n$$\n`
  await writeFile(filePath, source)
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#48718c' } }).png().toFile(join(root, 'figure.png'))
  const app = await electron.launch({ args: ['.', filePath, `--user-data-dir=${join(root, 'profile')}`] })
  try {
    const window = await app.firstWindow()
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await window.getByRole('button', { name: 'Create environment' }).click()
    await expect(window.locator('.mermaid-diagram[data-mermaid-state="ready"]')).toHaveCount(2)
    const ids = await window.locator('.mermaid-svg [id]').evaluateAll((elements) => elements.map((element) => element.id))
    expect(new Set(ids).size).toBe(ids.length)

    const trigger = window.getByRole('button', { name: 'Expand diagram', exact: true }).first()
    await trigger.scrollIntoViewIfNeeded()
    const scroll = await window.locator('.preview-scroll').evaluate((element) => element.scrollTop)
    await trigger.focus()
    await window.keyboard.press('Enter')
    let dialog = window.getByRole('dialog', { name: 'Research workflow' })
    await expect(dialog).toBeVisible()
    const canvas = dialog.locator('[data-preview-canvas]')
    await expect(canvas).toBeFocused()
    await expect(dialog.getByLabel('Zoom level')).toHaveText('100%')
    await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await canvas.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    const bounds = (await canvas.boundingBox())!
    await canvas.evaluate((element) => { element.scrollLeft = 200 })
    const pointBefore = await canvas.evaluate((element) => {
      const visual = element.querySelector<HTMLElement>('.preview-visual')!
      const scale = new DOMMatrix(getComputedStyle(visual).transform).a
      return (element.scrollLeft + 200 - visual.offsetLeft) / scale
    })
    await window.mouse.move(bounds.x + 200, bounds.y + bounds.height / 2)
    await window.mouse.wheel(0, -120)
    await expect(dialog.getByLabel('Zoom level')).toHaveText('125%')
    const pointAfter = await canvas.evaluate((element) => {
      const visual = element.querySelector<HTMLElement>('.preview-visual')!
      return (element.scrollLeft + 200 - visual.offsetLeft) / new DOMMatrix(getComputedStyle(visual).transform).a
    })
    expect(Math.abs(pointBefore - pointAfter)).toBeLessThan(1)
    await window.screenshot({ path: test.info().outputPath('diagram-expanded.png') })
    const beforePan = await canvas.evaluate((element) => element.scrollLeft)
    await dialog.getByRole('button', { name: 'Pan right', exact: true }).click()
    expect(await canvas.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforePan)
    const beforeDrag = await canvas.evaluate((element) => element.scrollLeft)
    await window.mouse.move(bounds.x + 300, bounds.y + bounds.height / 2)
    await window.mouse.down()
    await window.mouse.move(bounds.x + 220, bounds.y + bounds.height / 2, { steps: 4 })
    await window.mouse.up()
    expect(await canvas.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforeDrag)
    await dialog.getByRole('button', { name: 'Fit', exact: true }).click()
    expect(Number((await dialog.getByLabel('Zoom level').innerText()).replace('%', ''))).toBeLessThan(100)
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    await canvas.focus()
    await window.keyboard.press('+')
    await expect(dialog.getByLabel('Zoom level')).toHaveText('125%')
    await window.keyboard.press('1')
    await expect(dialog.getByLabel('Zoom level')).toHaveText('100%')
    await dialog.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(dialog.locator('.preview-source')).toContainText('Permissions and Sandbox')
    await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
    await canvas.focus()
    for (let index = 0; index < 15; index += 1) {
      await window.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await window.keyboard.press('ControlOrMeta+P')
    await expect(window.getByRole('textbox', { name: 'Search indexed documents' })).toHaveCount(0)
    await window.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    expect(await window.locator('.preview-scroll').evaluate((element) => element.scrollTop)).toBe(scroll)

    await window.getByRole('button', { name: 'Expand mindmap' }).click()
    dialog = window.getByRole('dialog', { name: 'Mindmap', exact: true })
    await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await window.keyboard.press('Escape')
    const svgFile = join(root, 'mindmap.svg')
    await app.evaluate(({ session }, destination) => {
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(destination))
    }, svgFile)
    await window.getByRole('button', { name: 'Download the mindmap as SVG' }).click()
    await expect.poll(() => readFile(svgFile, 'utf8').catch(() => '')).toContain('<svg')
    const exportedSvg = await readFile(svgFile, 'utf8')
    expect(exportedSvg).toMatch(/stroke="rgb\(/)
    expect(exportedSvg).toContain('font-family=')

    await window.getByRole('button', { name: 'Expand table' }).click()
    dialog = window.getByRole('dialog', { name: 'Table', exact: true })
    await expect(dialog.getByRole('columnheader').first()).toBeVisible()
    const headerTop = await dialog.getByRole('columnheader').first().evaluate((element) => element.getBoundingClientRect().top)
    await dialog.locator('[data-preview-scroll]').evaluate((element) => { element.scrollTop = 300 })
    expect(await dialog.getByRole('columnheader').first().evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(headerTop, 0)
    await window.screenshot({ path: test.info().outputPath('table-expanded.png') })
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Expand code block' }).click()
    dialog = window.getByRole('dialog', { name: 'js code', exact: true })
    await dialog.getByRole('button', { name: 'Wrap', exact: true }).click()
    await expect(dialog.locator('pre')).toHaveCSS('white-space', 'pre-wrap')
    await window.screenshot({ path: test.info().outputPath('code-expanded.png') })
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Expand image: Research figure' }).click()
    dialog = window.getByRole('dialog', { name: 'Research figure', exact: true })
    await expect(dialog.getByRole('img', { name: 'Research figure' })).toBeVisible()
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Expand equation', exact: true }).click()
    dialog = window.getByRole('dialog', { name: 'Equation', exact: true })
    await expect(dialog.locator('math')).toHaveCount(1)
    await expect(dialog.locator('[data-preview-canvas]')).toBeFocused()
    await expect(dialog).toHaveJSProperty('scrollTop', 0)
    await window.screenshot({ path: test.info().outputPath('equation-expanded.png') })
    await dialog.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(dialog.locator('.preview-source')).toContainText('x_{39}')
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await window.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Dark', exact: true }).click()
    await window.keyboard.press('Escape')
    await window.setViewportSize({ width: 700, height: 600 })
    await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await expect(window.locator('.mermaid-diagram[data-mermaid-state="ready"]')).toHaveCount(2)
    await trigger.click()
    dialog = window.getByRole('dialog', { name: 'Research workflow' })
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await window.screenshot({ path: test.info().outputPath('diagram-compact-dark.png') })
    await window.keyboard.press('Escape')
    expect(await readFile(filePath, 'utf8')).toBe(source)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
