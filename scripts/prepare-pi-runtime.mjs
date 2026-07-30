import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { log } from 'node:console'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repositoryRoot, 'node_modules', '@earendil-works', 'pi-coding-agent')
const stagingRoot = join(repositoryRoot, 'release-staging', 'pi-runtime')
const stagedPackage = join(stagingRoot, 'node_modules', '@earendil-works', 'pi-coding-agent')
const packageMetadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

if (packageMetadata.version !== '0.83.0') {
  throw new Error(`Expected pi coding agent 0.83.0, found ${String(packageMetadata.version)}.`)
}

await rm(stagingRoot, { recursive: true, force: true })
await mkdir(stagingRoot, { recursive: true })
await cp(join(packageRoot, 'npm-shrinkwrap.json'), join(stagingRoot, 'npm-shrinkwrap.json'))
await writeFile(
  join(stagingRoot, 'package.json'),
  `${JSON.stringify({
    name: '@earendil-works/pi-coding-agent',
    version: packageMetadata.version,
    private: true,
    dependencies: packageMetadata.dependencies,
    optionalDependencies: packageMetadata.optionalDependencies
  }, null, 2)}\n`
)

const install = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['ci', '--omit=dev', '--no-audit', '--no-fund'],
  { cwd: stagingRoot, encoding: 'utf8', stdio: 'inherit' }
)
if (install.status !== 0) {
  throw new Error(`npm ci for the pi runtime exited with status ${String(install.status)}.`)
}

await mkdir(stagedPackage, { recursive: true })
await cp(join(packageRoot, 'dist'), join(stagedPackage, 'dist'), { recursive: true })
await cp(join(packageRoot, 'package.json'), join(stagedPackage, 'package.json'))
await cp(join(packageRoot, 'npm-shrinkwrap.json'), join(stagedPackage, 'npm-shrinkwrap.json'))

log(`Prepared pi coding agent ${packageMetadata.version} in ${stagingRoot}`)
