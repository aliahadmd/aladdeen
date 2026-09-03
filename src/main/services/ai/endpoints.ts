import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { DesktopError } from '@main/errors'

export type AiDnsLookup = (
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

export function isPublicAddress(address: string): boolean {
  const value = normalizedHostname(address).toLowerCase()
  const family = isIP(value)
  if (family === 4) return !NON_PUBLIC_IPV4.check(value, 'ipv4')
  if (family !== 6 || !/^[23]/u.test(value)) return false
  return !NON_PUBLIC_IPV6.check(value, 'ipv6')
}

export function normalizeAiBaseUrl(rawUrl: string, allowLocal: boolean): string {
  if (rawUrl === '') return ''
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new DesktopError('VALIDATION_FAILED', 'Enter a valid provider base URL.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DesktopError(
      'VALIDATION_FAILED',
      'Provider URLs cannot contain credentials, query parameters, or fragments.'
    )
  }
  if (!allowLocal && url.protocol !== 'https:') {
    throw new DesktopError(
      'VALIDATION_FAILED',
      'Provider endpoints must use HTTPS unless local endpoints are explicitly allowed.'
    )
  }
  if (allowLocal && !['http:', 'https:'].includes(url.protocol)) {
    throw new DesktopError('VALIDATION_FAILED', 'Provider endpoints must use HTTP or HTTPS.')
  }
  if (!url.hostname || (url.port && (!/^\d+$/u.test(url.port) || Number(url.port) > 65_535))) {
    throw new DesktopError('VALIDATION_FAILED', 'The provider URL contains an invalid host or port.')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

export async function validateAiEndpoint(
  rawUrl: string,
  allowLocal: boolean,
  lookup: AiDnsLookup = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true })
): Promise<string> {
  const normalizedUrl = normalizeAiBaseUrl(rawUrl, allowLocal)
  if (normalizedUrl === '') return normalizedUrl
  const url = new URL(normalizedUrl)
  const hostname = normalizedHostname(url.hostname).toLowerCase()
  if (isLoopbackAddress(hostname) || isIP(hostname)) {
    if (allowLocal) return normalizedUrl
    throw new DesktopError(
      'VALIDATION_FAILED',
      'Endpoints on the local network require allowing local endpoints in settings.'
    )
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new DesktopError('NOT_FOUND', `The provider host ${hostname} could not be resolved.`)
  }
  if (addresses.length === 0) {
    throw new DesktopError('NOT_FOUND', `The provider host ${hostname} could not be resolved.`)
  }
  if (!allowLocal && addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new DesktopError(
      'VALIDATION_FAILED',
      `The provider host ${hostname} resolves to a non-public address.`
    )
  }
  return normalizedUrl
}
