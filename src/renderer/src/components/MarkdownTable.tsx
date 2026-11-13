import type { ReactNode, TableHTMLAttributes } from 'react'
import { ExpandedPreview } from './ExpandedPreview'
import { usePreviewOverflow } from '@renderer/hooks/use-preview-overflow'

export function MarkdownTable({ children, interactive = true, ...props }: TableHTMLAttributes<HTMLTableElement> & { children?: ReactNode; interactive?: boolean }): React.JSX.Element {
  const { ref, overflow, left, right, onScroll } = usePreviewOverflow(children)
  return (
    <div className="markdown-table-block">
      {interactive && overflow && <div className="preview-block-toolbar" data-preview-source-ignore="">
        <span>Scroll to see all columns</span>
        <ExpandedPreview title="Table" triggerLabel="Expand table">
          <div className="expanded-table-scroll markdown-body" tabIndex={0} data-preview-scroll="">
            <table {...props}>{children}</table>
          </div>
        </ExpandedPreview>
      </div>}
      <div className="markdown-table-scroll" ref={ref} tabIndex={interactive ? 0 : undefined} onScroll={onScroll} data-overflow-left={left || undefined} data-overflow-right={right || undefined}>
        <table {...props}>{children}</table>
      </div>
    </div>
  )
}
