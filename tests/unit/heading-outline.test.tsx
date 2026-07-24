import { useRef } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeadingOutline } from '@renderer/components/HeadingOutline'
import { MarkdownContent } from '@renderer/components/MarkdownContent'

function OutlineHarness({ content }: { content: string }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)

  return (
    <div className="preview-pane">
      <div ref={scrollRef} className="preview-scroll">
        <MarkdownContent
          articleRef={articleRef}
          content={content}
          documentId="11111111-1111-4111-8111-111111111111"
          fallbackTitle="outline.md"
          theme="light"
          interactive={false}
        />
      </div>
      <HeadingOutline articleRef={articleRef} scrollRef={scrollRef} contentRevision={content} />
    </div>
  )
}

describe('H1 heading outline', () => {
  afterEach(cleanup)

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('lists only parsed Markdown level-one headings', () => {
    render(
      <OutlineHarness
        content={`# First chapter

## Ignored subsection

\`\`\`md
# Ignored code
\`\`\`

Second chapter
==============

<h1>Ignored raw HTML</h1>`}
      />
    )

    const trigger = screen.getByRole('button', { name: '2 level 1 headings' })
    fireEvent.focus(trigger)
    const navigation = screen.getByRole('navigation', { name: 'Level 1 headings' })
    expect(within(navigation).getByRole('button', { name: 'First chapter' })).toBeVisible()
    expect(within(navigation).getByRole('button', { name: 'Second chapter' })).toBeVisible()
    expect(within(navigation).queryByRole('button', { name: 'Ignored subsection' })).toBeNull()
    expect(within(navigation).queryByRole('button', { name: 'Ignored code' })).toBeNull()
    expect(within(navigation).queryByRole('button', { name: 'Ignored raw HTML' })).toBeNull()
  })

  it('navigates by click and supports roving keyboard focus', () => {
    render(<OutlineHarness content={'# Chapter one\n\n# Chapter two\n\n# Chapter three'} />)

    const trigger = screen.getByRole('button', { name: '3 level 1 headings' })
    fireEvent.focus(trigger)
    const navigation = screen.getByRole('navigation', { name: 'Level 1 headings' })
    const first = within(navigation).getByRole('button', { name: 'Chapter one' })
    const second = within(navigation).getByRole('button', { name: 'Chapter two' })
    const third = within(navigation).getByRole('button', { name: 'Chapter three' })

    fireEvent.click(second)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start'
    })

    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: 'End' })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not render a rail when the document has no H1', () => {
    render(<OutlineHarness content={'## A subsection\n\nPlain text.'} />)
    expect(screen.queryByRole('button', { name: /level 1 heading/ })).toBeNull()
  })

  it('compresses the marker rail for heading-heavy documents', () => {
    const content = Array.from({ length: 81 }, (_, index) => `# Chapter ${index + 1}`).join('\n\n')
    const { container } = render(<OutlineHarness content={content} />)
    const trigger = screen.getByRole('button', { name: '81 level 1 headings' })
    expect(trigger).toHaveClass('is-ultra-dense')
    expect(container.querySelectorAll('.heading-outline-marker')).toHaveLength(81)
  })
})
