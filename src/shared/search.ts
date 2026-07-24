const WORD_CHARACTER = '[\\p{L}\\p{N}_]'

export function createLiteralSearchExpression(
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  global = true
): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = wholeWord
    ? `(?<!${WORD_CHARACTER})${escaped}(?!${WORD_CHARACTER})`
    : escaped
  return new RegExp(body, `${global ? 'g' : ''}u${matchCase ? '' : 'i'}`)
}

export function matchesLiteral(
  content: string,
  offsetStart: number,
  offsetEnd: number,
  query: string,
  matchCase: boolean,
  wholeWord: boolean
): boolean {
  if (offsetStart < 0 || offsetEnd > content.length || offsetStart >= offsetEnd) return false
  const expression = createLiteralSearchExpression(query, matchCase, wholeWord, false)
  const candidate = content.slice(offsetStart, offsetEnd)
  const match = expression.exec(candidate)
  return match?.index === 0 && match[0].length === candidate.length
}

export function findNearestLiteralMatch(
  content: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  preferredOffset: number
): { from: number; to: number } | null {
  const expression = createLiteralSearchExpression(query, matchCase, wholeWord)
  let nearest: { from: number; to: number } | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const match of content.matchAll(expression)) {
    if (match.index === undefined) continue
    const distance = Math.abs(match.index - preferredOffset)
    if (distance < nearestDistance) {
      nearest = { from: match.index, to: match.index + match[0].length }
      nearestDistance = distance
    }
    if (distance === 0 || (match.index > preferredOffset && distance > nearestDistance)) break
  }
  return nearest
}
