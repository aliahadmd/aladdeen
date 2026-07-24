import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from '@renderer/components/TabBar'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, OpenDocument } from '@shared/contracts'

const environmentId = '22222222-2222-4222-8222-222222222222'

function document(id: string, name: string): OpenDocument {
  return {
    id,
    environmentId,
    name,
    location: '~/Notes',
    fullPath: `/Users/test/Notes/${name}`,
    content: '# Test',
    savedContent: '# Test',
    status: 'saved',
    editorScrollTop: 0,
    editorSelection: 0,
    revision: {
      mtimeMs: 1,
      size: 6,
      sha256: 'a'.repeat(64),
      lineEnding: 'LF',
      hasBom: false
    }
  }
}

describe('document tabs', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: {
        environments: { persistState: vi.fn().mockResolvedValue({ ok: true, value: undefined }) }
      } as unknown as AladdeenApi
    })
    useAppStore.setState({
      environment: {
        environment: { id: environmentId, name: 'Personal', createdAt: 1, updatedAt: 1 },
        environments: [],
        projects: [],
        files: [],
        openFileIds: [],
        activeFileId: undefined
      },
      documents: [
        document('11111111-1111-4111-8111-111111111111', 'one.md'),
        document('33333333-3333-4333-8333-333333333333', 'two.md')
      ],
      activeFileId: '11111111-1111-4111-8111-111111111111'
    })
  })

  afterEach(cleanup)

  it('keeps close controls outside tabs and supports roving arrow-key focus', () => {
    render(<TabBar />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.querySelector('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close one.md' }).parentElement).toBe(tabs[0]?.parentElement)

    tabs[0]?.focus()
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '-1')
  })
})
