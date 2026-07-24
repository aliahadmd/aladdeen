import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@renderer/components/MarkdownContent'

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn()
}))

vi.mock('mermaid', () => ({
  default: mermaidMocks
}))

function diagram(source = 'flowchart LR\nA --> B') {
  return render(
    <MarkdownContent
      content={`\`\`\`mermaid\n${source}\n\`\`\``}
      documentId="11111111-1111-4111-8111-111111111111"
      fallbackTitle="diagram.md"
      theme="dark"
    />
  )
}

describe('Mermaid diagrams', () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockReset()
    mermaidMocks.render.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders in strict mode and sanitizes the generated SVG', async () => {
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg onload="alert(1)"><style>@import url("https://example.com/evil.css")</style><a href="https://example.com"><text>Safe diagram</text></a><rect style="fill:url(https://example.com/a.svg)" filter="url(#safe)"/><image href="https://example.com/a.png"/><foreignObject>bad</foreignObject><script>bad</script></svg>'
    })
    const { container } = diagram()

    expect(screen.getByText('Rendering Mermaid diagram…')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        htmlLabels: false,
        startOnLoad: false,
        theme: 'dark'
      })
    )
    expect(container.querySelector('.mermaid-svg text')).toHaveTextContent('Safe diagram')
    expect(container.querySelector('.mermaid-svg script')).toBeNull()
    expect(container.querySelector('.mermaid-svg foreignObject')).toBeNull()
    expect(container.querySelector('.mermaid-svg image')).toBeNull()
    expect(container.querySelector('.mermaid-svg [onload]')).toBeNull()
    expect(container.querySelector('.mermaid-svg [href]')).toBeNull()
    expect(container.querySelector('.mermaid-svg style')).toBeNull()
    expect(container.querySelector('.mermaid-svg rect')).not.toHaveAttribute('style')
    expect(container.querySelector('.mermaid-svg rect')).toHaveAttribute('filter', 'url(#safe)')
  })

  it('shows selectable source when Mermaid rejects a diagram', async () => {
    mermaidMocks.render.mockRejectedValue(new Error('Parse error on line 1'))
    diagram('not a diagram')

    await waitFor(() => expect(screen.getByText(/Mermaid diagram unavailable/)).toBeInTheDocument())
    expect(screen.getByText('not a diagram')).toBeInTheDocument()
  })

  it('falls back after the fiftieth diagram', () => {
    const content = Array.from(
      { length: 51 },
      (_, index) => `\`\`\`mermaid\nflowchart LR\nA${index} --> B${index}\n\`\`\``
    ).join('\n\n')
    const { container } = render(
      <MarkdownContent
        content={content}
        documentId="11111111-1111-4111-8111-111111111111"
        fallbackTitle="many.md"
        theme="light"
      />
    )
    expect(container.querySelectorAll('.mermaid-error')).toHaveLength(1)
    expect(screen.getByText(/Mermaid diagram limit reached/)).toBeInTheDocument()
  })
})
