import type { TrackedFileSummary } from '@shared/contracts'

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i

export function markdownDisplayName(name: string): string {
  return name.replace(MARKDOWN_EXTENSION, '')
}

export function trackedFileDisplayLocation(file: TrackedFileSummary): string {
  if (!file.projectId || !file.relativePath) return file.location

  const projectName = file.location.split(' › ', 1)[0] ?? file.location
  const separator = file.relativePath.lastIndexOf('/')
  if (separator === -1) return projectName

  return `${projectName} › ${file.relativePath.slice(0, separator)}`
}
