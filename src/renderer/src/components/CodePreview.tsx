import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'
import { copyPreviewText } from '@renderer/lib/clipboard'
import { ExpandedPreview } from './ExpandedPreview'

export function CodePreview({ source, language, children, interactive = true, sourceAttributes }: {
  source: string; language: string; children: ReactNode; interactive?: boolean; sourceAttributes?: MarkdownSourceDataAttributes
}): React.JSX.Element {
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const controls = (
    <span className="code-block-actions" data-preview-source-ignore="">
      <button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} aria-hidden="true" />Wrap</button>
      <button type="button" aria-label={`Copy ${language.toLowerCase()} code`} onClick={() => {
        void copyPreviewText(source).then((ok) => {
          setCopied(ok)
          setCopyError(!ok)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => { setCopied(false); setCopyError(false) }, 1500)
        })
      }}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span role="status">{copied ? 'Copied' : copyError ? 'Copy failed' : 'Copy'}</span></button>
    </span>
  )
  const code = <pre className={wrap ? 'is-wrapped' : undefined}>{children}</pre>
  return (
    <figure {...sourceAttributes} className="markdown-code-block">
      <figcaption className="code-block-toolbar">
        <span>{language}</span>
        {interactive && <span className="code-block-actions">{controls}<ExpandedPreview title={`${language} code`} triggerLabel="Expand code block" triggerClassName="code-expand">
          <div className="expanded-code markdown-code-block">
            <div className="code-block-toolbar">{controls}</div>
            <div className="expanded-code-scroll" tabIndex={0} data-preview-scroll="">{code}</div>
          </div>
        </ExpandedPreview></span>}
      </figcaption>
      {code}
    </figure>
  )
}
