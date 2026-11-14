import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@renderer/components/MarkdownContent'

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

const graph = '```mermaid\nflowchart LR\nExpandedA --> ExpandedB\n```'
const code = '```js\nconst raw = "a long line";\n```'
const table = '| Header one | Header two |\n| --- | --- |\n| First value | Second value |'
const math = '$$\na^2 + b^2 = c^2\n$$'

function preview(content: string, interactive = true, onRevealSource = vi.fn()) {
  return render(<div className="preview-scroll"><MarkdownContent content={content} documentId="11111111-1111-4111-8111-111111111111" fallbackTitle="preview.md" theme="light" interactive={interactive} sourceNavigationEnabled onRevealSource={onRevealSource} /></div>)
}

describe('expanded Markdown blocks', () => {
  beforeEach(() => {
    mermaid.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" id="shared" viewBox="0 0 2400 300"><title>Wide research graph</title><text>Vector labels</text></svg>' })
    mermaid.render.mockClear()
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('expands once-rendered Mermaid, scopes wheel zoom, offers source, and returns focus without source navigation', async () => {
    const reveal = vi.fn()
    const { container } = preview(graph, true, reveal)
    const trigger = await screen.findByRole('button', { name: 'Expand diagram' })
    const scroll = container.querySelector('.preview-scroll')!
    scroll.scrollTop = 320
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Wide research graph' })
    const canvas = dialog.querySelector('[data-preview-canvas]')!
    await waitFor(() => expect(canvas).toHaveFocus())
    expect(within(dialog).getByLabelText('Zoom level')).toHaveTextContent('100%')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }))
    expect(within(dialog).getByLabelText('Zoom level')).toHaveTextContent('125%')
    const wheel = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true })
    act(() => { canvas.dispatchEvent(wheel) })
    expect(wheel.defaultPrevented).toBe(true)
    expect(within(dialog).getByLabelText('Zoom level')).toHaveTextContent('156.3%')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Source' }))
    expect(dialog.querySelector('.preview-source')).toHaveTextContent('ExpandedA --> ExpandedB')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
    fireEvent.keyDown(canvas, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(scroll.scrollTop).toBe(320)
    expect(reveal).not.toHaveBeenCalled()
    expect(mermaid.render).toHaveBeenCalledTimes(1)
    const ordinaryWheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true })
    container.dispatchEvent(ordinaryWheel)
    expect(ordinaryWheel.defaultPrevented).toBe(false)
  })

  it('keeps cached identical SVG IDs unique and closes the viewer when diagram content changes', async () => {
    const view = preview(`${graph}\n\n${graph}`)
    const triggers = await screen.findAllByRole('button', { name: 'Expand diagram' })
    const ids = Array.from(view.container.querySelectorAll('.mermaid-svg [id]'), (element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    fireEvent.click(triggers[0]!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    view.rerender(<MarkdownContent content="A different document" documentId="11111111-1111-4111-8111-111111111111" fallbackTitle="preview.md" theme="light" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('wraps code and copies raw text from the expanded view', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = preview(code)
    fireEvent.click(screen.getByRole('button', { name: 'Wrap' }))
    expect(container.querySelector('pre')).toHaveClass('is-wrapped')
    fireEvent.click(screen.getByRole('button', { name: 'Expand code block' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy js code' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const raw = "a long line";'))
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument()
    expect(dialog.querySelector('pre code')).toHaveTextContent('const raw')
  })

  it('offers table and equation expansion only when they overflow and preserves MathML', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200)
    preview(`${table}\n\n${math}`)
    fireEvent.click(screen.getByRole('button', { name: 'Expand table' }))
    let dialog = await screen.findByRole('dialog', { name: 'Table' })
    expect(within(dialog).getByRole('columnheader', { name: 'Header one' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close expanded preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand equation' }))
    dialog = await screen.findByRole('dialog', { name: 'Equation' })
    expect(dialog.querySelector('math')).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Source' }))
    expect(dialog.querySelector('.preview-source')).toHaveTextContent('a^2 + b^2 = c^2')
  })

  it('expands guarded local images after load and keeps linked images as links', async () => {
    preview('![Figure](./figure.png)\n\n[![Linked figure](./figure.png)](https://example.com)')
    const image = screen.getByAltText('Figure') as HTMLImageElement
    Object.defineProperties(image, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } })
    fireEvent.load(image)
    fireEvent.click(screen.getByRole('button', { name: 'Expand image: Figure' }))
    const dialog = await screen.findByRole('dialog', { name: 'Figure' })
    expect(within(dialog).getByRole('img', { name: 'Figure' })).toHaveAttribute('src', expect.stringContaining('liresearch-asset:'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close expanded preview' }))
    expect(screen.getByRole('link', { name: 'Linked figure' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand image: Linked figure' })).toBeNull()
  })

  it('renders static exports with no viewer controls or dialogs', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200)
    const { container } = preview(`${graph}\n\n${code}\n\n${table}\n\n${math}\n\n![Figure](./figure.png)\n\n\`\`\`md\n# Root\n- Child\n\`\`\``, false)
    await waitFor(() => expect(container.querySelector('[data-mermaid-state="ready"]')).not.toBeNull())
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[data-preview-expanded]')).toBeNull()
    expect(container.querySelector('.mindmap-svg')).not.toBeNull()
    expect(container.querySelector('math')).not.toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
  })
})
