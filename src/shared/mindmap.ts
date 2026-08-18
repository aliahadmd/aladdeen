import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { List, ListItem, Root, RootContent } from 'mdast'

/**
 * Turns the Markdown inside a fenced ```markdown block into a mindmap.
 *
 * Headings establish the hierarchy by depth; lists and paragraphs hang off whichever
 * heading is currently open, and nested lists nest with them. This mirrors how a
 * reader skims an outline, and it is derived from the same mdast the preview already
 * parses — so there is no second grammar to escape prose into.
 */

export interface MindmapNode {
  id: string
  text: string
  depth: number
  children: MindmapNode[]
}

export interface MindmapLayoutNode extends MindmapNode {
  x: number
  y: number
  width: number
  height: number
  lines: string[]
  branch: number
}

export interface MindmapLink {
  id: string
  from: MindmapLayoutNode
  to: MindmapLayoutNode
  branch: number
}

export interface MindmapLayout {
  nodes: MindmapLayoutNode[]
  links: MindmapLink[]
  width: number
  height: number
}

export interface MindmapLayoutOptions {
  /** Width of `text` in px. Injected so layout stays pure and testable without a DOM. */
  measureText: (text: string) => number
  /** Baseline-to-baseline distance for wrapped labels; measureText encodes the font. */
  lineHeight?: number
  maxLabelWidth?: number
  columnGap?: number
  rowGap?: number
  padding?: number
}

export const MINDMAP_BRANCH_COUNT = 6
const MAX_MINDMAP_NODES = 400
const MAX_LABEL_CHARS = 240

function inlineText(nodes: RootContent[] | undefined): string {
  if (!nodes) return ''
  let text = ''
  for (const node of nodes) {
    if ('value' in node && typeof node.value === 'string') text += node.value
    else if ('children' in node && Array.isArray(node.children)) {
      text += inlineText(node.children as RootContent[])
    }
    if (node.type === 'break') text += ' '
  }
  return text
}

function clean(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_LABEL_CHARS ? `${collapsed.slice(0, MAX_LABEL_CHARS - 1)}…` : collapsed
}

/** Parses Markdown source into a mindmap tree, or null when there is nothing to show. */
export function buildMindmap(source: string): MindmapNode | null {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root
  let counter = 0
  const make = (text: string, depth: number): MindmapNode => ({
    id: `mm-${counter++}`,
    text,
    depth,
    children: []
  })

  const root = make('', 0)
  // Stack of currently open headings; `depth` is the Markdown heading level.
  const stack: { depth: number; node: MindmapNode }[] = [{ depth: 0, node: root }]

  const addListItems = (list: List, parent: MindmapNode, depth: number): void => {
    for (const item of list.children as ListItem[]) {
      const own: RootContent[] = []
      const nested: List[] = []
      for (const child of item.children as RootContent[]) {
        if (child.type === 'list') nested.push(child)
        else own.push(child)
      }
      const text = clean(inlineText(own))
      // A bullet that only wraps a nested list should not create an empty node.
      const target = text ? make(text, depth) : parent
      if (text) parent.children.push(target)
      for (const child of nested) addListItems(child, target, depth + 1)
    }
  }

  for (const node of tree.children) {
    if (counter > MAX_MINDMAP_NODES) break
    if (node.type === 'heading') {
      const text = clean(inlineText(node.children as RootContent[]))
      if (!text) continue
      while (stack.length > 1 && stack[stack.length - 1]!.depth >= node.depth) stack.pop()
      const parent = stack[stack.length - 1]!.node
      const created = make(text, parent.depth + 1)
      parent.children.push(created)
      stack.push({ depth: node.depth, node: created })
      continue
    }
    const parent = stack[stack.length - 1]!.node
    if (node.type === 'list') {
      addListItems(node, parent, parent.depth + 1)
      continue
    }
    if (node.type === 'paragraph' || node.type === 'blockquote') {
      const text = clean(inlineText(node.children as RootContent[]))
      if (text) parent.children.push(make(text, parent.depth + 1))
      continue
    }
    if (node.type === 'code') {
      const first = clean(node.value.split('\n')[0] ?? '')
      if (first) parent.children.push(make(first, parent.depth + 1))
    }
  }

  // A document with exactly one top-level heading uses it as the mindmap root.
  if (root.children.length === 1) {
    const only = root.children[0]!
    if (only.children.length > 0) return reroot(only)
  }
  // One label is a sentence, not a mindmap — let the caller stay a plain code block.
  if (countLabelled(root) < 2) return null
  return reroot(root)
}

