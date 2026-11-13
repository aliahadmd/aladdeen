import { useCallback, useLayoutEffect, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Code2, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { anchoredPreviewScroll, clampPreviewZoom, fitPreview, previewOrigin, wheelZoomFactor, type PreviewSize } from '@renderer/lib/preview-geometry'

interface ZoomablePreviewProps extends PreviewSize {
  children: ReactNode
  label: string
  source?: string
  initialFit?: boolean
}

export function ZoomablePreview({ width, height, label, source, initialFit = false, children }: ZoomablePreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<PreviewSize>({ width: 0, height: 0 })
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)
  const autoFit = useRef(initialFit)
  const [showSource, setShowSource] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const pendingScroll = useRef<{ x: number; y: number } | null>(null)
  const content = { width, height }
  const fitted = fitPreview(content, viewport)

  const changeScale = useCallback((next: number, pointer?: { x: number; y: number }, fit = false): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const size = { width: canvas.clientWidth, height: canvas.clientHeight }
    const bounded = clampPreviewZoom(next, fitPreview({ width, height }, size))
    pendingScroll.current = fit ? { x: 0, y: 0 } : anchoredPreviewScroll(
      { width, height }, size, scaleRef.current, bounded,
      { x: canvas.scrollLeft, y: canvas.scrollTop },
      pointer ?? { x: size.width / 2, y: size.height / 2 }
    )
    autoFit.current = fit
    scaleRef.current = bounded
    setScale(bounded)
    if (fit) { canvas.scrollLeft = 0; canvas.scrollTop = 0 }
  }, [width, height])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const measure = (): void => {
      if (!canvas.clientWidth || !canvas.clientHeight) return
      const size = { width: canvas.clientWidth, height: canvas.clientHeight }
      setViewport(size)
      if (autoFit.current) changeScale(fitPreview({ width, height }, size), undefined, true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [width, height, changeScale])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const position = pendingScroll.current
    if (!canvas || !position) return
    canvas.scrollLeft = position.x
    canvas.scrollTop = position.y
    pendingScroll.current = null
  }, [scale, viewport])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheel = (event: WheelEvent): void => {
      if (showSource || event.deltaY === 0) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      changeScale(scaleRef.current * wheelZoomFactor(event.deltaY, event.deltaMode, canvas.clientHeight), {
        x: event.clientX - rect.left, y: event.clientY - rect.top
      })
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [changeScale, showSource])

  const pan = (x: number, y: number): void => {
    const canvas = canvasRef.current
    if (canvas) { canvas.scrollLeft += x; canvas.scrollTop += y }
  }
  const origin = previewOrigin(content, viewport, scale)

  return (
    <div className="visual-preview">
      <div className="preview-toolbar" role="group" aria-label="Preview controls">
        <div className="preview-control-group" hidden={showSource}>
          <button type="button" className="preview-control" aria-label="Zoom out" disabled={scale <= Math.min(0.05, fitted)} onClick={() => changeScale(scaleRef.current / 1.25)}><ZoomOut size={16} /></button>
          <output className="preview-scale" aria-label="Zoom level">{Math.round(scale * 1000) / 10}%</output>
          <button type="button" className="preview-control" aria-label="Zoom in" disabled={scale >= 8} onClick={() => changeScale(scaleRef.current * 1.25)}><ZoomIn size={16} /></button>
          <button type="button" className="preview-control" onClick={() => changeScale(1)}>100%</button>
          <button type="button" className="preview-control" onClick={() => changeScale(fitted, undefined, true)}><Scan size={16} /> Fit</button>
        </div>
        {source !== undefined && <button type="button" className="preview-control" onClick={() => setShowSource(!showSource)}><Code2 size={16} />{showSource ? 'Preview' : 'Source'}</button>}
        <span className="preview-gesture-hint" hidden={showSource}>Scroll to zoom · Drag to pan</span>
      </div>
      <div
        ref={canvasRef}
        className="preview-canvas"
        data-preview-canvas=""
        data-dragging={dragging || undefined}
        tabIndex={0}
        role="region"
        aria-label={`${label}. Scroll to zoom, drag or use arrow keys to pan. Plus and minus zoom; 0 fits.`}
        hidden={showSource}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return
          if (event.key === '+' || event.key === '=') changeScale(scaleRef.current * 1.25)
          else if (event.key === '-' || event.key === '_') changeScale(scaleRef.current / 1.25)
          else if (event.key === '0') changeScale(fitted, undefined, true)
          else if (event.key === '1') changeScale(1)
          else if (event.key === 'ArrowLeft') pan(-80, 0)
          else if (event.key === 'ArrowRight') pan(80, 0)
          else if (event.key === 'ArrowUp') pan(0, -80)
          else if (event.key === 'ArrowDown') pan(0, 80)
          else return
          event.preventDefault()
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          event.currentTarget.focus({ preventScroll: true })
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.id !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX
          event.currentTarget.scrollTop = start.top + start.y - event.clientY
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return
          drag.current = null
          setDragging(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}
      >
        <div className="preview-plane" style={{ width: Math.max(viewport.width, width * scale + 48), height: Math.max(viewport.height, height * scale + 48) }}>
          <div className="preview-visual" style={{ width, height, left: origin.x, top: origin.y, transform: `scale(${scale})` }}>{children}</div>
        </div>
      </div>
      {showSource && <pre className="preview-source" tabIndex={0} data-preview-scroll=""><code>{source}</code></pre>}
      <div className="preview-pan-controls" role="group" aria-label="Pan preview" hidden={showSource}>
        <button type="button" className="preview-control" aria-label="Pan left" onClick={() => pan(-120, 0)}><ArrowLeft size={16} /></button>
        <button type="button" className="preview-control" aria-label="Pan up" onClick={() => pan(0, -120)}><ArrowUp size={16} /></button>
        <button type="button" className="preview-control" aria-label="Pan down" onClick={() => pan(0, 120)}><ArrowDown size={16} /></button>
        <button type="button" className="preview-control" aria-label="Pan right" onClick={() => pan(120, 0)}><ArrowRight size={16} /></button>
      </div>
    </div>
  )
}
