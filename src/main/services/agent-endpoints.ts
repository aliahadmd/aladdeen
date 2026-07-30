import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { DesktopError } from '@main/errors'
import type { AgentEndpointScope } from '@shared/contracts'

export type AgentDnsLookup = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>

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

function normalizedHostname(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

export function isLoopbackAddress(address: string): boolean {
  const value = normalizedHostname(address).toLowerCase()
  if (isIP(value) === 4) return value.startsWith('127.')
  return value === '::1' || value.startsWith('::ffff:127.')
}

export function isPublicAgentAddress(address: string): boolean {
  const value = normalizedHostname(address).toLowerCase()
  const family = isIP(value)
  if (family === 4) return !NON_PUBLIC_IPV4.check(value, 'ipv4')
  if (family !== 6 || !/^[23]/.test(value)) return false
  return !NON_PUBLIC_IPV6.check(value, 'ipv6')
}

export function normalizeAgentBaseUrl(rawUrl: string, scope: AgentEndpointScope): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new DesktopError('INVALID_PATH', 'Enter a valid provider base URL.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DesktopError(
      'INVALID_PATH',
      'Provider URLs cannot contain credentials, query parameters, or fragments.'
    )
  }
  if (scope === 'public_https' && url.protocol !== 'https:') {
    throw new DesktopError('INVALID_PATH', 'Public provider endpoints must use HTTPS.')
  }
  if (scope === 'loopback' && !['http:', 'https:'].includes(url.protocol)) {
    throw new DesktopError('INVALID_PATH', 'Local provider endpoints must use HTTP or HTTPS.')
  }
  if (!url.hostname || url.port && (!/^\d+$/.test(url.port) || Number(url.port) > 65_535)) {
    throw new DesktopError('INVALID_PATH', 'The provider URL contains an invalid host or port.')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

export async function validateAgentEndpoint(
  rawUrl: string,
  scope: AgentEndpointScope,
  lookup: AgentDnsLookup = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true })
): Promise<{ normalizedUrl: string; addresses: string[] }> {
  const normalizedUrl = normalizeAgentBaseUrl(rawUrl, scope)
  const url = new URL(normalizedUrl)
  const hostname = normalizedHostname(url.hostname).toLowerCase()
  if (scope === 'loopback') {
    if (hostname === 'localhost' || isLoopbackAddress(hostname)) {
      return { normalizedUrl, addresses: hostname === 'localhost' ? ['127.0.0.1', '::1'] : [hostname] }
    }
    throw new DesktopError('PERMISSION_DENIED', 'Local provider endpoints must use a loopback address.')
  }
  if (hostname === 'localhost' || isIP(hostname) && !isPublicAgentAddress(hostname)) {
    throw new DesktopError('PERMISSION_DENIED', 'Public provider endpoints cannot target a private or reserved address.')
  }
  let records: Array<{ address: string; family: number }>
  try {
    records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname)
  } catch {
    throw new DesktopError('NOT_FOUND', 'The provider hostname could not be resolved.')
  }
  const addresses = [...new Set(records.map((record) => record.address))]
  if (!addresses.length || addresses.some((address) => !isPublicAgentAddress(address))) {
    throw new DesktopError(
      'PERMISSION_DENIED',
      'The provider hostname resolves to a private or reserved address.'
    )
  }
  return { normalizedUrl, addresses }
}
