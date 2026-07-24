import GithubSlugger from 'github-slugger'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import remarkDeflist from 'remark-deflist'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkSmartypants from 'remark-smartypants'
import { parse as parseToml } from 'smol-toml'
import { unified, type PluggableList, type Plugin } from 'unified'
import { visit } from 'unist-util-visit'
import { parse as parseYaml } from 'yaml'

export type MarkdownRenderTarget = 'preview' | 'pdf' | 'docx'

export interface MarkdownMetadata {
  title?: string
  author?: string
  date?: string
  tags: string[]
  version?: string
  draft?: boolean
}

export interface MarkdownHeading {
  depth: 2 | 3 | 4
  id: string
  text: string
}

export interface MarkdownSourceReplacement {
  preparedStart: number
  preparedEnd: number
  originalStart: number
  originalEnd: number
}

export interface MarkdownSourceMap {
  originalLength: number
  preparedLength: number
  replacements: MarkdownSourceReplacement[]
}

export interface PreparedMarkdownSource {
  content: string
  sourceMap: MarkdownSourceMap
}

export interface MarkdownSourceDataAttributes {
  'data-aladdeen-source-start'?: number | string
  'data-aladdeen-source-end'?: number | string
  'data-aladdeen-source-exact'?: string
}

interface PositionedNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
  depth?: number
  lang?: string | null
  position?: {
    start: { offset?: number }
    end: { offset?: number }
  }
}

type MarkdownNode = PositionedNode

interface MarkdownParent extends PositionedNode {
  children: MarkdownNode[]
}

const CALLOUT_ALIASES: Record<string, 'note' | 'tip' | 'important' | 'warning' | 'danger'> = {
  note: 'note',
  info: 'note',
  tip: 'tip',
  success: 'tip',
  important: 'important',
  warning: 'warning',
  caution: 'warning',
  danger: 'danger',
  error: 'danger'
}

const CALLOUT_TITLES: Record<string, string> = {
  note: 'Note',
  info: 'Information',
  tip: 'Tip',
  success: 'Success',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  danger: 'Danger',
  error: 'Error'
}

const SAFE_CLASS_NAMES = [
  'contains-task-list',
  'task-list-item',
  'footnotes',
  'data-footnote-backref',
  'markdown-toc',
  'markdown-toc-title',
  'markdown-callout',
  'markdown-callout-title',
  'sr-only',
  /^callout-(?:note|tip|important|warning|danger)$/,
  /^language-[\w-]+$/,
  /^math-(?:inline|display)$/
]

const SAFE_TAG_NAMES = [
  ...(defaultSchema.tagNames ?? []),
  'abbr',
  'address',
  'aside',
  'bdo',
  'big',
  'cite',
  'details',
  'figcaption',
  'figure',
  'ins',
  'kbd',
  'mark',
  'meter',
  'progress',
  'samp',
  'section',
  'small',
  'summary',
  'time',
  'u',
  'var'
]

export const aladdeenMarkdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...new Set(SAFE_TAG_NAMES)],
  strip: [
    'applet',
    'audio',
    'button',
    'canvas',
    'embed',
    'form',
    'iframe',
    'object',
    'script',
    'select',
    'style',
    'svg',
    'textarea',
    'video'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ['className', ...SAFE_CLASS_NAMES],
      ['dir', 'auto', 'ltr', 'rtl'],
      ['id', 'footnote-label', /^md-[a-z0-9][a-z0-9-]*$/, /^user-content-fn(?:ref)?-[\w-]+$/],
      ['lang', /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i],
      'title',
      'ariaLabel',
      'ariaDescribedBy',
      'ariaHidden',
      ['role', 'note']
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      'dataFootnoteRef',
      'dataFootnoteBackref',
      'ariaLabel',
      'ariaDescribedBy'
    ],
    abbr: ['title'],
    bdo: [['dir', 'auto', 'ltr', 'rtl']],
    details: ['open'],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'alt',
      ['width', /^\d{1,5}$/],
      ['height', /^\d{1,5}$/],
      ['loading', 'eager', 'lazy']
    ],
    input: [
      ['type', 'checkbox'],
      'checked',
      'disabled'
    ],
    li: [...(defaultSchema.attributes?.li ?? []), 'value'],
    meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
    ol: ['start'],
    progress: ['value', 'max'],
    td: [
      ['align', 'left', 'center', 'right'],
      'colSpan',
      'rowSpan'
    ],
    th: [
      ['align', 'left', 'center', 'right'],
      'colSpan',
      'rowSpan'
    ],
    time: ['dateTime']
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https'],
    src: ['aladdeen-asset']
  },
  required: {
    ...defaultSchema.required,
    input: { disabled: true, type: 'checkbox' }
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function metadataFromRecord(record: unknown): MarkdownMetadata | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const input = record as Record<string, unknown>
  const rawTags = input.tags
  const tags = Array.isArray(rawTags)
    ? rawTags.map(stringValue).filter((tag): tag is string => Boolean(tag))
    : typeof rawTags === 'string'
      ? rawTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : []
  return {
    title: stringValue(input.title),
    author: stringValue(input.author),
    date: stringValue(input.date),
    tags,
    version: stringValue(input.version),
    draft: booleanValue(input.draft)
  }
}

