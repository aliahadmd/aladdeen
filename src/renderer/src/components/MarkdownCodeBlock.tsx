import { Children, isValidElement, type ReactNode } from 'react'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'
import { MermaidDiagram } from './MermaidDiagram'
import { MarkdownMindmap } from './MarkdownMindmap'
import { CodePreview } from './CodePreview'

interface MarkdownCodeBlockProps {
  children?: ReactNode
  theme: 'light' | 'dark'
  sourceAttributes?: MarkdownSourceDataAttributes
  interactive?: boolean
}

interface CodeElementProps {
  children?: ReactNode
  className?: string
}

function reactText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(reactText).join('')
  if (isValidElement<CodeElementProps>(value)) return reactText(value.props.children)
  return ''
}

export function MarkdownCodeBlock({
  children,
  theme,
  sourceAttributes,
  interactive = true
}: MarkdownCodeBlockProps): React.JSX.Element {
  const child = Children.count(children) === 1 ? Children.only(children) : null
  const props = isValidElement<CodeElementProps>(child) ? child.props : {}
  const language = /\blanguage-([\w-]+)\b/.exec(props.className ?? '')?.[1]
  const source = reactText(props.children).replace(/\n$/, '')

  if (language === 'mermaid') {
    return <MermaidDiagram source={source} theme={theme} sourceAttributes={sourceAttributes} interactive={interactive} />
  }
  // A fenced Markdown block is an outline, so offer the mindmap as the default lens
  // and keep the source one click away. MarkdownMindmap falls back to a plain code
  // block when the content has no hierarchy to draw.
  if (language === 'markdown' || language === 'md' || language === 'mkd') {
    return (
      <MarkdownMindmap
        source={source}
        code={children}
        language="Markdown"
        sourceAttributes={sourceAttributes}
        interactive={interactive}
      />
    )
  }
  if (language === 'mermaid-disabled') {
    return (
      <figure
        {...sourceAttributes}
        className="mermaid-diagram mermaid-error"
        data-mermaid-state="error"
      >
        <figcaption>Mermaid diagram limit reached — showing source.</figcaption>
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      </figure>
    )
  }

  return (
    <CodePreview source={source} language={language || 'Plain text'} interactive={interactive} sourceAttributes={sourceAttributes}>{children}</CodePreview>
  )
}
