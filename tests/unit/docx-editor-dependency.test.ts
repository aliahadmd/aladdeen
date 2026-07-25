import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('Eigenpal DOCX editor dependency', () => {
  it('pins the functional Apache-2.0 React release', async () => {
    const packageJson = JSON.parse(await readFile(
      resolve(root, 'node_modules/@eigenpal/docx-editor-react/package.json'),
      'utf8'
    )) as {
      name?: string
      version?: string
      license?: string
      exports?: Record<string, unknown>
    }

    expect(packageJson).toMatchObject({
      name: '@eigenpal/docx-editor-react',
      version: '1.9.0',
      license: 'Apache-2.0'
    })
    expect(packageJson.exports).toHaveProperty('.')
    expect(packageJson.exports).toHaveProperty('./plugin-api')
    expect(packageJson.exports).toHaveProperty('./styles.css')
  })

  it('contains no SuperDoc or placeholder namespace dependency', async () => {
    const lockfile = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')
    expect(lockfile.toLowerCase()).not.toContain('superdoc')
    expect(lockfile).not.toContain('@docx-editor.dev/react')
  })

  it('ships the required attribution notice', async () => {
    const notice = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notice).toContain('@eigenpal/docx-editor-react')
    expect(notice).toContain('Apache License 2.0')
    expect(notice).toContain('1.9.0')
  })
})
