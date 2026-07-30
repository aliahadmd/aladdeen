import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenDocument } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'
import {
  cleanupDocumentRuntime,
  getDocumentRuntime
} from '@renderer/document-adapters/runtime'
import { useAppStore } from '@renderer/store/app-store'

const harness = vi.hoisted(() => ({
  save: vi.fn(async () => new ArrayBuffer(32)),
  focus: vi.fn(),
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  scrollToParaId: vi.fn(() => true),
  highlightRange: vi.fn(),
  findInDocument: vi.fn(() => [{
    paraId: 'paragraph-1',
    match: 'Proposal',
    before: '',
    after: ' text'
  }])
}))

vi.mock('@eigenpal/docx-editor-react', async () => {
  const React = await import('react')
  return {
    DocxEditor: React.forwardRef(function MockDocxEditor(
      props: {
        colorMode?: string
        onChange?(): void
        onEditorViewReady?(view: unknown): void
        renderLogo?(): React.ReactNode
        renderTitleBarRight?(): React.ReactNode
      },
      ref: React.ForwardedRef<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({
        save: harness.save,
        focus: harness.focus,
        getEditorRef: () => ({
          getState: () => ({
            doc: {
              content: { size: 30 },
              textBetween: () => 'Proposal text',
              descendants: () => undefined
            }
          }),
          undo: harness.undo,
          redo: harness.redo
        }),
        findInDocument: harness.findInDocument,
        scrollToParaId: harness.scrollToParaId,
        highlightRange: harness.highlightRange,
        scrollToPosition: vi.fn(),
        loadDocumentBuffer: vi.fn()
      }))
      React.useEffect(() => {
        props.onChange?.()
        props.onEditorViewReady?.({})
      }, [])
      return (
        <div data-testid="eigenpal-editor" data-theme={props.colorMode}>
          {props.renderLogo?.()}
          {props.renderTitleBarRight?.()}
          <button type="button" onClick={() => props.onChange?.()}>Edit document</button>
        </div>
      )
    })
  }
})

vi.mock('@eigenpal/docx-editor-react/plugin-api', () => ({
  PluginHost: ({ children }: { children: React.ReactNode }) => children
}))

import { DocxDocument } from '@renderer/document-adapters/DocxDocument'

const fileId = '11111111-1111-4111-8111-111111111111'

function docxDocument(): OpenDocument {
  return {
    id: fileId,
    environmentId: '22222222-2222-4222-8222-222222222222',
    name: 'Proposal.docx',
    location: '~/Documents',
    fullPath: '/Users/test/Documents/Proposal.docx',
    documentKind: 'docx',
    capabilities: DOCUMENT_CAPABILITIES.docx,
    revision: {
      mtimeMs: 1,
      size: 32,
      sha256: 'a'.repeat(64)
    },
    session: {
      id: '33333333-3333-4333-8333-333333333333',
      url: 'aladdeen-document://session/33333333-3333-4333-8333-333333333333',
      byteLength: 32
    },
    status: 'saved',
    editorScrollTop: 0,
    editorSelection: 0,
    binaryDirty: false,
    adapterRevision: 0
  }
}

describe('Eigenpal DOCX adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(32)
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    useAppStore.setState({
      documents: [docxDocument()],
      activeFileId: fileId,
      settings: {
        theme: 'dark',
        accent: 'indigo',
        sidebarWidth: 320,
        sidebarCollapsed: false,
        agentEnabled: false,
        agentProvider: 'anthropic',
        agentModelId: 'claude-sonnet-4-5',
        agentThinkingLevel: 'medium',
        agentPanelWidth: 380,
        agentPanelCollapsed: false,
        completedOnboardingVersion: 1,
        ...DEFAULT_READING_SETTINGS
      }
    })
  })

  afterEach(() => {
    cleanupDocumentRuntime(fileId)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads the original buffer without marking it dirty, then tracks user edits', async () => {
    render(<DocxDocument document={docxDocument()} />)

    expect(await screen.findByTestId('eigenpal-editor')).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByLabelText('Aladdeen')).toBeInTheDocument()
    expect(screen.getByText('Save As')).toBeInTheDocument()
    expect(useAppStore.getState().documents[0]).toMatchObject({
      binaryDirty: false,
      adapterRevision: 0
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit document' }))
    expect(useAppStore.getState().documents[0]).toMatchObject({
      binaryDirty: true,
      adapterRevision: 1,
      status: 'editing'
    })
  })

  it('registers serialization, text extraction, search reveal, and cleanup', async () => {
    const view = render(<DocxDocument document={docxDocument()} />)
    await screen.findByTestId('eigenpal-editor')
    await waitFor(() => expect(getDocumentRuntime(fileId)).toBeDefined())

    const runtime = getDocumentRuntime(fileId)
    await expect(runtime?.serialize()).resolves.toHaveProperty('byteLength', 32)
    expect(runtime?.extractText?.()).toBe('Proposal text')
    expect(runtime?.reveal?.({
      id: 'match-1',
      target: { kind: 'tracked', fileId },
      name: 'Proposal.docx',
      location: '~/Documents',
      lineNumber: 1,
      columnStart: 1,
      columnEnd: 9,
      sourceOffsetStart: 0,
      sourceOffsetEnd: 8,
      snippet: 'Proposal text',
      snippetMatchStart: 0,
      snippetMatchEnd: 8,
      fileTruncated: false,
      documentKind: 'docx'
    }, {
      query: 'Proposal',
      matchCase: false,
      wholeWord: false
    })).toBe(true)
    expect(harness.scrollToParaId).toHaveBeenCalledWith(
      'paragraph-1',
      expect.objectContaining({ highlight: expect.any(Object) })
    )

    view.unmount()
    expect(getDocumentRuntime(fileId)).toBeUndefined()
  })
})
