#!/usr/bin/env node
/* global console, process */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXPECTED_PACKAGE = '@eigenpal/docx-editor-react'
const EXPECTED_VERSION = '1.9.0'

const fail = (message) => {
  console.error(`DOCX editor dependency check failed: ${message}`)
  process.exit(1)
}

const packagePath = resolve(
  process.cwd(),
  'node_modules',
  '@eigenpal',
  'docx-editor-react',
  'package.json'
)

let metadata
try {
  metadata = JSON.parse(await readFile(packagePath, 'utf8'))
} catch {
  fail(`${EXPECTED_PACKAGE} is not installed.`)
}

if (metadata.name !== EXPECTED_PACKAGE) {
  fail(`expected ${EXPECTED_PACKAGE}, received ${String(metadata.name)}.`)
}
if (metadata.version !== EXPECTED_VERSION) {
  fail(`expected the audited ${EXPECTED_VERSION} release, received ${String(metadata.version)}.`)
}
if (metadata.license !== 'Apache-2.0') {
  fail(`expected Apache-2.0 licensing, received ${String(metadata.license)}.`)
}
for (const subpath of ['.', './plugin-api', './styles.css']) {
  if (!metadata.exports?.[subpath]) fail(`the ${subpath} export is unavailable.`)
}

const typePath = resolve(packagePath, '..', metadata.types ?? 'dist/index.d.ts')
const typeSource = await readFile(typePath, 'utf8').catch(() => '')
if (!typeSource.includes('DocxEditor') || !typeSource.includes('DocxEditorRef')) {
  fail('the installed package does not expose the expected React editor API.')
}

const lockfile = await readFile(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8')
if (/(^|\n)\s{2,}superdoc(?:@|:)/.test(lockfile)) {
  fail('SuperDoc is still present in pnpm-lock.yaml.')
}
if (lockfile.includes('@docx-editor.dev/react')) {
  fail('the placeholder @docx-editor.dev/react namespace must not be packaged.')
}

console.log(`${EXPECTED_PACKAGE}@${EXPECTED_VERSION} is ready for proprietary Aladdeen packaging under Apache-2.0.`)
