export interface PreviewSize { width: number; height: number }

export function fitPreview(content: PreviewSize, viewport: PreviewSize): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1
  return Math.min(1, Math.max(1, viewport.width - 48) / content.width, Math.max(1, viewport.height - 48) / content.height)
}

export function clampPreviewZoom(scale: number, fit: number): number {
  return Math.min(8, Math.max(Math.min(0.05, fit), scale))
}

/** Normalize pixel, line, and page deltas; cap a single event without discarding its magnitude. */
export function wheelZoomFactor(delta: number, mode: number, pageHeight: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? Math.max(1, pageHeight) : 1)
  return Math.exp(-Math.max(-240, Math.min(240, pixels)) * Math.log(1.25) / 120)
}

export function previewOrigin(content: PreviewSize, viewport: PreviewSize, scale: number): { x: number; y: number } {
  return {
    x: Math.max(24, (viewport.width - content.width * scale) / 2),
    y: Math.max(24, (viewport.height - content.height * scale) / 2)
  }
}

export function anchoredPreviewScroll(
  content: PreviewSize, viewport: PreviewSize, previousScale: number, nextScale: number,
  scroll: { x: number; y: number }, pointer: { x: number; y: number }
): { x: number; y: number } {
  const before = previewOrigin(content, viewport, previousScale)
  const after = previewOrigin(content, viewport, nextScale)
  return {
    x: (scroll.x + pointer.x - before.x) / previousScale * nextScale + after.x - pointer.x,
    y: (scroll.y + pointer.y - before.y) / previousScale * nextScale + after.y - pointer.y
  }
}
