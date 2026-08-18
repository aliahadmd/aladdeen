import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Code2, Download, Maximize2, Scan, Network, ZoomIn, ZoomOut } from 'lucide-react'
import {
  buildMindmap,
  layoutMindmap,
  mindmapLinkPath,
  MINDMAP_BRANCH_COUNT,
  type MindmapLayout
} from '@shared/mindmap'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'

interface MarkdownMindmapProps {
  source: string
  /** The already-highlighted <pre> content, shown when the Code tab is selected. */
  code: ReactNode
  language: string
  sourceAttributes?: MarkdownSourceDataAttributes
}

const FONT_SIZE = 13
const LINE_HEIGHT = 18
/**
 * Must stay character-for-character in sync with `.mindmap-label` in index.css: the
 * layout wraps against this font, so any divergence mis-measures every line. It is a
 * fixed stack rather than var(--reading-font) so a serif reading preference cannot
 * silently change the measurement basis.
 */
const LABEL_FONT = `${FONT_SIZE}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25

const clampZoom = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

/**
 * Text measurement via canvas, which matches what the browser will actually paint.
 * jsdom has no 2d context, so fall back to an average-advance estimate — layout stays
 * deterministic and unit-testable, just less precise.
 */
function createMeasurer(): (value: string) => number {
  let context: CanvasRenderingContext2D | null = null
  try {
    context = document.createElement('canvas').getContext('2d')
    if (context) context.font = LABEL_FONT
  } catch {
    context = null
  }
  return (value: string) => (context ? context.measureText(value).width : value.length * FONT_SIZE * 0.6)
}

export function MarkdownMindmap({
  source,
  code,
  language,
  sourceAttributes
}: MarkdownMindmapProps): React.JSX.Element {
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(1)
  // Auto-fit tracks the pane until the reader zooms deliberately; after that, a pane
  // resize or a fullscreen toggle must not throw their chosen scale away.
  const [autoFit, setAutoFit] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** Content-space point to keep still across a zoom change, with its screen offset. */
  const anchorRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)

  const layout = useMemo<MindmapLayout | null>(() => {
    const root = buildMindmap(source)
    if (!root) return null
    return layoutMindmap(root, { measureText: createMeasurer(), lineHeight: LINE_HEIGHT })
  }, [source])

  const fit = useCallback(() => {
    const container = containerRef.current
    if (!container || !layout) return
    const available = container.clientWidth - 8
    // Only ever scale down: blowing a small diagram up to fill the pane looks broken.
    setZoom(available > 0 && layout.width > available ? available / layout.width : 1)
    setAutoFit(true)
    anchorRef.current = null
  }, [layout])

  /**
   * Zooms about a fixed point so the content under the cursor (or the centre of the
   * viewport) stays put. Without this, zooming shoves the region of interest offscreen.
   */
  const zoomAbout = useCallback((factor: number, client?: { x: number; y: number }) => {
    const container = containerRef.current
    if (!container) return
    const box = container.getBoundingClientRect()
    const offsetX = client ? client.x - box.left : container.clientWidth / 2
    const offsetY = client ? client.y - box.top : container.clientHeight / 2
    setZoom((current) => {
      const next = clampZoom(current * factor)
      if (next !== current) {
        anchorRef.current = {
          x: (container.scrollLeft + offsetX) / current,
          y: (container.scrollTop + offsetY) / current,
          offsetX,
          offsetY
        }
      }
      return next
    })
    setAutoFit(false)
  }, [])

  // Restore the anchor after the browser has laid out the new SVG size.
  useEffect(() => {
    const container = containerRef.current
    const anchor = anchorRef.current
    if (!container || !anchor) return
    anchorRef.current = null
    container.scrollLeft = anchor.x * zoom - anchor.offsetX
    container.scrollTop = anchor.y * zoom - anchor.offsetY
  }, [zoom])

  useEffect(() => {
    if (autoFit) fit()
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (autoFit) fit()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [autoFit, fit, tab])

  // Registered manually because preventDefault needs a non-passive listener.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (event: WheelEvent): void => {
      // Plain wheel keeps scrolling the diagram; only a modifier means "zoom".
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomAbout(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, { x: event.clientX, y: event.clientY })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [zoomAbout, tab])

  const download = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: 'image/svg+xml;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mindmap.svg'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const fullscreen = useCallback(() => {
    const container = containerRef.current?.parentElement
    if (!container) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void container.requestFullscreen?.()
  }, [])

  // Without a hierarchy there is nothing to draw, so stay a plain code block.
  if (!layout) {
    return (
      <figure {...sourceAttributes} className="markdown-code-block">
        <figcaption className="code-block-toolbar">
          <span>{language}</span>
        </figcaption>
        <pre>{code}</pre>
      </figure>
    )
  }

  return (
    <figure {...sourceAttributes} className="markdown-code-block markdown-mindmap">
      <figcaption className="code-block-toolbar">
        <span>{language}</span>
        <span className="mindmap-actions">
          <span className="mindmap-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              onClick={() => zoomAbout(1 / ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom out"
            >
              <ZoomOut size={13} aria-hidden="true" />
            </button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              onClick={() => zoomAbout(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in"
            >
              <ZoomIn size={13} aria-hidden="true" />
            </button>
          </span>
          <button type="button" onClick={fullscreen} aria-label="Show the mindmap fullscreen">
            <Maximize2 size={13} aria-hidden="true" />
            <span>Fullscreen</span>
          </button>
          <button type="button" onClick={download} aria-label="Download the mindmap as SVG">
            <Download size={13} aria-hidden="true" />
            <span>Download</span>
          </button>
          <button
            type="button"
            onClick={fit}
            aria-label="Fit the mindmap to the available width"
            data-active={autoFit ? 'true' : undefined}
          >
            <Scan size={13} aria-hidden="true" />
            <span>Fit</span>
          </button>
          <span className="mindmap-tabs" role="group" aria-label="Mindmap view">
            <button
              type="button"
              onClick={() => setTab('code')}
              aria-pressed={tab === 'code'}
              data-active={tab === 'code' ? 'true' : undefined}
            >
              <Code2 size={13} aria-hidden="true" />
              <span>Code</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              aria-pressed={tab === 'preview'}
              data-active={tab === 'preview' ? 'true' : undefined}
            >
              <Network size={13} aria-hidden="true" />
              <span>Preview</span>
            </button>
          </span>
        </span>
      </figcaption>
      {tab === 'code' ? (
        <pre>{code}</pre>
      ) : (
        <div
          className="mindmap-canvas"
          ref={containerRef}
          tabIndex={0}
          role="group"
          aria-label="Mindmap, scrollable. Press plus or minus to zoom, 0 to fit."
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return
            if (event.key === '+' || event.key === '=') {
              event.preventDefault()
              zoomAbout(ZOOM_STEP)
            } else if (event.key === '-' || event.key === '_') {
              event.preventDefault()
              zoomAbout(1 / ZOOM_STEP)
            } else if (event.key === '0') {
              event.preventDefault()
              fit()
            }
          }}
        >
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            className="mindmap-svg"
            role="img"
            aria-label={`Mindmap of ${layout.nodes[0]?.text || 'the document outline'}`}
            width={layout.width * zoom}
            height={layout.height * zoom}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
            <g className="mindmap-links">
              {layout.links.map((link) => (
                <path
                  key={link.id}
                  d={mindmapLinkPath(link)}
                  fill="none"
                  className={`mindmap-link mindmap-branch-${link.branch % MINDMAP_BRANCH_COUNT}`}
                />
              ))}
            </g>
            <g className="mindmap-nodes">
              {layout.nodes.map((node) => (
                <g key={node.id} className={`mindmap-node mindmap-branch-${node.branch % MINDMAP_BRANCH_COUNT}`}>
                  {node.text ? (
                    <line
                      className="mindmap-underline"
                      x1={node.x}
                      y1={node.y + node.height}
                      x2={node.x + node.width}
                      y2={node.y + node.height}
                    />
                  ) : null}
                  <text className="mindmap-label" x={node.x} y={node.y}>
                    {node.lines.map((line, index) => (
                      <tspan key={index} x={node.x} dy={index === 0 ? FONT_SIZE : LINE_HEIGHT}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <circle
                    className="mindmap-dot"
                    cx={node.children.length > 0 ? node.x + node.width : node.x}
                    cy={node.y + node.height}
                    r={node.depth === 0 ? 4 : 3}
                  />
                </g>
              ))}
            </g>
          </svg>
        </div>
      )}
    </figure>
  )
}
