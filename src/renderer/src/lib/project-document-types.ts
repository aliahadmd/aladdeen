import type {
  DocumentKind,
  DocumentKindCounts,
  ProjectScopeNode
} from '@shared/contracts'
import { documentKindFromName } from '@shared/documents'

export const PROJECT_DOCUMENT_TYPE_OPTIONS: ReadonlyArray<{
  kind: DocumentKind
  label: string
  extensions: string
}> = [
  { kind: 'markdown', label: 'Markdown', extensions: '.md, .markdown' },
  { kind: 'docx', label: 'Word', extensions: '.docx' },
  { kind: 'pdf', label: 'PDF', extensions: '.pdf' },
  { kind: 'xlsx', label: 'Excel', extensions: '.xlsx' },
  { kind: 'pptx', label: 'PowerPoint', extensions: '.pptx' },
  { kind: 'html', label: 'HTML', extensions: '.html, .htm' }
]

export function filterProjectScopeTree(
  nodes: readonly ProjectScopeNode[],
  enabled: ReadonlySet<DocumentKind>
): ProjectScopeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      const kind = node.documentKind ?? documentKindFromName(node.name)
      return kind && enabled.has(kind) ? [{ ...node }] : []
    }
    const children = filterProjectScopeTree(node.children ?? [], enabled)
    if (children.length === 0) return []
    return [{
      ...node,
      children,
      descendantCount: children.reduce(
        (total, child) => total + (child.kind === 'directory' ? child.descendantCount : 1),
        0
      )
    }]
  })
}

export function enabledDocumentCount(
  counts: DocumentKindCounts,
  enabled: ReadonlySet<DocumentKind>
): number {
  return [...enabled].reduce((total, kind) => total + counts[kind], 0)
}
