// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isLoopbackAddress,
  isPublicAgentAddress,
  normalizeAgentBaseUrl,
  validateAgentEndpoint
} from '@main/services/agent-endpoints'
import { discoverCustomModels } from '../../src/agent-worker/custom-provider'
import { createGuardedFetch } from '../../src/agent-worker/endpoint-security'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('custom provider endpoint security', () => {
  it('rejects credentials, query strings, fragments, and non-HTTPS public endpoints', () => {
    expect(() => normalizeAgentBaseUrl(
      'https://user:password@api.example.com/v1',
      'public_https'
    )).toThrow(/credentials/i)
    expect(() => normalizeAgentBaseUrl(
      'https://api.example.com/v1?api_key=secret',
      'public_https'
    )).toThrow(/query/i)
    expect(() => normalizeAgentBaseUrl(
      'https://api.example.com/v1#fragment',
      'public_https'
    )).toThrow(/fragment/i)
    expect(() => normalizeAgentBaseUrl(
      'http://api.example.com/v1',
      'public_https'
    )).toThrow(/HTTPS/i)
  })

  it('allows only public DNS results for public endpoints', async () => {
    await expect(validateAgentEndpoint(
      'https://api.example.com/v1',
      'public_https',
      async () => [{ address: '93.184.216.34', family: 4 }]
    )).resolves.toEqual({
      normalizedUrl: 'https://api.example.com/v1',
      addresses: ['93.184.216.34']
    })
    await expect(validateAgentEndpoint(
      'https://api.example.com/v1',
      'public_https',
      async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 }
      ]
    )).rejects.toThrow(/private or reserved/i)
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '224.0.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2001:db8::1',
      '3fff::1'
    ]) expect(isPublicAgentAddress(address)).toBe(false)
    expect(isPublicAgentAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('allows HTTP only for exact loopback destinations', async () => {
    await expect(validateAgentEndpoint(
      'http://localhost:11434/v1/',
      'loopback'
    )).resolves.toMatchObject({ normalizedUrl: 'http://localhost:11434/v1' })
    await expect(validateAgentEndpoint(
      'http://127.0.0.1:8000/v1',
      'loopback'
    )).resolves.toMatchObject({ addresses: ['127.0.0.1'] })
    await expect(validateAgentEndpoint(
      'http://192.168.1.20:8000/v1',
      'loopback'
    )).rejects.toThrow(/loopback/i)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
  })

  it('pins loopback requests, translates x-api-key auth, strips ambient headers, and rejects redirect escape', async () => {
    const observed: Array<Record<string, string | string[] | undefined>> = []
    const server = createServer((request, response) => {
      observed.push(request.headers)
      if (request.url === '/v1/redirect') {
        response.writeHead(302, { location: '/private' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    const guardedFetch = createGuardedFetch(baseUrl, 'loopback', 'x-api-key')
    const response = await guardedFetch(`${baseUrl}/models`, {
      headers: {
        authorization: 'Bearer encrypted-credential',
        cookie: 'must-not-cross',
        'proxy-authorization': 'must-not-cross'
      }
    })
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ ok: true })
    expect(observed[0]).toMatchObject({ 'x-api-key': 'encrypted-credential' })
    expect(observed[0]?.authorization).toBeUndefined()
    expect(observed[0]?.cookie).toBeUndefined()
    expect(observed[0]?.['proxy-authorization']).toBeUndefined()

    await expect(guardedFetch(`${baseUrl}/redirect`)).rejects.toThrow(/configured origin/i)
  })

  it('sanitizes and deduplicates compatible /models responses conservatively', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        data: [
          { id: 'coder-1', name: 'Coder One', context_window: 999_999 },
          { id: 'coder-1', name: 'Duplicate' },
          { id: '', name: 'Missing ID' },
          { id: 'coder-2' }
        ]
      }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    const models = await discoverCustomModels({
      id: 'custom:00000000-0000-4000-8000-000000000000',
      name: 'Local compatible',
      protocol: 'openai-completions',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      endpointScope: 'loopback',
      authScheme: 'none',
      catalogMode: 'remote',
      compatibility: {},
      models: []
    }, undefined)

    expect(models).toEqual([
      expect.objectContaining({
        id: 'coder-1',
        name: 'Coder One',
        supportsThinking: false,
        supportsVision: false,
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        verified: false
      }),
      expect.objectContaining({ id: 'coder-2', name: 'coder-2' })
    ])
  })
})
