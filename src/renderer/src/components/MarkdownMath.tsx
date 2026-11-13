import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { ExpandedPreview } from './ExpandedPreview'
import { ZoomablePreview } from './ZoomablePreview'
import { usePreviewOverflow } from '@renderer/hooks/use-preview-overflow'

/** Retain KaTeX's HTML + MathML rather than replacing equations with pictures. */
export function MarkdownMath({ children, interactive = true, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode; interactive?: boolean }): React.JSX.Element {
  const { ref, overflow, left, right, onScroll } = usePreviewOverflow<HTMLSpanElement>(children)
  const [size, setSize] = useState({ width: 640, height: 100 })
  const [source, setSource] = useState('')
  return (
    <span className="markdown-math-block">
      {interactive && overflow && <span className="preview-block-toolbar" data-preview-source-ignore="">
        <span>Scroll to see the full equation</span>
        <ExpandedPreview title="Equation" triggerLabel="Expand equation" onExpand={() => {
          const katex = ref.current?.querySelector<HTMLElement>('.katex')
          if (katex) setSize({ width: katex.scrollWidth + 24, height: katex.scrollHeight + 24 })
          setSource(ref.current?.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '')
        }}>
          <ZoomablePreview width={size.width} height={size.height} label="Equation" source={source || undefined}>
            <span {...props} className="expanded-equation katex-display">{children}</span>
          </ZoomablePreview>
        </ExpandedPreview>
      </span>}
      <span className="math-overflow" ref={ref} tabIndex={interactive && overflow ? 0 : undefined} onScroll={onScroll} data-overflow-left={left || undefined} data-overflow-right={right || undefined}>
        <span {...props}>{children}</span>
      </span>
    </span>
  )
}
