import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'
import { useAppStore } from '@renderer/store/app-store'
import type { PreviewSourceTarget, TextOpenDocument } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'

const fileId = '11111111-1111-4111-8111-111111111111'
const environmentId = '22222222-2222-4222-8222-222222222222'

function openDocument(content: string): TextOpenDocument {
  return {
    id: fileId,
    environmentId,
    name: 'navigation.md',
    location: '~/Notes',
    fullPath: '/Users/test/Notes/navigation.md',
    documentKind: 'markdown',
    encoding: 'utf-8',
    capabilities: DOCUMENT_CAPABILITIES.markdown,
    content,
    savedContent: content,
    status: 'saved',
    editorScrollTop: 0,
    editorSelection: 0,
    revision: {
      mtimeMs: 1,
      size: content.length,
      sha256: 'a'.repeat(64),
      lineEnding: 'LF',
      hasBom: false
    }
  }
}

function renderNavigableMarkdown(content: string, onRevealSource = vi.fn()) {
  return {
    onRevealSource,
    ...render(
      <MarkdownContent
        content={content}
        documentId={fileId}
        fallbackTitle="navigation.md"
        theme="light"
        interactive={false}
        sourceNavigationEnabled
        onRevealSource={onRevealSource}
      />
    )
  }
}

describe('preview-to-source navigation', () => {
  beforeEach(() => {
    useAppStore.setState({
      documents: [],
      activeFileId: null,
      editing: false,
      mobilePane: 'preview'
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('selects exact repeated inline text using AST offsets', () => {
    const content = 'Repeated words.\n\nA unique target after repeated words.'
    const { onRevealSource } = renderNavigableMarkdown(content)

    fireEvent.click(screen.getByText('A unique target after repeated words.'))

    const from = content.indexOf('A unique target')
    expect(onRevealSource).toHaveBeenCalledWith({
      from,
      to: from + 'A unique target after repeated words.'.length,
      exact: true
    })
  })

  it('recovers original offsets after normalized backslash math', () => {
    const content = 'Inline \\(x + 1\\), then exact destination.'
    const { onRevealSource } = renderNavigableMarkdown(content)

    fireEvent.click(screen.getByText(', then exact destination.'))

    const from = content.indexOf(', then exact destination.')
    expect(onRevealSource).toHaveBeenCalledWith({
      from,
      to: from + ', then exact destination.'.length,
      exact: true
    })
  })

  it('uses positioned block fallbacks for transformed and custom content', () => {
    const content = '> [!TIP] Go\n> Body\n\n```txt\ncode\n```'
    const { container, onRevealSource } = renderNavigableMarkdown(content)

    fireEvent.click(screen.getByText('Go'))
    expect(onRevealSource).toHaveBeenLastCalledWith({
      from: 0,
      to: content.indexOf('\n\n'),
      exact: false
    })

    fireEvent.click(container.querySelector('.markdown-code-block')!)
    expect(onRevealSource).toHaveBeenLastCalledWith({
      from: content.indexOf('```txt'),
      to: content.length,
      exact: false
    })
  })

  it('preserves interactive controls and text selection', () => {
    const content = '[Open](#target)\n\nSelectable paragraph.'
    const { onRevealSource } = renderNavigableMarkdown(content)

    fireEvent.click(screen.getByRole('link', { name: 'Open' }))
    expect(onRevealSource).not.toHaveBeenCalled()

    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    fireEvent.click(screen.getByText('Selectable paragraph.'))
    expect(onRevealSource).not.toHaveBeenCalled()
  })

  it('replaces spoofed raw HTML offsets with trusted positions', () => {
    const content = '<mark data-aladdeen-source-start="999" data-aladdeen-source-end="1000">Safe</mark>'
    const { onRevealSource } = renderNavigableMarkdown(content)

    fireEvent.click(screen.getByText('Safe'))

    expect(onRevealSource).toHaveBeenCalledWith({
      from: content.indexOf('Safe'),
      to: content.indexOf('Safe') + 4,
      exact: true
    })
    expect(document.querySelector('[data-aladdeen-source-start="999"]')).toBeNull()
  })

  it('does not annotate or navigate preview-only rendering', () => {
    const onRevealSource = vi.fn<(target: PreviewSourceTarget) => void>()
    const { container } = render(
      <MarkdownContent
        content="Reader mode."
        documentId={fileId}
        fallbackTitle="navigation.md"
        theme="light"
        onRevealSource={onRevealSource}
      />
    )

    fireEvent.click(screen.getByText('Reader mode.'))
    expect(onRevealSource).not.toHaveBeenCalled()
    expect(container.querySelector('[data-aladdeen-source-start]')).toBeNull()
  })

  it('switches compact editing to the editor and records an ephemeral reveal', () => {
    const content = 'First paragraph.\n\nDestination paragraph.'
    const document = openDocument(content)
    useAppStore.setState({
      documents: [document],
      activeFileId: fileId,
      editing: true,
      mobilePane: 'preview'
    })

    render(<MarkdownPreview document={document} />)
    fireEvent.click(screen.getByText('Destination paragraph.'))

    const from = content.indexOf('Destination paragraph.')
    expect(useAppStore.getState()).toMatchObject({
      mobilePane: 'editor',
      documents: [
        {
          editorSelection: from + 'Destination paragraph.'.length,
          editorReveal: {
            from,
            to: from + 'Destination paragraph.'.length,
            select: true,
            origin: 'preview'
          }
        }
      ]
    })
  })

  it('ignores preview reveal requests after Edit mode closes and clamps valid requests', () => {
    const content = 'Short document.'
    const document = openDocument(content)
    useAppStore.setState({
      documents: [document],
      activeFileId: fileId,
      editing: false,
      mobilePane: 'preview'
    })

    act(() => useAppStore.getState().revealPreviewSource(fileId, { from: 3, to: 999, exact: false }))
    expect(useAppStore.getState().documents[0]?.editorReveal).toBeUndefined()

    useAppStore.setState({ editing: true })
    act(() => useAppStore.getState().revealPreviewSource(fileId, { from: 3, to: 999, exact: false }))
    expect(useAppStore.getState().documents[0]).toMatchObject({
      editorSelection: 3,
      editorReveal: {
        from: 3,
        to: content.length,
        select: false,
        origin: 'preview'
      }
    })

    const revealId = useAppStore.getState().documents[0]!.editorReveal!.id
    act(() => useAppStore.getState().updateEditorView(fileId, 240, 12))
    expect(useAppStore.getState().documents[0]?.editorReveal?.id).toBe(revealId)

    act(() => useAppStore.getState().consumeEditorReveal(fileId, revealId + 1))
    expect(useAppStore.getState().documents[0]?.editorReveal?.id).toBe(revealId)

    act(() => useAppStore.getState().consumeEditorReveal(fileId, revealId))
    expect(useAppStore.getState().documents[0]?.editorReveal).toBeUndefined()
  })
})
