import { describe, expect, it } from 'vitest'
import { anchoredPreviewScroll, clampPreviewZoom, fitPreview, previewOrigin, wheelZoomFactor } from '@renderer/lib/preview-geometry'
import { preparePreviewSvg } from '@renderer/lib/preview-svg'

describe('expanded preview geometry', () => {
  it('fits both axes without upscaling small figures', () => {
    expect(fitPreview({ width: 200, height: 100 }, { width: 800, height: 600 })).toBe(1)
    expect(fitPreview({ width: 2000, height: 100 }, { width: 800, height: 600 })).toBeCloseTo(752 / 2000)
    expect(fitPreview({ width: 200, height: 2000 }, { width: 800, height: 600 })).toBeCloseTo(552 / 2000)
  })

  it('preserves the content point beneath the cursor across zoom and centered margins', () => {
    const content = { width: 1000, height: 400 }
    const viewport = { width: 800, height: 600 }
    const pointer = { x: 200, y: 240 }
    const scroll = { x: 100, y: 0 }
    const before = previewOrigin(content, viewport, 1)
    const after = previewOrigin(content, viewport, 2)
    const next = anchoredPreviewScroll(content, viewport, 1, 2, scroll, pointer)
    expect((next.x + pointer.x - after.x) / 2).toBeCloseTo(scroll.x + pointer.x - before.x)
    expect((next.y + pointer.y - after.y) / 2).toBeCloseTo(scroll.y + pointer.y - before.y)
  })

  it('normalizes wheel units, respects small deltas, and bounds large events', () => {
    expect(wheelZoomFactor(-16, 0, 600)).toBeCloseTo(wheelZoomFactor(-1, 1, 600))
    expect(wheelZoomFactor(-1, 2, 120)).toBeCloseTo(wheelZoomFactor(-120, 0, 600))
    expect(wheelZoomFactor(-2, 0, 600)).toBeLessThan(wheelZoomFactor(-120, 0, 600))
    expect(wheelZoomFactor(-120, 0, 600)).toBeCloseTo(1.25)
    expect(wheelZoomFactor(-10000, 0, 600)).toBeLessThan(2)
  })

  it('allows huge graphs to fit below 5% without jumping on the next wheel event', () => {
    const fit = 0.004
    expect(clampPreviewZoom(fit * 1.01, fit)).toBeCloseTo(fit * 1.01)
    expect(clampPreviewZoom(0.001, fit)).toBe(fit)
    expect(clampPreviewZoom(50, fit)).toBe(8)
  })
})

describe('cached SVG instances', () => {
  it('namespaces identifiers, marker URLs, style selectors and accessible relationships independently', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" id="graph" viewBox="0 0 2400 300" aria-labelledby="title" aria-describedby="description"><title id="title">A wide diagram</title><desc id="description">A connects to B</desc><style>#graph .edge{marker-end:url(#arrow)}</style><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/><a href="#title"/></svg>'
    const a = preparePreviewSvg(source, 'a')
    const b = preparePreviewSvg(source, 'b')
    expect(a).toMatchObject({ width: 2400, height: 300, title: 'A wide diagram', description: 'A connects to B' })
    const parsed = new DOMParser().parseFromString(a.markup, 'image/svg+xml')
    expect(parsed.documentElement.id).toBe('a-0')
    expect(parsed.documentElement.getAttribute('aria-labelledby')).toBe('a-1')
    expect(parsed.documentElement.getAttribute('aria-describedby')).toBe('a-2')
    expect(parsed.querySelector('path')?.getAttribute('marker-end')).toBe('url(#a-3)')
    expect(parsed.querySelector('a')?.getAttribute('href')).toBe('#a-1')
    expect(parsed.querySelector('style')?.textContent).toContain('#a-0 .edge{marker-end:url(#a-3)}')
    expect(b.markup).not.toContain('a-0')
    expect(b.markup).toContain('b-0')
  })
})
