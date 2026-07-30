import { fork } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stagedRoot = join(repositoryRoot, 'release-staging', 'pi-runtime')
const runtimeRoot = process.env.ALADDEEN_SMOKE_RUNTIME_PATH
  ? resolve(process.env.ALADDEEN_SMOKE_RUNTIME_PATH)
  : await access(join(stagedRoot, 'node_modules', '@earendil-works', 'pi-coding-agent'))
    .then(() => stagedRoot)
    .catch(() => repositoryRoot)
const workerPath = process.env.ALADDEEN_SMOKE_WORKER_PATH
  ? resolve(process.env.ALADDEEN_SMOKE_WORKER_PATH)
  : join(repositoryRoot, 'out', 'worker', 'agent-worker', 'index.js')

const packageVersion = async (name) => {
  const metadata = JSON.parse(await readFile(join(runtimeRoot, 'node_modules', '@earendil-works', name, 'package.json'), 'utf8'))
  return metadata.version
}
const [codingAgentVersion, aiVersion] = await Promise.all([
  packageVersion('pi-coding-agent'),
  packageVersion('pi-ai')
])
if (codingAgentVersion !== '0.83.0' || aiVersion !== '0.83.0') {
  throw new Error(`Pi runtime is not pinned to 0.83.0 (coding-agent=${codingAgentVersion}, ai=${aiVersion}).`)
}

const child = fork(workerPath, [], {
  cwd: repositoryRoot,
  silent: true,
  env: {
    ...process.env,
    ALADDEEN_PI_RUNTIME_ROOT: runtimeRoot,
    ALADDEEN_AGENT_WORKER_OPTIONS: JSON.stringify({ mode: 'capabilities' })
  }
})
let stdout = ''
let stderr = ''
let capabilities
child.stdout?.on('data', (chunk) => {
  stdout += String(chunk)
})
child.stderr?.on('data', (chunk) => {
  stderr += String(chunk)
})
child.on('message', (message) => {
  if (message?.channel === 'models-store') {
    child.send({
      channel: 'models-store-response',
      requestId: message.requestId,
      ok: true
    })
    return
  }
  if (message?.channel === 'credential') {
    child.send({
      channel: 'credential-response',
      requestId: message.requestId,
      ok: true,
      ...(message.operation === 'list' ? { value: [] } : {})
    })
    return
  }
  if (message?.channel === 'auth' && message.type === 'capabilities') capabilities = message
})

const exitCode = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error('The staged pi worker smoke test timed out.'))
  }, 15_000)
  child.once('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  child.once('exit', (code) => {
    clearTimeout(timeout)
    resolveExit(code)
  })
})
if (exitCode !== 0) throw new Error(`The staged pi worker exited with code ${String(exitCode)}: ${stderr}`)
if (stdout !== '') throw new Error(`The pi worker wrote outside the JSONL protocol: ${stdout.slice(0, 500)}`)
if (!capabilities?.providers?.some((provider) => provider.provider === 'openai-codex' && provider.oauthAvailable)) {
  throw new Error('The pinned pi worker did not expose OpenAI Codex OAuth.')
}
if (!capabilities.providers.some((provider) => provider.provider === 'kimi-coding' && provider.oauthAvailable)) {
  throw new Error('The pinned pi worker did not expose Kimi Code OAuth.')
}
if (!capabilities.providers.some((provider) => (
  provider.provider === 'openai-codex' &&
  provider.models.some((model) => model.id === 'gpt-5.5' && model.name && typeof model.supportsThinking === 'boolean')
))) {
  throw new Error('The pinned pi worker did not expose the Codex default model gpt-5.5.')
}
if (!capabilities.providers.some((provider) => (
  provider.provider === 'kimi-coding' &&
  provider.models.some((model) => model.id === 'kimi-for-coding')
))) {
  throw new Error('The pinned pi worker did not expose the Kimi default model.')
}
if (!capabilities.providers.some((provider) => (
  provider.provider === 'deepseek' &&
  provider.apiKeyAvailable &&
  provider.models.every((model) => model.provider === 'deepseek')
))) {
  throw new Error('The pinned pi worker did not expose the native DeepSeek provider.')
}
if (!capabilities.providers.some((provider) => (
  provider.provider === 'openrouter' &&
  provider.oauthAvailable &&
  provider.apiKeyAvailable &&
  provider.dynamicCatalog
))) {
  throw new Error('The pinned pi worker did not expose native OpenRouter capabilities.')
}

