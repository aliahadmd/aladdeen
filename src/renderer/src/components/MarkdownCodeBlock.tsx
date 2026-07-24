import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'
import { MermaidDiagram } from './MermaidDiagram'

interface MarkdownCodeBlockProps {
  children?: ReactNode
  theme: 'light' | 'dark'
  sourceAttributes?: MarkdownSourceDataAttributes
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

function copyWithSelection(value: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

async function copyCode(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return copyWithSelection(value)
  }
}

export function MarkdownCodeBlock({
  children,
  theme,
  sourceAttributes
}: MarkdownCodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  const child = Children.count(children) === 1 ? Children.only(children) : null
  const props = isValidElement<CodeElementProps>(child) ? child.props : {}
  const language = /\blanguage-([\w-]+)\b/.exec(props.className ?? '')?.[1]
  const source = reactText(props.children).replace(/\n$/, '')

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    },
    []
  )

  if (language === 'mermaid') {
    return <MermaidDiagram source={source} theme={theme} sourceAttributes={sourceAttributes} />
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

  const handleCopy = async (): Promise<void> => {
    if (!(await copyCode(source))) return
    setCopied(true)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <figure {...sourceAttributes} className="markdown-code-block">
      <figcaption className="code-block-toolbar">
        <span>{language || 'Plain text'}</span>
        <button type="button" onClick={() => void handleCopy()} aria-label={`Copy ${language || 'plain text'} code`}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre>{children}</pre>
    </figure>
  )
}
