import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AladdeenApi } from '@shared/contracts'
import {
  extractMarkdownMetadata,
  prepareMarkdownSource
} from '@shared/markdown'
import { MarkdownContent } from '@renderer/components/MarkdownContent'

function renderMarkdown(content: string) {
  return render(
    <MarkdownContent
      content={content}
      documentId="11111111-1111-4111-8111-111111111111"
      fallbackTitle="fixture.md"
      theme="light"
      onOpenExternal={(target) => void window.aladdeen.system.openExternal(target)}
    />
  )
}

describe('extended Markdown compatibility', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { system: { openExternal: vi.fn() } } as unknown as AladdeenApi
    })
  })

  it('extracts known YAML and TOML metadata and ignores malformed input', () => {
    expect(
      extractMarkdownMetadata(
        '---\ntitle: Test\nauthor: Ali\ntags: [one, two]\ndraft: false\n---\n\n# Body'
      )
    ).toEqual({
      title: 'Test',
      author: 'Ali',
      date: undefined,
      tags: ['one', 'two'],
      version: undefined,
      draft: false
    })
    expect(extractMarkdownMetadata('+++\ntitle = "TOML"\ntags = ["one"]\n+++\nBody')?.title).toBe('TOML')
    expect(extractMarkdownMetadata('---\ntitle: [broken\n---\nBody')).toBeNull()
  })

  it('normalizes backslash math without changing code', () => {
    const source = 'Math \\(x + 1\\).\n\n`code \\(not math\\)`\n\n```\n\\[not math\\]\n```'
    const prepared = prepareMarkdownSource(source)
    expect(prepared).toContain('Math $x + 1$.')
    expect(prepared).toContain('`code \\(not math\\)`')
    expect(prepared).toContain('\\[not math\\]')
  })

  it('hides frontmatter, builds one nested TOC, and assigns stable duplicate slugs', () => {
    const { container } = renderMarkdown(
      '---\ntitle: Compatibility\n---\n\n# Title\n\n[TOC]\n\n[[toc]]\n\n## Repeat\n\n### Repeat\n\n## Repeat'
    )
    expect(screen.queryByText('title: Compatibility')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAccessibleName('Compatibility')
    expect(container.querySelectorAll('.markdown-toc')).toHaveLength(1)
    const toc = container.querySelector('.markdown-toc')!
    expect(within(toc as HTMLElement).getAllByRole('link')).toHaveLength(3)
    expect(container.querySelector('#md-repeat')).toBeInTheDocument()
    expect(container.querySelector('#md-repeat-1')).toBeInTheDocument()
    expect(container.querySelector('#md-repeat-2')).toBeInTheDocument()
  })

  it('renders definition lists, callouts, math, safe HTML, and footnotes', () => {
    const { container } = renderMarkdown(`
Term
: Definition

> [!SUCCESS] Complete
> Saved locally.

Inline \\(x^2\\).

\\[
y = 2
\\]

\`\`\`math
z = 3
\`\`\`

<details open><summary>More</summary>H<sub>2</sub>O<br>Next</details>

Footnote.[^one]

[^one]: Footnote body.
`)
    expect(container.querySelector('dl')).toBeInTheDocument()
    expect(container.querySelector('.callout-tip')).toHaveAccessibleName('Complete')
    expect(container.querySelectorAll('.katex')).toHaveLength(3)
    expect(screen.getByText('More')).toBeInTheDocument()
    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('section[data-footnotes]')).toBeInTheDocument()
    expect(container.querySelector('.sr-only')).toHaveTextContent('Footnotes')
  })

  it('sanitizes hostile HTML and URLs while preserving the semantic allowlist', () => {
    const { container } = renderMarkdown(`
<mark onclick="alert(1)" style="position:fixed">Safe text</mark>
[unsafe](javascript:alert\\(1\\))
[mail](mailto:test@example.com)
<iframe src="https://example.com"></iframe>
<script>alert("no")</script>
<svg onload="alert(1)"><circle /></svg>
<input type="text" value="interactive">
`)
    expect(container.querySelector('mark')).toHaveTextContent('Safe text')
    expect(container.querySelector('mark')).not.toHaveAttribute('onclick')
    expect(container.querySelector('mark')).not.toHaveAttribute('style')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('unsafe').closest('a')).not.toHaveAttribute('href')
    expect(screen.getByText('mail').closest('a')).not.toHaveAttribute('href')
    expect(container.querySelector('input')).toBeNull()
  })

  it('blocks remote images, preserves local dimensions, and prevents unhandled navigation', () => {
    const openExternal = vi.mocked(window.aladdeen.system.openExternal)
    const { container } = renderMarkdown(`
![Remote](https://example.com/image.png)
<img src="./local.png" alt="Local" width="320" height="180">
[Website](https://example.com)
[Other](./notes.txt)
`)
    expect(screen.getByLabelText('Remote image blocked: Remote')).toBeInTheDocument()
    const localImage = screen.getByAltText('Local')
    expect(localImage).toHaveAttribute('width', '320')
    expect(localImage).toHaveAttribute('height', '180')
    fireEvent.error(localImage)
    expect(screen.getByLabelText('Image unavailable: Local')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Website' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    fireEvent.click(screen.getByRole('link', { name: 'Other' }))
    expect(container.querySelector('a[href="./notes.txt"]')).toBeInTheDocument()
  })

  it('adds automatic directionality while respecting explicit RTL', () => {
    const { container } = renderMarkdown('English paragraph.\n\n<bdo dir="rtl">العربية</bdo>')
    expect(screen.getByText('English paragraph.')).toHaveAttribute('dir', 'auto')
    expect(container.querySelector('bdo')).toHaveAttribute('dir', 'rtl')
  })
})
