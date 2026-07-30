import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Api,
  AuthInteraction,
  Model,
  Provider,
  ProviderStreams,
  SimpleStreamOptions
} from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type {
  AgentApiProtocol,
  AgentWorkerModel,
  AgentWorkerProviderProfile
} from './contracts.js'
import { createGuardedFetch } from './endpoint-security.js'

const MODEL_CATALOG_LIMIT = 2 * 1024 * 1024
const MODEL_COUNT_LIMIT = 2_000

type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiModelRuntime = Awaited<ReturnType<typeof ModelRuntime.create>>

function moduleUrl(runtimeRoot: string, ...segments: string[]): string {
  return pathToFileURL(join(runtimeRoot, 'node_modules', '@earendil-works', 'pi-ai', 'dist', ...segments)).href
}

async function loadPiAi(runtimeRoot: string): Promise<PiAiModule> {
  return import(moduleUrl(runtimeRoot, 'index.js')) as Promise<PiAiModule>
}

async function loadStreams(
  runtimeRoot: string,
  protocol: AgentApiProtocol
): Promise<ProviderStreams> {
  if (protocol === 'openai-completions') {
    const api = await import(moduleUrl(runtimeRoot, 'api', 'openai-completions.lazy.js')) as {
      openAICompletionsApi(): ProviderStreams
    }
    return api.openAICompletionsApi()
  }
  if (protocol === 'openai-responses') {
    const api = await import(moduleUrl(runtimeRoot, 'api', 'openai-responses.lazy.js')) as {
      openAIResponsesApi(): ProviderStreams
    }
    return api.openAIResponsesApi()
  }
  const api = await import(moduleUrl(runtimeRoot, 'api', 'anthropic-messages.lazy.js')) as {
    anthropicMessagesApi(): ProviderStreams
  }
  return api.anthropicMessagesApi()
}

function securedStreams(
  streams: ProviderStreams,
  guardedFetch: typeof globalThis.fetch
): ProviderStreams {
  return {
    stream(model, context, options) {
      return streams.stream(model, context, { ...options, fetch: guardedFetch })
    },
    streamSimple(model, context, options?: SimpleStreamOptions) {
      return streams.streamSimple(model, context, { ...options, fetch: guardedFetch })
    }
  }
}

function configuredModel(
  profile: AgentWorkerProviderProfile,
  model: AgentWorkerModel
): Model<Api> {
  return {
    id: model.id,
    name: model.name || model.id,
    api: profile.protocol,
    provider: profile.id,
    baseUrl: profile.baseUrl,
    reasoning: model.supportsThinking,
    input: model.supportsVision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxOutputTokens ?? 16_384,
    compat: profile.compatibility
  } as Model<Api>
}

function authForProfile(profile: AgentWorkerProviderProfile): Provider<Api>['auth'] {
  return {
    apiKey: {
      name: `${profile.name} API key`,
      ...(profile.authScheme === 'none'
        ? {}
        : {
            async login(interaction: AuthInteraction) {
              return {
                type: 'api_key' as const,
                key: await interaction.prompt({
                  type: 'secret',
                  message: `Enter the API key for ${profile.name}`
                })
              }
            }
          }),
      async check({ credential }) {
        if (profile.authScheme === 'none') return { type: 'api_key' as const, source: 'Local endpoint' }
        return credential?.key ? { type: 'api_key' as const, source: 'Encrypted API key' } : undefined
      },
      async resolve({ credential }) {
        if (profile.authScheme === 'none') {
          return { auth: { apiKey: 'local-endpoint' }, source: 'Local endpoint' }
        }
        return credential?.key
          ? { auth: { apiKey: credential.key }, source: 'Encrypted API key' }
          : undefined
      }
    }
  }
}

function authHeaders(
  profile: AgentWorkerProviderProfile,
  credential: { type: string; key?: string } | undefined
): Headers {
  const headers = new Headers({ accept: 'application/json' })
  if (!credential?.key || profile.authScheme === 'none') return headers
  if (profile.authScheme === 'x-api-key') headers.set('x-api-key', credential.key)
  else headers.set('authorization', `Bearer ${credential.key}`)
  return headers
}

function modelsEndpoint(profile: AgentWorkerProviderProfile): URL {
  const base = new URL(profile.baseUrl.endsWith('/') ? profile.baseUrl : `${profile.baseUrl}/`)
  return new URL('models', base)
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MODEL_CATALOG_LIMIT) {
    throw new Error('The provider model catalog exceeded the 2 MiB limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > MODEL_CATALOG_LIMIT) {
      await reader.cancel()
      throw new Error('The provider model catalog exceeded the 2 MiB limit.')
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function catalogEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) return data
  }
  throw new Error('The provider returned an unsupported model-catalog format.')
}

function sanitizeDiscoveredModels(
  profile: AgentWorkerProviderProfile,
  value: unknown
): AgentWorkerModel[] {
  const entries = catalogEntries(value)
  if (entries.length > MODEL_COUNT_LIMIT) {
    throw new Error('The provider returned more than 2,000 models.')
  }
  const seen = new Set<string>()
  const result: AgentWorkerModel[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || id.length > 200 || seen.has(id)) continue
    seen.add(id)
    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim().slice(0, 300)
      : id
    result.push({
      provider: profile.id,
      id,
      name,
      supportsThinking: false,
      protocol: profile.protocol,
      supportsVision: false,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'discovered',
      verified: false
    })
  }
  return result
}

export async function discoverCustomModels(
  profile: AgentWorkerProviderProfile,
  credential: { type: string; key?: string } | undefined
): Promise<AgentWorkerModel[]> {
  if (profile.protocol === 'anthropic-messages' || profile.catalogMode !== 'remote') {
    return profile.models
  }
  const guardedFetch = createGuardedFetch(
    profile.baseUrl,
    profile.endpointScope,
    profile.authScheme
  )
  const response = await guardedFetch(modelsEndpoint(profile), {
    method: 'GET',
    headers: authHeaders(profile, credential),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Model discovery failed with HTTP ${response.status}.`)
  return sanitizeDiscoveredModels(profile, await readBoundedJson(response))
}

export async function registerCustomProvider(
  runtime: PiModelRuntime,
  profile: AgentWorkerProviderProfile,
  runtimeRoot: string
): Promise<void> {
  const ai = await loadPiAi(runtimeRoot)
  const guardedFetch = createGuardedFetch(
    profile.baseUrl,
    profile.endpointScope,
    profile.authScheme
  )
  const streams = securedStreams(await loadStreams(runtimeRoot, profile.protocol), guardedFetch)
  const provider = ai.createProvider({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    auth: authForProfile(profile),
    models: profile.models.map((model) => configuredModel(profile, model)),
    ...(profile.catalogMode === 'remote' && profile.protocol !== 'anthropic-messages'
      ? {
          fetchModels: async ({ credential }) => (
            await discoverCustomModels(profile, credential)
          ).map((model) => configuredModel(profile, model))
        }
      : {}),
    api: streams
  })
  runtime.registerNativeProvider(provider)
}
