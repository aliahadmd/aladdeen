import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { useAppStore } from '@renderer/store/app-store'
import type {
  AladdeenApi,
  ProjectScopePreview,
  ProjectSummary
} from '@shared/contracts'

const project: ProjectSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  environmentId: '22222222-2222-4222-8222-222222222222',
  name: 'Research notes',
  displayPath: '~/Documents/Research notes',
  expandedPaths: [],
  scopeMode: 'selected',
  includePaths: ['docs/report.docx'],
  excludePatterns: ['archive/**'],
  enabledDocumentKinds: ['markdown'],
  groupName: 'Work',
  pinned: true,
  archived: false,
  fileCount: 1,
  indexStatus: 'ready',
  indexedAt: 1
}

const preview: ProjectScopePreview = {
  project,
  totalDocuments: 3,
  kindCounts: { markdown: 1, html: 1, docx: 1, pdf: 0, xlsx: 0, pptx: 0 },
  truncated: false,
  tree: [{
    id: 'docs',
    path: 'docs',
    name: 'docs',
    kind: 'directory',
    descendantCount: 2,
    children: [{
      id: 'docs/notes.md',
      path: 'docs/notes.md',
      name: 'notes.md',
      kind: 'file',
      documentKind: 'markdown',
      descendantCount: 1
    }, {
      id: 'docs/report.docx',
      path: 'docs/report.docx',
      name: 'report.docx',
      kind: 'file',
      documentKind: 'docx',
      descendantCount: 1
    }]
  }]
}

describe('minimal project settings dialog', () => {
  const inspectScope = vi.fn()
  const updateProject = vi.fn()
  const removeProject = vi.fn()
  const originalUpdateProject = useAppStore.getState().updateProject
  const originalRemoveProject = useAppStore.getState().removeProject

  beforeEach(() => {
    inspectScope.mockResolvedValue({ ok: true, value: preview })
    updateProject.mockResolvedValue(true)
    removeProject.mockResolvedValue(undefined)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: {
        projects: { inspectScope }
      } as unknown as AladdeenApi
    })
    useAppStore.setState({ updateProject, removeProject })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useAppStore.setState({
      updateProject: originalUpdateProject,
      removeProject: originalRemoveProject
    })
  })

  it('keeps common controls visible and advanced settings collapsed', async () => {
    render(<ProjectSettingsDialog project={project} onOpenChange={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Project settings' })).toBeVisible()
    expect(screen.getByText('Research notes')).toBeVisible()
    expect(screen.getByTitle('~/Documents/Research notes')).toBeVisible()
    expect(screen.getByText('Document types')).toBeVisible()
    expect(screen.getByRole('radio', { name: /All enabled documents/ })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Selected folders and files/ })).toBeChecked()

    for (const title of ['Organization', 'Advanced indexing', 'Project management']) {
      const details = screen.getByText(title).closest('details')
      expect(details).not.toHaveAttribute('open')
    }
    expect(screen.getByText('Work · Favorited')).toBeVisible()
    expect(screen.getByText('1 exclusion')).toBeVisible()
    expect(screen.getByText('Active')).toBeVisible()
  })

  it('edits exclusions and preserves selected paths hidden by a disabled format', async () => {
    render(<ProjectSettingsDialog project={project} onOpenChange={vi.fn()} />)
    await screen.findByText('Document types')

    expect(screen.queryByText('report.docx')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Advanced indexing'))
    expect(screen.getByText('archive/**')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Add exclusion…' }))
    const input = screen.getByRole('textbox', { name: 'Exclusion pattern' })
    fireEvent.change(input, { target: { value: 'archive/**' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
    fireEvent.change(input, { target: { value: 'generated/**' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove exclusion archive/**' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith(expect.objectContaining({
        projectId: project.id,
        includePaths: ['docs/report.docx'],
        excludePatterns: ['generated/**'],
        enabledDocumentKinds: ['markdown']
      }))
    })
  })

  it('archives through Save and confirms metadata-only removal', async () => {
    const onOpenChange = vi.fn()
    render(<ProjectSettingsDialog project={project} onOpenChange={onOpenChange} />)
    await screen.findByText('Document types')

    fireEvent.click(screen.getByText('Project management'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Archive project/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith(expect.objectContaining({ archived: true })))

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
    const confirmation = screen.getByRole('alertdialog')
    expect(within(confirmation).getByText(/documents stay on disk/i)).toBeVisible()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove project' }))
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith(project.id))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
