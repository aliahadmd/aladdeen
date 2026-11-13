import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarActions } from '@renderer/components/SidebarActions'

function actions(overrides: Partial<Parameters<typeof SidebarActions>[0]> = {}) {
  const callbacks = {
    onAddFolder: vi.fn(), onOpenFile: vi.fn(), onCreateDocument: vi.fn(),
    onCreateFolder: vi.fn(), onCreateProject: vi.fn()
  }
  render(<SidebarActions {...callbacks} {...overrides} />)
  return callbacks
}

afterEach(cleanup)

describe('compact sidebar actions', () => {
  it('routes existing-file and folder actions separately from creation', async () => {
    const callbacks = actions()
    const open = screen.getByRole('button', { name: 'Open' })
    open.focus()
    fireEvent.keyDown(open, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add folder…' }))
    expect(callbacks.onAddFolder).toHaveBeenCalledOnce()
    expect(callbacks.onCreateFolder).not.toHaveBeenCalled()
    fireEvent.keyDown(open, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file…' }))
    expect(callbacks.onOpenFile).toHaveBeenCalledOnce()
    expect(callbacks.onCreateDocument).not.toHaveBeenCalled()
  })

  it('uses the selected project formats and distinguishes a subfolder from a new project', async () => {
    const callbacks = actions({ destination: 'Research / sources', enabledDocumentKinds: ['markdown', 'pdf'] })
    const create = screen.getByRole('button', { name: 'New' })
    create.focus()
    fireEvent.keyDown(create, { key: 'Enter' })
    expect(await screen.findByText('In Research / sources')).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Word document' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'PDF' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }))
    expect(callbacks.onCreateDocument).toHaveBeenCalledWith('markdown')
    fireEvent.keyDown(create, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New subfolder…' }))
    expect(callbacks.onCreateFolder).toHaveBeenCalledOnce()
    fireEvent.keyDown(create, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New project folder…' }))
    expect(callbacks.onCreateProject).toHaveBeenCalledOnce()
  })

  it('offers standalone formats without a project and restores focus on Escape', async () => {
    actions()
    const create = screen.getByRole('button', { name: 'New' })
    create.focus()
    fireEvent.keyDown(create, { key: 'Enter' })
    expect(await screen.findAllByRole('menuitem')).toHaveLength(6)
    expect(screen.getByRole('menuitem', { name: 'New folder…' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'New project folder…' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Markdown' }), { key: 'Escape' })
    await waitFor(() => expect(create).toHaveFocus())
    expect(create).toHaveAttribute('aria-expanded', 'false')
  })
})
