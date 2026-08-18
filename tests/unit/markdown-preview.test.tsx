import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AladdeenApi, TextOpenDocument } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'
import { MarkdownImage } from '@renderer/components/MarkdownImage'
import { useAppStore } from '@renderer/store/app-store'

const document: TextOpenDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  environmentId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  relativePath: 'guides/readme.md',
  name: 'readme.md',
  location: 'Docs › guides/readme.md',
  fullPath: '/notes/guides/readme.md',
  documentKind: 'markdown',
  encoding: 'utf-8',
  capabilities: DOCUMENT_CAPABILITIES.markdown,
  content: '# Hello\n\n- [x] Offline\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Local](../images/cover.png)\n\n![Remote](https://example.com/a.png)\n\n<script>alert(1)</script>',
  savedContent: '',
  status: 'saved',
  revision: { mtimeMs: 1, size: 1, sha256: 'a'.repeat(64), lineEnding: 'LF', hasBom: false },
  editorScrollTop: 0,
  editorSelection: 0
}

describe('Markdown preview', () => {
  it('renders GFM, rewrites local assets, and blocks remote images and raw HTML', () => {
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { system: { openExternal: vi.fn() } } as unknown as AladdeenApi
    })
    const { container } = render(<MarkdownPreview document={document} />)

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByAltText('Local')).toHaveAttribute(
      'src',
      'aladdeen-asset://document/11111111-1111-4111-8111-111111111111?path=..%2Fimages%2Fcover.png'
    )
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
  })

  it('gives every table a keyboard-scrollable container so wide tables scroll instead of collapsing', () => {
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { system: { openExternal: vi.fn() } } as unknown as AladdeenApi
    })
    const { container } = render(<MarkdownPreview document={document} />)

    // Scoped to this render's container: the suite keeps earlier renders mounted.
    const table = container.querySelector<HTMLElement>('table')
    const scroller = container.querySelector<HTMLElement>('.markdown-table-scroll')
    expect(table).not.toBeNull()
    expect(scroller).not.toBeNull()
    // The table must be inside the scroller: without an element that can overflow,
    // a wide table is compressed into the reading column instead of scrolling.
    expect(scroller).toContainElement(table)
    expect(scroller).toHaveAttribute('tabindex', '0')
    // An unnamed ARIA region around every table would add a nameless landmark.
    expect(scroller).not.toHaveAttribute('role')
  })

  it('clears a local-image failure when the document or source changes', () => {
    const view = render(<MarkdownImage documentId="first-document" src="./missing.png" alt="First" />)
    fireEvent.error(screen.getByAltText('First'))
    expect(screen.getByRole('img', { name: 'Image unavailable: First' })).toBeInTheDocument()

    view.rerender(<MarkdownImage documentId="second-document" src="./available.png" alt="Second" />)
    expect(screen.getByAltText('Second')).toHaveAttribute(
      'src',
      'aladdeen-asset://document/second-document?path=.%2Favailable.png'
    )
  })

  it('applies Markdown-only reading preferences and preserves relative scroll progress', () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        readingFont: 'iowan',
        readingFontSize: 18,
        readingLineHeight: 'relaxed',
        readingColumnWidth: 'wide',
        readingSurface: 'sage'
      }
    }))
    const { container } = render(<MarkdownPreview document={document} />)
    const scroll = container.querySelector<HTMLElement>('.preview-scroll')
    expect(scroll).not.toBeNull()
    expect(scroll).toHaveAttribute('data-reading-font', 'iowan')
    expect(scroll).toHaveAttribute('data-reading-line-height', 'relaxed')
    expect(scroll).toHaveAttribute('data-reading-column-width', 'wide')
    expect(scroll).toHaveAttribute('data-reading-surface', 'sage')
    expect(scroll?.style.getPropertyValue('--reading-font-size')).toBe('18px')
    expect(scroll?.style.getPropertyValue('--reading-line-height')).toBe('1.9')
    expect(scroll?.style.getPropertyValue('--reading-column-width')).toBe('960px')

    let scrollHeight = 1_000
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 })
    if (scroll) scroll.scrollTop = 450
    fireEvent.scroll(scroll!)

    scrollHeight = 1_900
    act(() => {
      useAppStore.setState((state) => ({
        settings: { ...state.settings, readingFontSize: 19 }
      }))
    })
    expect(scroll?.scrollTop).toBe(900)
  })
})
