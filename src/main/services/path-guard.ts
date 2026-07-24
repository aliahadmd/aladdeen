import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { DesktopError } from '@main/errors'

export function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

export function resolveSyntacticPath(root: string, relativePath: string): string {
  if (relativePath.includes('\0') || isAbsolute(relativePath)) {
    throw new DesktopError('INVALID_PATH', 'That path is not valid inside this workspace.')
  }
  const candidate = resolve(root, relativePath)
  if (!isPathInside(root, candidate)) {
    throw new DesktopError('INVALID_PATH', 'That path points outside the active workspace.')
  }
  return candidate
}

export async function resolveExistingPath(root: string, relativePath: string): Promise<string> {
  const candidate = resolveSyntacticPath(root, relativePath)
  const candidateStats = await lstat(candidate)
  if (candidateStats.isSymbolicLink()) {
    throw new DesktopError('INVALID_PATH', 'Symbolic links are not available in this workspace.')
  }
  const canonical = await realpath(candidate)
  if (canonical !== candidate || !isPathInside(root, canonical)) {
    throw new DesktopError('INVALID_PATH', 'Symbolic links outside the workspace are not available.')
  }
  return canonical
}

export async function resolveNewPath(root: string, parentRelativePath: string, name: string): Promise<string> {
  const parent = await resolveExistingPath(root, parentRelativePath || '.')
  const parentStats = await stat(parent)
  if (!parentStats.isDirectory()) throw new DesktopError('INVALID_PATH', 'The selected parent is not a folder.')
  const target = resolve(parent, name)
  if (!isPathInside(root, target)) throw new DesktopError('INVALID_PATH', 'That name points outside the workspace.')
  return target
}
