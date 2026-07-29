#!/usr/bin/env node
/* global console, process */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXPECTED = new Map([
  ['@office-kit/xlsx', { version: '0.9.0', licenses: ['MIT'] }],
  ['@univerjs/core', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-core', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-filter', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-sort', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-find-replace', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-data-validation', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-conditional-formatting', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['@univerjs/preset-sheets-hyper-link', { version: '0.25.1', licenses: ['Apache-2.0'] }],
  ['rxjs', { version: '7.8.2', licenses: ['Apache-2.0'] }]
])

const fail = (message) => {
  console.error(`Spreadsheet dependency check failed: ${message}`)
  process.exit(1)
}

const root = process.cwd()
const application = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
for (const dependency of Object.keys(application.dependencies ?? {})) {
  if (dependency.startsWith('@univerjs-pro/')) fail(`${dependency} is a Pro dependency.`)
  if (dependency === '@univerjs/presets') {
    fail('@univerjs/presets pulls Pro presets into the production graph; use the local OSS bootstrap.')
  }
}

for (const [name, expectation] of EXPECTED) {
  const declaredVersion = application.dependencies?.[name]
  if (declaredVersion !== expectation.version) {
    fail(`${name} must be exact-pinned to ${expectation.version}; received ${String(declaredVersion)}.`)
  }
  let metadata
  try {
    metadata = JSON.parse(await readFile(resolve(root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
  } catch {
    fail(`${name} is not installed.`)
  }
  if (metadata.version !== expectation.version) {
    fail(`${name} resolved to ${String(metadata.version)} instead of ${expectation.version}.`)
  }
  if (!expectation.licenses.includes(metadata.license)) {
    fail(`${name} has non-approved license ${String(metadata.license)}.`)
  }
}

const lockfile = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')
if (lockfile.includes('@univerjs-pro/')) fail('pnpm-lock.yaml contains Univer Pro packages.')
if (lockfile.includes('@univerjs/presets')) fail('pnpm-lock.yaml contains the all-in-one preset package.')

const runtimeSources = await Promise.all([
  'src/renderer/src/document-adapters/XlsxDocument.tsx',
  'src/renderer/src/document-adapters/univer-bootstrap.ts',
  'src/renderer/src/document-adapters/xlsx-codec.worker.ts'
].map((path) => readFile(resolve(root, path), 'utf8')))
if (runtimeSources.some((source) => /(?:unpkg\.com|jsdelivr\.net|esm\.sh|cdnjs\.cloudflare\.com)/i.test(source))) {
  fail('spreadsheet runtime source contains a CDN dependency.')
}

console.log('Offline spreadsheet dependencies are exact-pinned, permissively licensed, and free of Univer Pro/CDN code.')
