import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'

interface MermaidDiagramProps {
  source: string
  theme: 'light' | 'dark'
  sourceAttributes?: MarkdownSourceDataAttributes
}

interface MermaidResult {
  svg?: string
  error?: string
}

const diagramCache = new Map<string, MermaidResult>()
let renderSequence = 0
let renderQueue = Promise.resolve()

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
        suppressErrorRendering: true
      })
      const id = `aladdeen-mermaid-${renderSequence++}`
      const rendered = await mermaid.render(id, source)
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

export function MermaidDiagram({
  source,
  theme,
  sourceAttributes
}: MermaidDiagramProps): React.JSX.Element {
  const [result, setResult] = useState<MermaidResult>({})

  useEffect(() => {
    let cancelled = false
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
  }, [source, theme])

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

  if (!result.svg) {
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
      <div
        className="mermaid-svg"
        role="img"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    </figure>
  )
}
