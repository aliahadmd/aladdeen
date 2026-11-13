import { useEffect, useId, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'
import { preparePreviewSvg } from '@renderer/lib/preview-svg'
import { ExpandedPreview } from './ExpandedPreview'
import { ZoomablePreview } from './ZoomablePreview'
import { SvgPreviewImage } from './SvgPreviewImage'

interface MermaidDiagramProps {
  source: string
  theme: 'light' | 'dark'
  sourceAttributes?: MarkdownSourceDataAttributes
  interactive?: boolean
}

interface MermaidResult {
  svg?: string
  error?: string
}

const diagramCache = new Map<string, MermaidResult>()
let renderSequence = 0
let renderQueue = Promise.resolve()
const MERMAID_RENDER_TIMEOUT_MS = 10_000

function hasUnsafeCssReference(value: string): boolean {
  if (/@import|expression\s*\(/i.test(value)) return true
  for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!match[2]?.trim().startsWith('#')) return true
  }
  return false
}

function sanitizeMermaidSvg(source: string): string {
  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script']
  })
  const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) throw new Error('The generated diagram was not valid SVG.')
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) element.removeAttribute(attribute.name)
      if ((name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#')) {
        element.removeAttribute(attribute.name)
      }
      if (hasUnsafeCssReference(attribute.value)) element.removeAttribute(attribute.name)
    }
  }
  for (const style of parsed.querySelectorAll('style')) {
    if (hasUnsafeCssReference(style.textContent ?? '')) style.remove()
  }
  for (const image of parsed.querySelectorAll('image')) image.remove()
  return new XMLSerializer().serializeToString(parsed.documentElement)
}

async function renderMermaid(source: string, theme: 'light' | 'dark'): Promise<MermaidResult> {
  if (new TextEncoder().encode(source).byteLength > 100_000) {
    return { error: 'Diagram source exceeds the 100 KB safety limit.' }
  }
  if (/%%\s*\{[\s\S]*?themeCSS/i.test(source)) {
    return { error: 'Custom Mermaid CSS is not supported.' }
  }
  const cacheKey = `${theme}\0${source}`
  const cached = diagramCache.get(cacheKey)
  if (cached) return cached

  const execute = async (): Promise<MermaidResult> => {
    try {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'neutral',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        maxTextSize: 100_000,
        secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'themeCSS'],
        suppressErrorRendering: true
      })
      const id = `aladdeen-mermaid-${renderSequence++}`
      const rendered = await withDeadline(
        mermaid.render(id, source),
        MERMAID_RENDER_TIMEOUT_MS,
        'The diagram took too long to render.'
      )
      const result = { svg: sanitizeMermaidSvg(rendered.svg) }
      diagramCache.set(cacheKey, result)
      if (diagramCache.size > 80) diagramCache.delete(diagramCache.keys().next().value as string)
      return result
    } catch (error) {
      const result = {
        error: error instanceof Error ? error.message.split('\n')[0] : 'Mermaid could not render this diagram.'
      }
      diagramCache.set(cacheKey, result)
      return result
    }
  }

  const pending = renderQueue.then(execute, execute)
  renderQueue = pending.then(
    () => undefined,
    () => undefined
  )
  return pending
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function MermaidDiagram({
  source,
  theme,
  sourceAttributes,
  interactive = true
}: MermaidDiagramProps): React.JSX.Element {
  const instance = useId().replace(/:/g, '')
  const cacheKey = `${theme}\0${source}`
  const [result, setResult] = useState<MermaidResult>(() => diagramCache.get(cacheKey) ?? {})
  const svg = useMemo(() => result.svg ? preparePreviewSvg(result.svg, `diagram-${instance}`) : null, [result.svg, instance])

  useEffect(() => {
    let cancelled = false
    const cached = diagramCache.get(cacheKey)
    if (cached) {
      setResult(cached)
      return
    }
    setResult({})
    const timer = window.setTimeout(() => {
      void renderMermaid(source, theme).then((next) => {
        if (!cancelled) setResult(next)
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cacheKey, source, theme])

  if (result.error) {
    return (
      <figure
        {...sourceAttributes}
        className="mermaid-diagram mermaid-error"
        data-mermaid-state="error"
      >
        <figcaption>Mermaid diagram unavailable — {result.error}</figcaption>
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      </figure>
    )
  }

  if (!svg) {
    return (
      <figure
        {...sourceAttributes}
        className="mermaid-diagram mermaid-loading"
        data-mermaid-state="loading"
        aria-busy="true"
      >
        <figcaption>Rendering Mermaid diagram…</figcaption>
      </figure>
    )
  }

  return (
    <figure {...sourceAttributes} className="mermaid-diagram" data-mermaid-state="ready">
      {interactive && <div className="diagram-toolbar" data-preview-source-ignore="">
        <span>Mermaid</span>
        <ExpandedPreview key={cacheKey} title={svg.title} triggerLabel="Expand diagram">
          <ZoomablePreview width={svg.width} height={svg.height} label={svg.title} source={source}>
            <SvgPreviewImage markup={svg.markup} label={svg.description || svg.title} />
          </ZoomablePreview>
        </ExpandedPreview>
      </div>}
      <div
        className="mermaid-svg"
        role="img"
        aria-label={svg.title}
        aria-description={svg.description || undefined}
        dangerouslySetInnerHTML={{ __html: svg.markup }}
      />
    </figure>
  )
}