const smokeDirectory = await mkdtemp(join(tmpdir(), 'aladdeen-pi-worker-'))
const agentDirectory = join(smokeDirectory, 'agent')
const sessionDirectory = join(smokeDirectory, 'sessions')
const sessionChild = fork(workerPath, [], {
  cwd: repositoryRoot,
  silent: true,
  env: {
    ...process.env,
    ALADDEEN_PI_RUNTIME_ROOT: runtimeRoot,
    ALADDEEN_AGENT_WORKER_OPTIONS: JSON.stringify({
      mode: 'session',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      thinkingLevel: 'medium',
      cwd: repositoryRoot,
      sessionDirectory,
      agentDirectory,
      approvalExtensionPath: join(repositoryRoot, 'resources', 'pi', 'aladdeen-approvals.ts')
    })
  }
})
let sessionLineBuffer = ''
let sessionStderr = ''
sessionChild.stderr?.on('data', (chunk) => {
  sessionStderr += String(chunk)
})
sessionChild.on('message', (message) => {
  if (message?.channel === 'models-store') {
    sessionChild.send({
      channel: 'models-store-response',
      requestId: message.requestId,
      ok: true
    })
    return
  }
  if (message?.channel !== 'credential') return
  const configured = message.providerId === 'anthropic'
  sessionChild.send({
    channel: 'credential-response',
    requestId: message.requestId,
    ok: true,
    ...(message.operation === 'list'
      ? { value: [{ providerId: 'anthropic', type: 'api_key' }] }
      : message.operation === 'read' && configured
        ? { value: { type: 'api_key', key: 'smoke-test-not-a-real-key' } }
        : {})
  })
})

const stateResponse = new Promise((resolveState, reject) => {
  const timeout = setTimeout(() => {
    sessionChild.kill('SIGKILL')
    reject(new Error(`The pi session worker did not answer get_state: ${sessionStderr}`))
  }, 15_000)
  sessionChild.stdout?.on('data', (chunk) => {
    const text = String(chunk)
    sessionLineBuffer += text
    const lines = sessionLineBuffer.split('\n')
    sessionLineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        clearTimeout(timeout)
        reject(new Error(`The pi session worker broke JSONL framing: ${line.slice(0, 500)}`))
        return
      }
      if (record.type === 'response' && record.id === 'smoke-state') {
        clearTimeout(timeout)
        resolveState(record)
        return
      }
    }
  })
  sessionChild.once('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
})
sessionChild.stdin?.write(`${JSON.stringify({ type: 'get_state', id: 'smoke-state' })}\n`)
await stateResponse
sessionChild.kill('SIGTERM')
await new Promise((resolveExit) => sessionChild.once('exit', resolveExit))
if (sessionLineBuffer.trim()) {
  throw new Error(`The pi session worker left a non-JSONL stdout fragment: ${sessionLineBuffer.slice(0, 500)}`)
}

const agentFiles = await readdir(agentDirectory, { recursive: true }).catch(() => [])
if (agentFiles.some((file) => (
  file === 'auth.json' ||
  file.endsWith('/auth.json') ||
  file === 'models.json' ||
  file.endsWith('/models.json')
))) {
  throw new Error('The embedded pi worker created a plaintext auth.json or models.json.')
}
await rm(smokeDirectory, { recursive: true, force: true })
