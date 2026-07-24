import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalSearchDialog } from '@renderer/components/GlobalSearchDialog'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, GlobalSearchEvent, OpenDocument } from '@shared/contracts'

const environmentId = '11111111-1111-4111-8111-111111111111'
const fileId = '22222222-2222-4222-8222-222222222222'
const sessionId = '33333333-3333-4333-8333-333333333333'
const document: OpenDocument = {
  id: fileId,
  environmentId,
  name: 'draft.md',
  location: '~/Notes',
  fullPath: '/Users/test/Notes/draft.md',
  content: 'draft needle',
  savedContent: 'draft',
  status: 'editing',
  editorScrollTop: 0,
  editorSelection: 0,
  revision: {
    mtimeMs: 1,
    size: 5,
    sha256: 'a'.repeat(64),
    lineEnding: 'LF',
    hasBom: false
  }
}

describe('global content search dialog', () => {
  let searchListener: ((event: GlobalSearchEvent) => void) | undefined
  const start = vi.fn()
  const cancel = vi.fn()
  const persistState = vi.fn()

  beforeEach(() => {
    start.mockResolvedValue({ ok: true, value: { sessionId } })
    cancel.mockResolvedValue({ ok: true, value: undefined })
    persistState.mockResolvedValue({ ok: true, value: undefined })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: {
        search: {
          start,
          cancel,
          onEvent: (callback: (event: GlobalSearchEvent) => void) => {
            searchListener = callback
            return () => { searchListener = undefined }
          },
          onOpenRequest: () => () => undefined
        },
        environments: { persistState }
      } as unknown as AladdeenApi
    })
    useAppStore.setState({
      environment: {
        environment: { id: environmentId, name: 'Personal', createdAt: 1, updatedAt: 1 },
        environments: [{ id: environmentId, name: 'Personal', createdAt: 1, updatedAt: 1 }],
        projects: [],
        files: [{
          id: fileId,
          environmentId,
          name: 'draft.md',
          location: '~/Notes',
          fullPath: '/Users/test/Notes/draft.md',
          lastOpenedAt: 1,
          missing: false
        }],
        openFileIds: [fileId],
        activeFileId: fileId
      },
      documents: [document],
      activeFileId: fileId,
      editing: false,
      mobilePane: 'preview',
      globalSearchOpen: false
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('debounces dirty-buffer search and reveals a streamed result in the editor', async () => {
    render(<GlobalSearchDialog />)
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, shiftKey: true })
    const input = await screen.findByLabelText('Search Markdown source')
    fireEvent.change(input, { target: { value: 'needle' } })

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        query: 'needle',
        matchCase: false,
        wholeWord: false,
        scope: { kind: 'environment' },
        bufferOverrides: [{ fileId, content: 'draft needle' }]
      }))
    })

    act(() => searchListener?.({
      type: 'batch',
      sessionId,
      scannedFiles: 1,
      totalFiles: 1,
      skippedFiles: 0,
      matches: [{
        id: 'tracked-match',
        target: { kind: 'tracked', fileId },
        name: 'draft.md',
        location: '~/Notes',
        lineNumber: 1,
        columnStart: 7,
        columnEnd: 13,
        sourceOffsetStart: 6,
        sourceOffsetEnd: 12,
        snippet: 'draft needle',
        snippetMatchStart: 6,
        snippetMatchEnd: 12,
        fileTruncated: false
      }]
    }))
    act(() => searchListener?.({
      type: 'complete',
      sessionId,
      summary: {
        scannedFiles: 1,
        totalFiles: 1,
        matchedFiles: 1,
        totalMatches: 1,
        skippedFiles: 0,
        truncated: false
      }
    }))

    const result = screen.getByRole('option', { name: /needle/ })
    await act(async () => fireEvent.click(result))
    expect(useAppStore.getState()).toMatchObject({
      editing: true,
      mobilePane: 'editor',
      globalSearchOpen: false
    })
    expect(useAppStore.getState().documents[0]?.editorReveal).toMatchObject({ from: 6, to: 12 })
  })
})
