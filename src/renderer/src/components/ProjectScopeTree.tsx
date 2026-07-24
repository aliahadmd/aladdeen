import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FileText, Folder, Minus, Search, X } from 'lucide-react'
import type { ProjectScopeNode } from '@shared/contracts'
import { centeredEmptyClasses } from '@renderer/lib/ui-styles'

interface ProjectScopeTreeProps {
  nodes: ProjectScopeNode[]
  selected: Set<string>
  excludePatterns?: string[]
  onChange(selected: Set<string>): void
  onExcludePatternsChange?(patterns: string[]): void
}

export function ProjectScopeTree({
  nodes,
  selected,
  excludePatterns = [],
  onChange,
  onExcludePatternsChange
}: ProjectScopeTreeProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const visibleNodes = useMemo(() => filterNodes(nodes, query.trim().toLocaleLowerCase()), [nodes, query])
  const matchingPaths = useMemo(() => collectSelectablePaths(visibleNodes), [visibleNodes])

  useEffect(() => {
    setCollapsed(new Set(collectDirectoryPaths(nodes)))
  }, [nodes])

  const toggle = (node: ProjectScopeNode): void => {
    const path = node.path
    const next = new Set(selected)
    const ancestor = [...next].find((candidate) => path.startsWith(`${candidate}/`))
    const exclusion = exclusionPattern(node)
    const isExcluded = excludePatterns.includes(exclusion)
    if (isExcluded) {
      onExcludePatternsChange?.(excludePatterns.filter((pattern) => pattern !== exclusion))
      return
    }
    if (next.has(path)) {
      next.delete(path)
      for (const candidate of next) if (candidate.startsWith(`${path}/`)) next.delete(candidate)
    } else if (ancestor) {
      onExcludePatternsChange?.([...excludePatterns, exclusion])
      return
    } else {
      for (const candidate of next) if (candidate.startsWith(`${path}/`)) next.delete(candidate)
      next.add(path)
    }
    onChange(next)
  }

  const addMatching = (): void => {
    const next = new Set(selected)
    for (const path of matchingPaths) {
      if ([...next].some((candidate) => path.startsWith(`${candidate}/`))) continue
      for (const candidate of next) if (candidate.startsWith(`${path}/`)) next.delete(candidate)
      next.add(path)
    }
    onChange(next)
  }

  const renderNodes = (items: ProjectScopeNode[], depth: number): React.ReactNode => items.map((node) => {
    const exact = selected.has(node.path)
    const inherited = [...selected].some((path) => node.path.startsWith(`${path}/`))
    const excluded = excludePatterns.includes(exclusionPattern(node))
    const checked = (exact || inherited) && !excluded
    const partial = !checked && !excluded && [...selected].some((path) => path.startsWith(`${node.path}/`))
    const isCollapsed = collapsed.has(node.path) && !query
    return (
      <div key={node.path} className="scope-tree-item">
        <div className="scope-tree-row" style={{ '--scope-depth': depth } as React.CSSProperties}>
          {node.kind === 'directory' ? (
            <button
              className="scope-disclosure"
              type="button"
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
              onClick={() => setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : <span className="scope-disclosure" />}
          <button
            className="scope-checkbox"
            type="button"
            role="checkbox"
            aria-checked={checked ? true : partial ? 'mixed' : false}
            aria-label={`${checked ? 'Exclude' : 'Include'} ${node.name}`}
            onClick={() => toggle(node)}
          >
            {checked ? <Check size={11} /> : partial ? <Minus size={11} /> : null}
          </button>
          {node.kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
          <span className="scope-node-name">{node.name}</span>
          {node.kind === 'directory' && <span className="scope-node-count">{node.descendantCount}</span>}
        </div>
        {node.kind === 'directory' && !isCollapsed && node.children && renderNodes(node.children, depth + 1)}
      </div>
    )
  })

  return (
    <div className="scope-tree">
      <div className="scope-tree-toolbar">
        <label className="scope-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter folders and files" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear filter"><X size={12} /></button>}
        </label>
        {query && matchingPaths.length > 0 && (
          <button className="scope-select-results" type="button" onClick={addMatching}>Select results</button>
        )}
      </div>
      <div className="scope-tree-list">
        {visibleNodes.length > 0 ? renderNodes(visibleNodes, 0) : <div className={centeredEmptyClasses}>No matching Markdown files</div>}
      </div>
    </div>
  )
}

function exclusionPattern(node: ProjectScopeNode): string {
  return node.kind === 'directory' ? `${node.path}/**` : node.path
}

function filterNodes(nodes: ProjectScopeNode[], query: string): ProjectScopeNode[] {
  if (!query) return nodes
  return nodes.flatMap((node) => {
    if (node.name.toLocaleLowerCase().includes(query)) return [node]
    const children = filterNodes(node.children ?? [], query)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

function collectSelectablePaths(nodes: ProjectScopeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file') paths.push(node.path)
    else paths.push(...collectSelectablePaths(node.children ?? []))
  }
  return paths
}

function collectDirectoryPaths(nodes: ProjectScopeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === 'directory'
    ? [node.path, ...collectDirectoryPaths(node.children ?? [])]
    : [])
}
