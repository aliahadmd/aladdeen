import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectScopeNode } from '@shared/contracts'
import { ProjectScopeTree } from '@renderer/components/ProjectScopeTree'

const nodes: ProjectScopeNode[] = [{
  id: 'docs',
  name: 'docs',
  path: 'docs',
  kind: 'directory',
  descendantCount: 2,
  children: [
    { id: 'docs/guide.md', name: 'guide.md', path: 'docs/guide.md', kind: 'file', descendantCount: 1 },
    { id: 'docs/reference.md', name: 'reference.md', path: 'docs/reference.md', kind: 'file', descendantCount: 1 }
  ]
}, {
  id: 'README.md',
  name: 'README.md',
  path: 'README.md',
  kind: 'file',
  descendantCount: 1
}]

afterEach(cleanup)

describe('project scope tree', () => {
  it('selects a whole folder without expanding every file', () => {
    const onChange = vi.fn()
    render(<ProjectScopeTree nodes={nodes} selected={new Set()} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include docs' }))
    expect([...onChange.mock.calls[0]![0] as Set<string>]).toEqual(['docs'])
  })

  it('bulk-selects files returned by a folder search', () => {
    const onChange = vi.fn()
    render(<ProjectScopeTree nodes={nodes} selected={new Set()} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Filter folders and files'), { target: { value: 'docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select results' }))
    expect([...onChange.mock.calls[0]![0] as Set<string>]).toEqual(['docs/guide.md', 'docs/reference.md'])
  })

  it('adds an exact exclusion without dropping an inherited folder selection', () => {
    const onChange = vi.fn()
    const onExcludePatternsChange = vi.fn()
    render(
      <ProjectScopeTree
        nodes={nodes}
        selected={new Set(['docs'])}
        excludePatterns={[]}
        onChange={onChange}
        onExcludePatternsChange={onExcludePatternsChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand docs' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exclude guide.md' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(onExcludePatternsChange).toHaveBeenCalledWith(['docs/guide.md'])
  })
})
