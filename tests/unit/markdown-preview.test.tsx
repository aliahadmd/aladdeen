import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AladdeenApi, OpenDocument } from '@shared/contracts'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'
import { MarkdownImage } from '@renderer/components/MarkdownImage'

const document: OpenDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  environmentId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  relativePath: 'guides/readme.md',
  name: 'readme.md',
  location: 'Docs › guides/readme.md',
  fullPath: '/notes/guides/readme.md',
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
})