export function extractMarkdownMetadata(source: string): MarkdownMetadata | null {
  const normalized = source.replace(/^\uFEFF/, '')
  const opening = normalized.match(/^(---|\+\+\+)[ \t]*\r?\n/)
  if (!opening) return null
  const fence = opening[1]
  const bodyStart = opening[0].length
  const closingPattern = new RegExp(`^${fence === '---' ? '---' : '\\+\\+\\+'}[ \\t]*$`, 'm')
  const closing = closingPattern.exec(normalized.slice(bodyStart))
  if (!closing) return null
  const body = normalized.slice(bodyStart, bodyStart + closing.index)
  try {
    return metadataFromRecord(fence === '---' ? parseYaml(body) : parseToml(body))
  } catch {
    return null
  }
}

function textContent(node: MarkdownNode): string {
  if (typeof node.value === 'string') return node.value
  return node.children?.map(textContent).join('') ?? ''
}

function excludedSourceRanges(source: string): Array<[number, number]> {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .parse(source) as MarkdownNode
  const ranges: Array<[number, number]> = []
  visit(tree as never, (node: PositionedNode) => {
    if (!['code', 'inlineCode', 'html', 'yaml', 'toml'].includes(node.type)) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (typeof start === 'number' && typeof end === 'number') ranges.push([start, end])
  })
  return ranges.sort((left, right) => left[0] - right[0])
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

export function prepareMarkdownSourceWithMap(source: string): PreparedMarkdownSource {
  const identity = (): PreparedMarkdownSource => ({
    content: source,
    sourceMap: {
      originalLength: source.length,
      preparedLength: source.length,
      replacements: []
    }
  })

  if (!source.includes('\\(') && !source.includes('\\[')) return identity()
  const ranges = excludedSourceRanges(source)
  const excluded = (index: number): boolean =>
    ranges.some(([start, end]) => index >= start && index < end)
  const replacements = new Map<number, { length: number; value: string }>()

  const pair = (opening: '\\(' | '\\[', closing: '\\)' | '\\]', replacement: '$' | '$$'): void => {
    let cursor = 0
    while (cursor < source.length - 1) {
      const start = source.indexOf(opening, cursor)
      if (start === -1) break
      if (excluded(start) || isEscaped(source, start)) {
        cursor = start + 2
        continue
      }
      let end = source.indexOf(closing, start + 2)
      while (end !== -1 && (excluded(end) || isEscaped(source, end))) {
        end = source.indexOf(closing, end + 2)
      }
      if (end === -1) break
      replacements.set(start, { length: 2, value: replacement })
      replacements.set(end, { length: 2, value: replacement })
      cursor = end + 2
    }
  }

  pair('\\(', '\\)', '$')
  pair('\\[', '\\]', '$$')
  if (replacements.size === 0) return identity()

  let result = ''
  const sourceMapReplacements: MarkdownSourceReplacement[] = []
  for (let index = 0; index < source.length; ) {
    const replacement = replacements.get(index)
    if (replacement) {
      const preparedStart = result.length
      result += replacement.value
      sourceMapReplacements.push({
        preparedStart,
        preparedEnd: result.length,
        originalStart: index,
        originalEnd: index + replacement.length
      })
      index += replacement.length
    } else {
      result += source[index]
      index += 1
    }
  }
  return {
    content: result,
    sourceMap: {
      originalLength: source.length,
      preparedLength: result.length,
      replacements: sourceMapReplacements
    }
  }
}

export function originalOffsetForPrepared(sourceMap: MarkdownSourceMap, offset: number): number {
  const preparedOffset = Math.min(Math.max(Math.trunc(offset), 0), sourceMap.preparedLength)
  let low = 0
  let high = sourceMap.replacements.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (sourceMap.replacements[middle]!.preparedStart <= preparedOffset) low = middle + 1
    else high = middle
  }
  const replacement = sourceMap.replacements[low - 1]
  if (!replacement) return preparedOffset
  if (preparedOffset <= replacement.preparedEnd) {
    const preparedLength = replacement.preparedEnd - replacement.preparedStart
    const originalLength = replacement.originalEnd - replacement.originalStart
    if (preparedLength <= 0) return replacement.originalStart
    const progress = (preparedOffset - replacement.preparedStart) / preparedLength
    return Math.min(
      replacement.originalEnd,
      replacement.originalStart + Math.round(progress * originalLength)
    )
  }
  const delta = replacement.originalEnd - replacement.preparedEnd
  return Math.min(preparedOffset + delta, sourceMap.originalLength)
}

