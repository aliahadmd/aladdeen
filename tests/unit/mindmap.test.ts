import { describe, expect, it } from 'vitest'
import { buildMindmap, layoutMindmap, mindmapLinkPath, type MindmapNode } from '@shared/mindmap'

// Deterministic stand-in for canvas measurement, so layout assertions are exact.
const measureText = (value: string): number => value.length * 7

function labels(node: MindmapNode): string[] {
  return [node.text, ...node.children.flatMap(labels)]
}

describe('markdown mindmap', () => {
  it('promotes a single top-level heading to the root and nests headings by depth', () => {
    const root = buildMindmap(
      [
        '# Project: Personal AI Assistant (serverless P2P memory mesh)',
        '',
        '## Prime directives',
        '1. Apply by op_id.',
        '2. Never mix vector spaces.',
        '',
        '## Commands',
        '- pnpm build',
        '',
        '## Conventions',
        '- TypeScript strict.'
      ].join('\n')
    )

    expect(root).not.toBeNull()
    expect(root?.text).toBe('Project: Personal AI Assistant (serverless P2P memory mesh)')
    expect(root?.children.map((child) => child.text)).toEqual([
      'Prime directives',
      'Commands',
      'Conventions'
    ])
    expect(root?.children[0]?.children.map((child) => child.text)).toEqual([
      'Apply by op_id.',
      'Never mix vector spaces.'
    ])
    // Prose is carried verbatim: there is no intermediate grammar to escape into.
    expect(labels(root!)).toContain('Apply by op_id.')
  })

  it('nests sub-lists and skips a bullet that only wraps a nested list', () => {
    const root = buildMindmap(['# Root', '', '- Parent', '  - Child', '-', '  - Orphan'].join('\n'))
    const parent = root?.children.find((child) => child.text === 'Parent')
    expect(parent?.children.map((child) => child.text)).toEqual(['Child'])
    // The empty bullet contributes no node, so its child attaches to the root.
    expect(root?.children.map((child) => child.text)).toEqual(['Parent', 'Orphan'])
  })

  it('returns null when there is no hierarchy to draw', () => {
    expect(buildMindmap('')).toBeNull()
    expect(buildMindmap('   \n\n')).toBeNull()
  })

  it('refuses to draw a map for a single label, leaving it a plain code block', () => {
    expect(buildMindmap('# Only a title')).toBeNull()
    expect(buildMindmap('- one bullet')).toBeNull()
    // Two labels is the minimum that expresses a relationship.
    expect(buildMindmap('# Root\n\n- child')).not.toBeNull()
  })

  it('collapses whitespace and truncates a very long label', () => {
    const root = buildMindmap(`# Root\n\n- ${'word '.repeat(120)}`)
    const label = root?.children[0]?.text ?? ''
    expect(label).not.toContain('  ')
    expect(label.length).toBeLessThanOrEqual(240)
    expect(label.endsWith('…')).toBe(true)
  })

  it('lays out columns by depth and centres a parent on its children', () => {
    const root = buildMindmap(['# R', '', '- one', '- two'].join('\n'))!
    const layout = layoutMindmap(root, { measureText, lineHeight: 18, rowGap: 10, padding: 0 })

    const [parent, first, second] = layout.nodes
    expect(parent?.depth).toBe(0)
    expect(first?.depth).toBe(1)
    // Children share a column, and it sits to the right of the parent's.
    expect(first?.x).toBe(second?.x)
    expect(first!.x).toBeGreaterThan(parent!.x)
    // Parent is vertically centred between its first and last child.
    const centre = (first!.y + first!.height / 2 + second!.y + second!.height / 2) / 2
    expect(parent!.y + parent!.height / 2).toBeCloseTo(centre, 5)
    expect(layout.links).toHaveLength(2)
  })

  it('wraps a label past the maximum width into multiple lines', () => {
    const root = buildMindmap('# R\n\n- aaa bbb ccc ddd eee fff')!
    const layout = layoutMindmap(root, { measureText, maxLabelWidth: 70, lineHeight: 18 })
    const child = layout.nodes.find((node) => node.depth === 1)!
    expect(child.lines.length).toBeGreaterThan(1)
    // No line exceeds the budget, and wrapping never drops a word.
    for (const line of child.lines) expect(measureText(line)).toBeLessThanOrEqual(70)
    expect(child.lines.join(' ')).toBe('aaa bbb ccc ddd eee fff')
    expect(child.height).toBe(child.lines.length * 18)
  })

  it('assigns one branch colour per top-level subtree and inherits it downward', () => {
    const root = buildMindmap(['# R', '', '## A', '- a1', '', '## B', '- b1'].join('\n'))!
    const layout = layoutMindmap(root, { measureText })
    const branchOf = (text: string) => layout.nodes.find((node) => node.text === text)?.branch

    expect(branchOf('A')).not.toBe(branchOf('B'))
    expect(branchOf('a1')).toBe(branchOf('A'))
    expect(branchOf('b1')).toBe(branchOf('B'))
  })

  it('draws each link as a cubic curve between the two label edges', () => {
    const root = buildMindmap('# R\n\n- child')!
    const layout = layoutMindmap(root, { measureText })
    const path = mindmapLinkPath(layout.links[0]!)
    expect(path).toMatch(/^M[\d.]+,[\d.]+ C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+$/)
  })
})
