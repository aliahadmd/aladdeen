import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

export function ThinkingTrace({
  content,
  complete
}: {
  content: string
  complete: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!content) return null

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface-muted/55">
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-2 border-0 bg-transparent px-2.5 text-left text-[10px] font-semibold text-foreground-muted hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')}
        />
        <Brain size={12} className="shrink-0" />
        <span>{complete ? 'Thought for a moment' : 'Thinking…'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-[11px] leading-[1.55] whitespace-pre-wrap text-foreground-muted">
          {content}
        </div>
      )}
    </div>
  )
}