export function prepareMarkdownSource(source: string): string {
  return prepareMarkdownSourceWithMap(source).content
}

function toList(items: TocEntry[]): MarkdownNode {
  return {
    type: 'list',
    children: items.map((item) => ({
      type: 'listItem',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'link', url: `#${item.heading.id}`, children: [{ type: 'text', value: item.heading.text }] }]
        },
        ...(item.children.length > 0 ? [toList(item.children)] : [])
      ]
    }))
  }
}

interface TocEntry {
  heading: MarkdownHeading
  children: TocEntry[]
}

function tocTree(headings: MarkdownHeading[]): TocEntry[] {
  const roots: TocEntry[] = []
  const stack: TocEntry[] = []
  for (const heading of headings) {
    const entry: TocEntry = { heading, children: [] }
    while (stack.length > 0 && stack[stack.length - 1]!.heading.depth >= heading.depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(entry)
    else roots.push(entry)
    stack.push(entry)
  }
  return roots
}

function createTocNode(headings: MarkdownHeading[]): MarkdownNode {
  return {
    type: 'blockquote',
    data: {
      hName: 'details',
      hProperties: { className: ['markdown-toc'], open: true }
    },
    children: [
      {
        type: 'paragraph',
        data: { hName: 'summary', hProperties: { className: ['markdown-toc-title'] } },
        children: [{ type: 'text', value: 'On this page' }]
      },
      toList(tocTree(headings))
    ]
  }
}

function transformCallout(node: MarkdownNode): void {
  if (node.type !== 'blockquote' || !node.children?.length) return
  const first = node.children[0]
  if (first?.type !== 'paragraph' || !first.children?.length) return
  const firstText = first.children[0]
  if (firstText?.type !== 'text' || typeof firstText.value !== 'string') return
  const match = /^\[!([a-z]+)\](?:[ \t]+([^\n]+))?(?:\n|$)/i.exec(firstText.value)
  if (!match) return
  const sourceType = match[1]!.toLowerCase()
  const type = CALLOUT_ALIASES[sourceType]
  if (!type) return

  firstText.value = firstText.value.slice(match[0].length)
  if (!firstText.value) first.children.shift()
  if (first.children.length === 0) node.children.shift()
  node.data = {
    hName: 'aside',
    hProperties: {
      className: ['markdown-callout', `callout-${type}`],
      role: 'note',
      ariaLabel: match[2]?.trim() || CALLOUT_TITLES[sourceType]
    }
  }
  node.children.unshift({
    type: 'paragraph',
    data: { hName: 'div', hProperties: { className: ['markdown-callout-title'] } },
    children: [{ type: 'text', value: match[2]?.trim() || CALLOUT_TITLES[sourceType] || 'Note' }]
  })
}

const remarkAladdeenStructure: Plugin = () => (tree) => {
  const root = tree as unknown as MarkdownParent
  const slugger = new GithubSlugger()
  const headings: MarkdownHeading[] = []
  let mermaidCount = 0

  visit(root as never, (node: MarkdownNode) => {
    if (node.type === 'heading' && typeof node.depth === 'number') {
      const text = textContent(node).trim()
      const githubSlug = slugger.slug(text || 'section')
      const safeSlug = Array.from(githubSlug)
        .map((character) =>
          /[a-z0-9_-]/i.test(character) ? character : `u${character.codePointAt(0)!.toString(16)}-`
        )
        .join('')
        .replace(/-+$/, '')
      const id = `md-${safeSlug || 'section'}`
      node.data = { ...(node.data ?? {}), hProperties: { ...(node.data?.hProperties ?? {}), id } }
      if (node.depth >= 2 && node.depth <= 4) {
        headings.push({ depth: node.depth as 2 | 3 | 4, id, text })
      }
    }
    if (node.type === 'code' && node.lang?.toLowerCase() === 'math') {
      node.type = 'math'
      delete node.lang
      node.data = {
        hName: 'pre',
        hProperties: { className: ['math-display'] },
        hChildren: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-math', 'math-display'] },
            children: [{ type: 'text', value: node.value ?? '' }]
          }
        ]
      } as unknown as MarkdownNode['data']
    }
    if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid') {
      mermaidCount += 1
      if (mermaidCount > 50) node.lang = 'mermaid-disabled'
    }
    transformCallout(node)
  })

  const nextChildren: MarkdownNode[] = []
  let previousWasToc = false
  for (const child of root.children) {
    const isToc = child.type === 'paragraph' && /^\[\[?toc\]?\]$/i.test(textContent(child).trim())
    if (isToc) {
      if (!previousWasToc) nextChildren.push(createTocNode(headings))
      previousWasToc = true
    } else {
      nextChildren.push(child)
      previousWasToc = false
    }
  }
  root.children = nextChildren
}

