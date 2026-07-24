import type { DocumentTarget, GlobalSearchMatch } from '@shared/contracts'
import { createLiteralSearchExpression } from '@shared/search'

const SNIPPET_LENGTH = 180
const SNIPPET_CONTEXT = 72

export interface SearchableMarkdownSource {
  key: string
  target: DocumentTarget
  name: string
  location: string
  content: string
}

export interface SearchMarkdownOptions {
  query: string
  matchCase: boolean
  wholeWord: boolean
  limit: number
}

export interface SearchMarkdownResult {
  matches: GlobalSearchMatch[]
  truncated: boolean
}

export function searchMarkdownSource(
  source: SearchableMarkdownSource,
  options: SearchMarkdownOptions
): SearchMarkdownResult {
  const expression = createLiteralSearchExpression(options.query, options.matchCase, options.wholeWord)
  const matches: GlobalSearchMatch[] = []
  let truncated = false
  let lineNumber = 1
  let lineStart = 0
  let nextNewline = source.content.indexOf('\n')

  for (const match of source.content.matchAll(expression)) {
    const sourceOffsetStart = match.index
    if (sourceOffsetStart === undefined) continue
    while (nextNewline >= 0 && nextNewline < sourceOffsetStart) {
      lineNumber += 1
      lineStart = nextNewline + 1
      nextNewline = source.content.indexOf('\n', lineStart)
    }

    if (matches.length >= options.limit) {
      truncated = true
      break
    }

    const matchedText = match[0]
    const sourceOffsetEnd = sourceOffsetStart + matchedText.length
    const rawLineEnd = nextNewline >= 0 ? nextNewline : source.content.length
    const lineEnd = rawLineEnd > lineStart && source.content[rawLineEnd - 1] === '\r'
      ? rawLineEnd - 1
      : rawLineEnd
    const line = source.content.slice(lineStart, lineEnd)
    const matchStartInLine = sourceOffsetStart - lineStart
    const matchEndInLine = Math.min(line.length, sourceOffsetEnd - lineStart)
    const snippet = createSnippet(line, matchStartInLine, matchEndInLine)

    matches.push({
      id: `${source.key}:${sourceOffsetStart}:${sourceOffsetEnd}`,
      target: source.target,
      name: source.name,
      location: source.location,
      lineNumber,
      columnStart: matchStartInLine + 1,
      columnEnd: matchStartInLine + matchedText.length + 1,
      sourceOffsetStart,
      sourceOffsetEnd,
      snippet: snippet.text,
      snippetMatchStart: snippet.matchStart,
      snippetMatchEnd: snippet.matchEnd,
      fileTruncated: false
    })
  }

  if (truncated) {
    for (const match of matches) match.fileTruncated = true
  }
  return { matches, truncated }
}

function createSnippet(
  line: string,
  matchStart: number,
  matchEnd: number
): { text: string; matchStart: number; matchEnd: number } {
  if (line.length <= SNIPPET_LENGTH) {
    return { text: line, matchStart, matchEnd }
  }

  let start = Math.max(0, matchStart - SNIPPET_CONTEXT)
  let end = Math.min(line.length, Math.max(matchEnd + SNIPPET_CONTEXT, start + SNIPPET_LENGTH))
  if (end - start > SNIPPET_LENGTH) end = start + SNIPPET_LENGTH
  if (end === line.length) start = Math.max(0, end - SNIPPET_LENGTH)

  const prefix = start > 0 ? '…' : ''
  const suffix = end < line.length ? '…' : ''
  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    matchStart: prefix.length + matchStart - start,
    matchEnd: prefix.length + Math.min(matchEnd, end) - start
  }
}
