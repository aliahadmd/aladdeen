import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable, Transform } from 'node:stream'
import type { AgentAuthScheme, AgentEndpointScope } from './contracts.js'

const REQUEST_BODY_LIMIT = 32 * 1024 * 1024
const RESPONSE_BODY_LIMIT = 64 * 1024 * 1024
const MAX_REDIRECTS = 3

const NON_PUBLIC_IPV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4')
const NON_PUBLIC_IPV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6')

function hostnameValue(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function isLoopback(address: string): boolean {
  const value = hostnameValue(address).toLowerCase()
  if (isIP(value) === 4) return value.startsWith('127.')
  return value === '::1' || value.startsWith('::ffff:127.')
}

function isPublic(address: string): boolean {
  const value = hostnameValue(address).toLowerCase()
  const family = isIP(value)
  if (family === 4) return !NON_PUBLIC_IPV4.check(value, 'ipv4')
  if (family !== 6 || !/^[23]/.test(value)) return false
  return !NON_PUBLIC_IPV6.check(value, 'ipv6')
}

async function pinnedAddress(
  url: URL,
  scope: AgentEndpointScope
): Promise<{ address: string; family: number }> {
  const hostname = hostnameValue(url.hostname).toLowerCase()
  if (scope === 'loopback') {
    if (hostname !== 'localhost' && !isLoopback(hostname)) {
      throw new Error('Local provider endpoints must remain on loopback.')
    }
    if (isIP(hostname)) return { address: hostname, family: isIP(hostname) }
    const records = await lookup(hostname, { all: true, verbatim: true })
    const record = records.find((candidate) => isLoopback(candidate.address))
    if (!record) throw new Error('The local provider hostname did not resolve to loopback.')
    return record
  }
  if (url.protocol !== 'https:') throw new Error('Public provider requests must use HTTPS.')
  if (hostname === 'localhost' || isIP(hostname) && !isPublic(hostname)) {
    throw new Error('Public provider requests cannot target private or reserved addresses.')
  }
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (!records.length || records.some((record) => !isPublic(record.address))) {
    throw new Error('The provider hostname resolved to a private or reserved address.')
  }
  return records[0]!
}

function normalizedBase(raw: string, scope: AgentEndpointScope): URL {
  const url = new URL(raw)
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Provider URLs cannot contain credentials, queries, or fragments.')
  }
  if (scope === 'public_https' && url.protocol !== 'https:') {
    throw new Error('Public provider endpoints must use HTTPS.')
  }
  if (scope === 'loopback' && !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Local provider endpoints must use HTTP or HTTPS.')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url
}

function requestHeaders(headers: Headers, authScheme: AgentAuthScheme): Headers {
  const result = new Headers(headers)
  if (authScheme === 'x-api-key') {
    const authorization = result.get('authorization')
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      result.set('x-api-key', authorization.slice('bearer '.length))
      result.delete('authorization')
    }
  } else if (authScheme === 'bearer') {
    const apiKey = result.get('x-api-key')
    if (apiKey && !result.has('authorization')) {
      result.set('authorization', `Bearer ${apiKey}`)
      result.delete('x-api-key')
    }
  } else if (authScheme === 'none') {
    result.delete('authorization')
    result.delete('x-api-key')
  }
  result.delete('proxy-authorization')
  result.delete('cookie')
  return result
}

function withinBase(target: URL, base: URL): boolean {
  if (target.origin !== base.origin) return false
  if (!base.pathname || base.pathname === '/') return true
  return target.pathname === base.pathname || target.pathname.startsWith(`${base.pathname}/`)
}

async function nodeFetch(
  request: Request,
  base: URL,
  scope: AgentEndpointScope,
  authScheme: AgentAuthScheme,
  redirectCount: number
): Promise<Response> {
  const url = new URL(request.url)
  if (!withinBase(url, base)) throw new Error('The provider request escaped its configured base URL.')
  const pinned = await pinnedAddress(url, scope)
  const headers = requestHeaders(request.headers, authScheme)
  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : Buffer.from(await request.arrayBuffer())
  if (body && body.byteLength > REQUEST_BODY_LIMIT) {
    throw new Error('The provider request exceeded Aladdeen’s request-size limit.')
  }

  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const nodeRequest = transport(url, {
      method,
      headers: Object.fromEntries(headers.entries()),
      signal: request.signal,
      servername: url.hostname,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }])
        } else {
          callback(null, pinned.address, pinned.family)
        }
      }
    }, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('The provider returned too many redirects.'))
          return
        }
        if (!['GET', 'HEAD'].includes(method)) {
          reject(new Error('Provider inference requests may not redirect.'))
          return
        }
        let redirected: URL
        try {
          redirected = new URL(location, url)
        } catch {
          reject(new Error('The provider returned an invalid redirect.'))
          return
        }
        if (!withinBase(redirected, base) || redirected.origin !== url.origin) {
          reject(new Error('The provider redirect left its configured origin.'))
          return
        }
        void nodeFetch(
          new Request(redirected, { method, headers, signal: request.signal }),
          base,
          scope,
          authScheme,
          redirectCount + 1
        ).then(resolve, reject)
        return
      }
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(response.headers)) {
        if (/set-cookie|www-authenticate|proxy-authenticate|authorization|api.?key|token|secret/iu.test(key)) {
          continue
        }
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(key, item)
        } else if (value !== undefined) {
          responseHeaders.set(key, String(value))
        }
      }
      if (status >= 400) {
        response.resume()
        responseHeaders.set('content-type', 'application/json')
        resolve(new Response(JSON.stringify({
          error: { message: `Provider request failed with HTTP ${status}.` }
        }), {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders
        }))
        return
      }
      let responseBytes = 0
      const boundedResponse = response.pipe(new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          responseBytes += chunk.byteLength
          if (responseBytes > RESPONSE_BODY_LIMIT) {
            callback(new Error('The provider response exceeded Aladdeen’s response-size limit.'))
            return
          }
          callback(null, chunk)
        }
      }))
      resolve(new Response(Readable.toWeb(boundedResponse) as ReadableStream, {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders
      }))
    })
    nodeRequest.setTimeout(120_000, () => {
      nodeRequest.destroy(new Error('The provider request timed out.'))
    })
    nodeRequest.on('error', reject)
    if (body) nodeRequest.end(body)
    else nodeRequest.end()
  })
}

export function createGuardedFetch(
  baseUrl: string,
  scope: AgentEndpointScope,
  authScheme: AgentAuthScheme
): typeof globalThis.fetch {
  const base = normalizedBase(baseUrl, scope)
  return async (input, init) => {
    const request = new Request(input, {
      ...init,
      redirect: 'manual'
    })
    return nodeFetch(request, base, scope, authScheme, 0)
  }
}
