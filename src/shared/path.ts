export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/')
}

export function dirnamePosix(value: string): string {
  const normalized = toPosixPath(value)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

export function basenamePosix(value: string): string {
  const normalized = toPosixPath(value)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function resolveRelativePath(fromFile: string, target: string): string | null {
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null

  const segments = [...dirnamePosix(fromFile).split('/'), ...target.split('/')]
  const resolved: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  return resolved.join('/')
}

export function toAssetUrl(fileId: string, target: string): string | null {
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null
  return `aladdeen-asset://document/${encodeURIComponent(fileId)}?path=${encodeURIComponent(target)}`
}
