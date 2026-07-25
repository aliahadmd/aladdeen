import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentKind, DocumentKindCounts, ProjectScopeNode } from '@shared/contracts'
import { ProjectDocumentTypes } from '@renderer/components/ProjectDocumentTypes'
import {
  enabledDocumentCount,
  filterProjectScopeTree
} from '@renderer/lib/project-document-types'

const counts: DocumentKindCounts = {
  markdown: 12,
  html: 4,
  docx: 3,
  pdf: 2
}

afterEach(cleanup)

describe('project document type filters', () => {
  it('shows per-format discovery counts and requires at least one selected type', () => {
    const onChange = vi.fn()
    const Harness = (): React.JSX.Element => {
      const [enabled, setEnabled] = useState<Set<DocumentKind>>(new Set(['markdown']))
      return (
        <ProjectDocumentTypes
          enabled={enabled}
          counts={counts}
          onChange={(next) => {
            setEnabled(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    expect(screen.getByText('12 found')).toBeInTheDocument()
    expect(screen.getByText('4 found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Markdown/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one/i)
    expect(onChange).toHaveBeenLastCalledWith(new Set())

    fireEvent.click(screen.getByRole('checkbox', { name: /HTML/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(new Set(['html']))
  })

  it('filters the scope preview without mutating path selections or directory hierarchy', () => {
    const tree: ProjectScopeNode[] = [{
      id: 'docs',
      path: 'docs',
      name: 'docs',
      kind: 'directory',
      descendantCount: 4,
      children: [{
        id: 'docs/notes.md',
        path: 'docs/notes.md',
        name: 'notes.md',
        kind: 'file',
        documentKind: 'markdown',
        descendantCount: 1
      }, {
        id: 'docs/page.html',
        path: 'docs/page.html',
        name: 'page.html',
        kind: 'file',
        documentKind: 'html',
        descendantCount: 1
      }, {
        id: 'docs/archive',
        path: 'docs/archive',
        name: 'archive',
        kind: 'directory',
        descendantCount: 2,
        children: [{
          id: 'docs/archive/report.docx',
          path: 'docs/archive/report.docx',
          name: 'report.docx',
          kind: 'file',
          documentKind: 'docx',
          descendantCount: 1
        }, {
          id: 'docs/archive/proof.pdf',
          path: 'docs/archive/proof.pdf',
          name: 'proof.pdf',
          kind: 'file',
          documentKind: 'pdf',
          descendantCount: 1
        }]
      }]
    }]
    const selected = new Set(['docs/archive/report.docx'])
    const filtered = filterProjectScopeTree(tree, new Set(['markdown', 'pdf']))

    expect(filtered).toMatchObject([{
      path: 'docs',
      descendantCount: 2,
      children: [{
        path: 'docs/notes.md',
        documentKind: 'markdown'
      }, {
        path: 'docs/archive',
        descendantCount: 1,
        children: [{ path: 'docs/archive/proof.pdf', documentKind: 'pdf' }]
      }]
    }])
    expect(selected).toEqual(new Set(['docs/archive/report.docx']))
    expect(enabledDocumentCount(counts, new Set(['markdown', 'pdf']))).toBe(14)
  })
})
