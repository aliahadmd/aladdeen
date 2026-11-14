import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('keeps sidebar actions compact and routes open/create actions to the right destination', async () => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'liresearch-sidebar-actions-'))
  const project = join(root, 'Research')
  const looseFile = join(root, 'reference.md')
  await mkdir(join(project, 'sources'), { recursive: true })
  await writeFile(join(project, 'sources', 'evidence.md'), '# Evidence\n')
  await writeFile(looseFile, '# Independent reference\n')
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, 'profile')}`] })
  try {
    const window = await app.firstWindow()
    await window.getByRole('button', { name: 'Skip tutorial' }).click()
    await window.getByRole('button', { name: 'Create environment' }).click()
    const sidebar = window.locator('aside.sidebar:visible')
    const actions = sidebar.getByRole('group', { name: 'Workspace actions' })
    await expect(actions.getByRole('button')).toHaveCount(2)
    expect((await actions.boundingBox())!.height).toBeLessThanOrEqual(44)

    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [path] }) })
    }, project)
    await actions.getByRole('button', { name: 'Open', exact: true }).click()
    await window.getByRole('menuitem', { name: 'Add folder…', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Add project folders' })).toBeVisible()
    await window.getByRole('button', { name: /Choose one or more folders/ }).click()
    await window.getByRole('button', { name: 'Add 1 project', exact: true }).click()

    await sidebar.locator('.project-row').filter({ hasText: 'Research' }).getByRole('button').first().click()
    await sidebar.getByRole('button', { name: 'sources', exact: true }).click()
    const create = actions.getByRole('button', { name: 'New', exact: true })
    await create.focus()
    await window.keyboard.press('Enter')
    await expect(window.getByText('In Research / sources', { exact: true })).toBeVisible()
    await expect(window.getByRole('menuitem', { name: 'Word document', exact: true })).toHaveCount(0)
    await window.getByRole('menuitem', { name: 'Markdown', exact: true }).click()
    await expect(window.getByRole('dialog', { name: 'New Markdown document' })).toContainText('Create inside Research / sources')
    await window.getByPlaceholder('Document name', { exact: true }).fill('Findings')
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => readFile(join(project, 'sources', 'Findings.md'), 'utf8').catch(() => null)).not.toBeNull()

    await create.click()
    await window.getByRole('menuitem', { name: 'New subfolder…', exact: true }).click()
    await window.getByPlaceholder('Folder name', { exact: true }).fill('Interviews')
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => stat(join(project, 'sources', 'Interviews')).then((entry) => entry.isDirectory()).catch(() => false)).toBe(true)

    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [path] }) })
    }, root)
    await create.click()
    await window.getByRole('menuitem', { name: 'New project folder…', exact: true }).click()
    await window.getByPlaceholder('Folder name', { exact: true }).fill('New project')
    await window.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => stat(join(root, 'New project')).then((entry) => entry.isDirectory()).catch(() => false)).toBe(true)
    await expect(sidebar.locator('.project-row')).toHaveCount(2)

    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [path] }) })
    }, looseFile)
    await actions.getByRole('button', { name: 'Open', exact: true }).click()
    await window.getByRole('menuitem', { name: 'Open file…', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Independent reference' })).toBeVisible()
    await expect(sidebar.locator('.project-row')).toHaveCount(2)
    await sidebar.getByRole('button', { name: 'Add folder', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Add project folders' })).toBeVisible()
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await window.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Dark', exact: true }).click()
    await window.keyboard.press('Escape')
    await window.setViewportSize({ width: 1000, height: 700 })
    await window.mouse.move(950, 650)
    await expect.poll(() => actions.getByRole('button', { name: 'Open', exact: true }).evaluate((element) =>
      ['rgb(176, 176, 186)', 'rgb(237, 237, 241)'].includes(getComputedStyle(element).color)
    )).toBe(true)
    await expect(sidebar.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    const library = sidebar.locator('[data-radix-scroll-area-viewport]')
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollLeft === 0)).toBe(true)
    const bounds = (await sidebar.boundingBox())!
    await window.screenshot({ path: test.info().outputPath('sidebar-compact-actions-dark.png'), animations: 'disabled', clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: 410 } })
    await actions.getByRole('button', { name: 'Open', exact: true }).focus()
    await window.keyboard.press('Enter')
    await expect(window.getByRole('menuitem', { name: 'Add folder…', exact: true })).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(actions.getByRole('button', { name: 'Open', exact: true })).toBeFocused()

    await window.getByRole('separator', { name: 'Resize sidebar', exact: true }).focus()
    await window.keyboard.press('Home')
    expect(await actions.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollLeft === 0)).toBe(true)
    await create.click()
    await expect(window.getByRole('menuitem', { name: 'Markdown', exact: true })).toBeVisible()
    await window.keyboard.press('Escape')

    for (const size of [{ width: 900, height: 700 }, { width: 640, height: 480 }]) {
      await window.setViewportSize(size)
      await window.getByRole('button', { name: 'Show sidebar' }).click()
      const sheet = window.getByRole('dialog', { name: 'Environment files', exact: true })
      const compactActions = sheet.getByRole('group', { name: 'Workspace actions' })
      await expect(compactActions.getByRole('button')).toHaveCount(2)
      await compactActions.getByRole('button', { name: 'New', exact: true }).click()
      const menu = window.getByRole('menu')
      expect(await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      })).toBe(true)
      await window.keyboard.press('Escape')
      await sheet.getByRole('button', { name: 'Close sidebar' }).last().click()
    }
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
