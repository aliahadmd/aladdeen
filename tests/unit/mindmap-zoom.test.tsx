import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownMindmap } from '@renderer/components/MarkdownMindmap'

const outline = [
  '# Project',
  '',
  '## Prime directives',
  '1. Apply by op_id, or it does not sync.',
  '2. Never mix vector spaces.',
  '',
  '## Commands',
  '- pnpm build'
].join('\n')

function renderMindmap() {
  const view = render(
    <MarkdownMindmap source={outline} code={<code>{outline}</code>} language="Markdown" />
  )
  const figure = view.container.querySelector('.markdown-mindmap') as HTMLElement
  const canvas = figure.querySelector('.mindmap-canvas') as HTMLElement
  return { ...view, figure, canvas }
}

const zoomPercent = (figure: HTMLElement): string =>
  figure.querySelector('output')?.textContent ?? ''

describe('mindmap zoom', () => {
  it('zooms in and out in steps and reports the current scale', () => {
    const { figure } = renderMindmap()
    expect(zoomPercent(figure)).toBe('100%')

    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom in' }))
    expect(zoomPercent(figure)).toBe('125%')

    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom in' }))
    expect(zoomPercent(figure)).toBe('156%')

    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom out' }))
    expect(zoomPercent(figure)).toBe('125%')
  })

  it('clamps zoom and disables the control at each limit', () => {
    const { figure } = renderMindmap()
    const zoomIn = within(figure).getByRole('button', { name: 'Zoom in' })
    const zoomOut = within(figure).getByRole('button', { name: 'Zoom out' })

    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomIn)
    expect(zoomPercent(figure)).toBe('400%')
    expect(zoomIn).toBeDisabled()

    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomOut)
    expect(zoomPercent(figure)).toBe('25%')
    expect(zoomOut).toBeDisabled()
  })

  it('scales the rendered SVG while keeping the viewBox fixed, so text stays vector', () => {
    const { figure } = renderMindmap()
    // Not `querySelector('svg')`: the toolbar's icons are SVGs and come first.
    const svg = figure.querySelector('.mindmap-svg') as SVGSVGElement
    const viewBox = svg.getAttribute('viewBox')
    const before = Number(svg.getAttribute('width'))

    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom in' }))

    expect(Number(svg.getAttribute('width'))).toBeCloseTo(before * 1.25, 4)
    expect(svg.getAttribute('viewBox')).toBe(viewBox)
  })

  it('stops auto-fitting once the reader zooms, so a resize cannot discard their scale', () => {
    const { figure, canvas } = renderMindmap()
    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom in' }))
    expect(zoomPercent(figure)).toBe('125%')

    // Simulate the pane getting narrower: fit() would otherwise scale to width.
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 200 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(zoomPercent(figure)).toBe('125%')
  })

  it('returns to fit-to-width on the Fit control', () => {
    const { figure } = renderMindmap()
    fireEvent.click(within(figure).getByRole('button', { name: 'Zoom in' }))
    expect(zoomPercent(figure)).toBe('125%')

    fireEvent.click(within(figure).getByRole('button', { name: /fit/i }))
    expect(zoomPercent(figure)).toBe('100%')
  })

  it('supports keyboard zoom on the focusable canvas', () => {
    const { figure, canvas } = renderMindmap()
    expect(canvas).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(canvas, { key: '+' })
    expect(zoomPercent(figure)).toBe('125%')

    fireEvent.keyDown(canvas, { key: '-' })
    expect(zoomPercent(figure)).toBe('100%')

    fireEvent.keyDown(canvas, { key: '+' })
    fireEvent.keyDown(canvas, { key: '0' })
    expect(zoomPercent(figure)).toBe('100%')
  })

  it('leaves plain wheel scrolling alone and only zooms with a modifier', () => {
    const { figure, canvas } = renderMindmap()

    // Dispatched raw rather than via fireEvent so defaultPrevented can be inspected;
    // act() is therefore needed explicitly for React to flush the state update.
    const plain = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
    act(() => {
      canvas.dispatchEvent(plain)
    })
    expect(zoomPercent(figure)).toBe('100%')
    expect(plain.defaultPrevented).toBe(false)

    const withModifier = new WheelEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    act(() => {
      canvas.dispatchEvent(withModifier)
    })
    expect(zoomPercent(figure)).toBe('125%')
    // Prevented so the surrounding document does not also scroll or page-zoom.
    expect(withModifier.defaultPrevented).toBe(true)
  })

  it('keeps the zoom controls out of the Code tab', () => {
    const { figure } = renderMindmap()
    fireEvent.click(within(figure).getByRole('button', { name: /code/i }))

    expect(figure.querySelector('.mindmap-canvas')).toBeNull()
    expect(figure.querySelector('pre code')).not.toBeNull()
    // The toolbar control stays mounted, so scale survives a round trip to Code.
    expect(zoomPercent(figure)).toBe('100%')
  })

  it('labels the canvas so the zoom shortcuts are discoverable', () => {
    const { canvas } = renderMindmap()
    expect(canvas).toHaveAccessibleName(/press plus or minus to zoom/i)
    expect(screen.getAllByRole('group', { name: 'Zoom' }).length).toBeGreaterThan(0)
  })
})