function countLabelled(node: MindmapNode): number {
  return (node.text ? 1 : 0) + node.children.reduce((total, child) => total + countLabelled(child), 0)
}

function reroot(node: MindmapNode): MindmapNode {
  const walk = (current: MindmapNode, depth: number): MindmapNode => ({
    ...current,
    depth,
    children: current.children.map((child) => walk(child, depth + 1))
  })
  return walk(node, 0)
}

function wrap(text: string, measure: (value: string) => number, maxWidth: number): string[] {
  if (!text) return ['']
  if (measure(text) <= maxWidth) return [text]
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (line && measure(candidate) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Tidy left-to-right tree layout: columns are placed by depth using the widest label
 * in each column, and rows are assigned in post-order so a parent sits at the
 * midpoint of its children.
 */
export function layoutMindmap(root: MindmapNode, options: MindmapLayoutOptions): MindmapLayout {
  const lineHeight = options.lineHeight ?? 18
  const maxLabelWidth = options.maxLabelWidth ?? 340
  const columnGap = options.columnGap ?? 44
  const rowGap = options.rowGap ?? 12
  const padding = options.padding ?? 16

  const nodes: MindmapLayoutNode[] = []
  const links: MindmapLink[] = []

  const prepared = new Map<string, MindmapLayoutNode>()
  const columnWidth: number[] = []

  const measureNode = (node: MindmapNode, branch: number): MindmapLayoutNode => {
    const lines = wrap(node.text, options.measureText, maxLabelWidth)
    const width = Math.max(...lines.map((line) => options.measureText(line)), 1)
    const layoutNode: MindmapLayoutNode = {
      ...node,
      children: node.children,
      lines,
      width,
      height: Math.max(lineHeight, lines.length * lineHeight),
      x: 0,
      y: 0,
      branch
    }
    prepared.set(node.id, layoutNode)
    columnWidth[node.depth] = Math.max(columnWidth[node.depth] ?? 0, width)
    for (const [index, child] of node.children.entries()) {
      measureNode(child, node.depth === 0 ? index % MINDMAP_BRANCH_COUNT : branch)
    }
    return layoutNode
  }
  measureNode(root, 0)

  const columnX: number[] = []
  let offset = padding
  for (let depth = 0; depth < columnWidth.length; depth += 1) {
    columnX[depth] = offset
    offset += (columnWidth[depth] ?? 0) + columnGap
  }

  let cursor = padding
  const place = (node: MindmapNode): MindmapLayoutNode => {
    const current = prepared.get(node.id)!
    current.x = columnX[node.depth] ?? padding
    if (node.children.length === 0) {
      current.y = cursor
      cursor += current.height + rowGap
      return current
    }
    const placedChildren = node.children.map((child) => place(child))
    const first = placedChildren[0]!
    const last = placedChildren[placedChildren.length - 1]!
    current.y = (first.y + first.height / 2 + last.y + last.height / 2) / 2 - current.height / 2
    for (const child of placedChildren) {
      links.push({ id: `${current.id}-${child.id}`, from: current, to: child, branch: child.branch })
    }
    return current
  }
  place(root)

  const collect = (node: MindmapNode): void => {
    nodes.push(prepared.get(node.id)!)
    for (const child of node.children) collect(child)
  }
  collect(root)

  const width = offset - columnGap + padding
  const height = Math.max(...nodes.map((node) => node.y + node.height), padding) + padding
  return { nodes, links, width, height }
}

/** Cubic path from a parent's right edge to a child's left edge. */
export function mindmapLinkPath(link: MindmapLink): string {
  const x1 = link.from.x + link.from.width
  const y1 = link.from.y + link.from.height
  const x2 = link.to.x
  const y2 = link.to.y + link.to.height
  const midX = x1 + (x2 - x1) / 2
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`
}
