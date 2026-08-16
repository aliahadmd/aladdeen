/* global console */
import { Buffer } from 'node:buffer'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
const appPath = process.env.ALADDEEN_PACKAGED_APP_PATH
  ? resolve(process.env.ALADDEEN_PACKAGED_APP_PATH)
  : join(
      repositoryRoot,
      'release',
      packageMetadata.version,
      'mac-arm64',
      'Aladdeen.app'
    )
const contentsPath = join(appPath, 'Contents')
const executablePath = join(contentsPath, 'MacOS', 'Aladdeen')

await access(executablePath)

const auditRoot = await mkdtemp(join(tmpdir(), 'aladdeen-packaged-smoke-'))
const userDataPath = join(auditRoot, 'profile')
const workspacePath = join(auditRoot, 'workspace')
await Promise.all([mkdir(userDataPath), mkdir(workspacePath)])

const pdfPath = join(workspacePath, 'packaged-evidence.pdf')
const htmlPath = join(workspacePath, 'packaged-assets.html')
const imagePath = join(workspacePath, 'pixel.png')
const pdf = await PDFDocument.create()
const pdfPage = pdf.addPage([480, 320])
const pdfFont = await pdf.embedFont(StandardFonts.Helvetica)
pdfPage.drawText('Packaged PDF evidence', { x: 48, y: 250, size: 22, font: pdfFont })
await Promise.all([
  writeFile(pdfPath, await pdf.save()),
  writeFile(
    htmlPath,
    '<!doctype html><html><body><h1>Packaged local asset</h1><img src="pixel.png" alt="Local asset"></body></html>',
    'utf8'
  ),
  writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
])

let application
const rendererErrors = []
try {
  application = await electron.launch({
    executablePath,
    args: [pdfPath, `--user-data-dir=${userDataPath}`]
  })
  let window = await application.firstWindow()
  captureRendererErrors(window, rendererErrors)

  const runtime = await application.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData')
  }))
  if (!runtime.isPackaged) throw new Error('The packaged smoke test launched an unpackaged Electron app.')
  if (await realpath(runtime.userDataPath) !== await realpath(userDataPath)) {
    throw new Error(`The packaged app ignored the isolated profile: ${runtime.userDataPath}`)
  }

  await window.getByRole('button', { name: 'Skip tutorial' }).waitFor({
    state: 'visible',
    timeout: 15_000
  })
  await window.getByRole('button', { name: 'Skip tutorial' }).click()
  await window.getByRole('button', { name: 'Create environment' }).click()
  const renderedPdfPage = window.locator('.pdfViewer .page[data-page-number="1"]')
  await renderedPdfPage.waitFor({ state: 'visible', timeout: 30_000 })
  if (await window.getByText('Could not open this PDF').count()) {
    throw new Error(`The packaged PDF viewer failed: ${(await window.locator('body').innerText()).slice(0, 1_500)}`)
  }

  await closeApplication(application)
  application = await electron.launch({
    executablePath,
    args: [htmlPath, `--user-data-dir=${userDataPath}`]
  })
  window = await application.firstWindow()
  captureRendererErrors(window, rendererErrors)
  const preview = window.frameLocator('iframe[title="Preview of packaged-assets.html"]')
  await preview.getByRole('heading', { name: 'Packaged local asset' }).waitFor({
    state: 'visible',
    timeout: 20_000
  })
  const imageLoaded = await preview.locator('img').evaluate((image) => (
    image.complete && image.naturalWidth === 1
  ))
  if (!imageLoaded) throw new Error('The packaged local-asset protocol did not load the HTML image.')

  await closeApplication(application)
  application = undefined

  if (rendererErrors.length) {
    throw new Error(`The packaged renderer reported errors:\n${rendererErrors.join('\n')}`)
  }

  console.log(JSON.stringify({
    appPath,
    pdf: 'pass',
    localAsset: 'pass'
  }, null, 2))
} finally {
  if (application) await closeApplication(application)
  await rm(auditRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function captureRendererErrors(window, errors) {
  window.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
}

async function closeApplication(target) {
  const closed = target.close().then(() => true).catch(() => false)
  if (await Promise.race([
    closed,
    new Promise((resolveClose) => setTimeout(() => resolveClose(false), 5_000))
  ])) return
  const child = target.process()
  child.kill('SIGKILL')
  if (child.exitCode === null) {
    await new Promise((resolveExit) => child.once('exit', resolveExit))
  }
}