const AUTO_DIRECTION_TAGS = new Set([
  'blockquote',
  'dd',
  'dt',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'td',
  'th'
])

const rehypeAladdeenPolish: Plugin = () => (tree) => {
  visit(tree as never, 'element', (node: { tagName?: string; properties?: Record<string, unknown>; children?: unknown[] }, index, parent) => {
    if (!node.tagName) return
    node.properties ??= {}
    if (AUTO_DIRECTION_TAGS.has(node.tagName) && !node.properties.dir) node.properties.dir = 'auto'
    if (node.tagName === 'input' && parent && typeof index === 'number') {
      const parentClasses = (parent as { properties?: { className?: unknown } }).properties?.className
      const isTaskInput =
        Array.isArray(parentClasses) &&
        parentClasses.includes('task-list-item') &&
        node.properties.type === 'checkbox'
      if (!isTaskInput) (parent as { children: unknown[] }).children.splice(index, 1)
    }
  })
}

interface SourcePositionNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: SourcePositionNode[]
  position?: {
    start: { offset?: number }
    end: { offset?: number }
  }
}

interface SourcePositionOptions {
  preparedContent: string
  sourceMap: MarkdownSourceMap
}

const EXACT_TEXT_PARENT_TAGS = new Set([
  'a',
  'abbr',
  'bdo',
  'big',
  'cite',
  'dd',
  'del',
  'dt',
  'em',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ins',
  'kbd',
  'li',
  'mark',
  'p',
  'samp',
  'small',
  'strong',
  'sub',
  'summary',
  'sup',
  'td',
  'th',
  'time',
  'u',
  'var'
])

function mappedSourcePosition(
  node: SourcePositionNode,
  sourceMap: MarkdownSourceMap
): { start: number; end: number } | null {
  const preparedStart = node.position?.start.offset
  const preparedEnd = node.position?.end.offset
  if (typeof preparedStart !== 'number' || typeof preparedEnd !== 'number' || preparedEnd <= preparedStart) {
    return null
  }
  const start = originalOffsetForPrepared(sourceMap, preparedStart)
  const end = originalOffsetForPrepared(sourceMap, preparedEnd)
  return end > start ? { start, end } : null
}

function sourcePositionProperties(
  position: { start: number; end: number },
  exact = false
): Record<string, unknown> {
  return {
    dataAladdeenSourceStart: position.start,
    dataAladdeenSourceEnd: position.end,
    ...(exact ? { dataAladdeenSourceExact: 'true' } : {})
  }
}

/**
 * Runs after sanitization so source-position attributes can only originate from
 * Aladdeen, never from user-authored raw HTML.
 */
export const rehypeAladdeenSourcePositions: Plugin = (rawOptions?: unknown) => {
  const options = rawOptions as SourcePositionOptions | undefined
  return (tree) => {
    if (!options) return
    const root = tree as unknown as SourcePositionNode

    visit(root as never, 'element', (node: SourcePositionNode) => {
      const position = mappedSourcePosition(node, options.sourceMap)
      if (!position) return
      node.properties = {
        ...(node.properties ?? {}),
        ...sourcePositionProperties(position)
      }
    })

    visit(
      root as never,
      'text',
      (node: SourcePositionNode, index: number | undefined, parent: SourcePositionNode | undefined) => {
        if (
          typeof index !== 'number' ||
          !parent?.children ||
          !parent.tagName ||
          !EXACT_TEXT_PARENT_TAGS.has(parent.tagName) ||
          typeof node.value !== 'string' ||
          !/\S/u.test(node.value)
        ) {
          return
        }
        const preparedStart = node.position?.start.offset
        const preparedEnd = node.position?.end.offset
        const position = mappedSourcePosition(node, options.sourceMap)
        if (
          !position ||
          typeof preparedStart !== 'number' ||
          typeof preparedEnd !== 'number' ||
          options.preparedContent.slice(preparedStart, preparedEnd) !== node.value
        ) {
          return
        }
        parent.children[index] = {
          type: 'element',
          tagName: 'span',
          properties: sourcePositionProperties(position, true),
          children: [node],
          position: node.position
        }
      }
    )
  }
}

export const aladdeenMarkdownRemarkPlugins: PluggableList = [
  [remarkFrontmatter, ['yaml', 'toml']],
  remarkMath,
  remarkGfm,
  remarkDeflist,
  remarkSmartypants,
  remarkAladdeenStructure
]

export const aladdeenMarkdownRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, aladdeenMarkdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }],
  [rehypeHighlight, { detect: false, subset: false }],
  rehypeAladdeenPolish
]

export function createMarkdownAstProcessor() {
  return unified().use(remarkParse).use(aladdeenMarkdownRemarkPlugins)
}
