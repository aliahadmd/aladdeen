import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
const dmgPath = join(
  repositoryRoot,
  'release',
  packageMetadata.version,
  `Aladdeen-${packageMetadata.version}-arm64.dmg`
)

let device
try {
  const attached = await execFileAsync('hdiutil', ['attach', '-readonly', '-nobrowse', dmgPath], {
    maxBuffer: 1024 * 1024
  })
  const mounted = attached.stdout
    .split('\n')
    .map((line) => line.split(/\t+/).map((field) => field.trim()).filter(Boolean))
    .find((fields) => fields.at(-1)?.startsWith('/Volumes/'))
  if (!mounted?.[0] || !mounted.at(-1)) {
    throw new Error(`The packaged DMG did not report a mounted application volume:\n${attached.stdout}`)
  }
  device = mounted[0].replace(/s\d+$/u, '')
  const mountPoint = mounted.at(-1)
  const smoke = await execFileAsync(process.execPath, [join(repositoryRoot, 'scripts', 'smoke-packaged-app.mjs')], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ALADDEEN_PACKAGED_APP_PATH: join(mountPoint, 'Aladdeen.app')
    },
    maxBuffer: 10 * 1024 * 1024
  })
  process.stdout.write(smoke.stdout)
  process.stderr.write(smoke.stderr)
} finally {
  if (device) {
    await execFileAsync('hdiutil', ['detach', device], { maxBuffer: 1024 * 1024 })
  }
}
