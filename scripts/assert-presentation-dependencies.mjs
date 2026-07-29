#!/usr/bin/env node
/* global console, process */

import { Buffer } from 'node:buffer'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { TextEncoder } from 'node:util'
import { unzipSync, zipSync } from 'fflate'
import { PptxHandler, TextBuilder } from 'pptx-viewer-core'

const EXPECTED = new Map([
  ['pptx-vanilla-viewer', { version: '1.7.0', licenses: ['Apache-2.0'] }],
  ['pptx-viewer-core', { version: '2.0.7', licenses: ['Apache-2.0'] }],
  ['pptx-viewer-mcp', { version: '2.0.2', licenses: ['Apache-2.0'] }],
  ['three', { version: '0.185.1', licenses: ['MIT'] }]
])
const APPROVED_LICENSES = ['Apache-2.0', 'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0']

const fail = (message) => {
  console.error(`Presentation dependency check failed: ${message}`)
  process.exit(1)
}

const root = process.cwd()
const application = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
for (const [name, expectation] of EXPECTED) {
  const declaredVersion = application.dependencies?.[name]
  if (declaredVersion !== expectation.version) {
    fail(`${name} must be exact-pinned to ${expectation.version}; received ${String(declaredVersion)}.`)
  }
  const metadata = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'))
  if (metadata.version !== expectation.version) {
    fail(`${name} resolved to ${String(metadata.version)} instead of ${expectation.version}.`)
  }
  if (!expectation.licenses.includes(metadata.license)) {
    fail(`${name} has non-approved license ${String(metadata.license)}.`)
  }
}

const checkedPackages = new Set()
const checkDependencyLicenses = async (packageJsonPath) => {
  const canonicalPath = await realpath(packageJsonPath)
  const metadata = JSON.parse(await readFile(canonicalPath, 'utf8'))
  const identity = `${metadata.name}@${metadata.version}:${canonicalPath}`
  if (checkedPackages.has(identity)) return
  checkedPackages.add(identity)
  const declaredLicense = typeof metadata.license === 'string' ? metadata.license : ''
  if (!APPROVED_LICENSES.some((license) => declaredLicense.includes(license))) {
    fail(`${metadata.name}@${metadata.version} has non-approved license ${declaredLicense || '(missing)'}.`)
  }
  const packageDirectory = dirname(canonicalPath)
  const dependencies = {
    ...metadata.dependencies,
    ...metadata.optionalDependencies
  }
  for (const dependency of Object.keys(dependencies)) {
    const dependencyMetadata = resolve(packageDirectory, '..', dependency, 'package.json')
    try {
      await checkDependencyLicenses(dependencyMetadata)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}
for (const name of EXPECTED.keys()) {
  await checkDependencyLicenses(resolve(root, 'node_modules', name, 'package.json'))
}

const lockfile = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')
for (const forbidden of ['@univerjs-pro/', 'onlyoffice', 'pptist']) {
  if (lockfile.toLowerCase().includes(forbidden)) fail(`pnpm-lock.yaml contains forbidden package ${forbidden}.`)
}

const runtimeSources = await Promise.all([
  'src/renderer/src/document-adapters/PptxDocument.tsx',
  'src/renderer/src/document-adapters/presentation-api.ts'
].map((path) => readFile(resolve(root, path), 'utf8')))
if (runtimeSources.some((source) => /https?:\/\//i.test(source))) {
  fail('presentation runtime source contains a remote URL.')
}
const adapterSource = runtimeSources[0]
if (
  /\bai\s*:/u.test(adapterSource) ||
  /startCollaboration\s*\(/u.test(adapterSource) ||
  runtimeSources.some((source) => /from\s+['"][^'"]*(?:\/ai(?:\/|['"])|collaboration)[^'"]*['"]/iu.test(source))
) {
  fail('presentation runtime enables the viewer AI or collaboration surface.')
}
for (const required of [
  'autosave: false',
  'smartArt3D: false',
  "'file'",
  "'share'",
  "'broadcast'",
  "'export'",
  "'record'",
  "'.pptxv-titlebar-autosave'",
  "'.pptxv-qat [aria-label=\"Save\"]'",
  "'[aria-label=\"Settings & Shortcuts\"]'"
]) {
  if (!adapterSource.includes(required)) fail(`presentation runtime policy is missing ${required}.`)
}

const created = await PptxHandler.create({ title: 'Aladdeen qualification', initialSlideCount: 1 })
let initialBytes
try {
  created.data.slides[0].elements.push(
    TextBuilder.create('Qualification text').position(96, 96).size(640, 80).build()
  )
  initialBytes = await created.handler.save(created.data.slides)
} finally {
  created.handler.dispose()
}

const unknownPayload = new TextEncoder().encode('aladdeen-pptx-unknown-part-v1')
const injectedArchive = unzipSync(initialBytes)
injectedArchive['customXml/aladdeen-qualification.bin'] = unknownPayload
const injectedBytes = zipSync(injectedArchive)
const reopened = new PptxHandler()
try {
  const data = await reopened.load(
    injectedBytes.buffer.slice(injectedBytes.byteOffset, injectedBytes.byteOffset + injectedBytes.byteLength),
    { allowExternalImages: false, maxUncompressedBytes: 512 * 1024 * 1024 }
  )
  const textElement = data.slides[0]?.elements.find((element) => 'text' in element && element.text === 'Qualification text')
  if (!textElement || !('text' in textElement)) fail('the qualification text did not reopen.')
  textElement.text = 'Qualification edited'
  const saved = await reopened.save(data.slides)
  const savedArchive = unzipSync(saved)
  const retained = savedArchive['customXml/aladdeen-qualification.bin']
  if (!retained || !Buffer.from(retained).equals(Buffer.from(unknownPayload))) {
    fail('an untouched unknown OOXML part was not preserved byte-for-byte.')
  }
  const verified = new PptxHandler()
  try {
    const roundTrip = await verified.load(
      saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength),
      { allowExternalImages: false, maxUncompressedBytes: 512 * 1024 * 1024 }
    )
    if (!roundTrip.slides[0]?.elements.some((element) => 'text' in element && element.text === 'Qualification edited')) {
      fail('an edited text element did not survive save and reopen.')
    }
  } finally {
    verified.dispose()
  }
} finally {
  reopened.dispose()
}

console.log('Offline PPTX dependencies are exact-pinned and the editable round-trip/preservation qualification passed.')
