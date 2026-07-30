import { useState } from 'react'
import { Check, ChevronRight, CircleAlert, LoaderCircle, TerminalSquare } from 'lucide-react'
import type { AgentTranscriptItem } from '@renderer/store/app-store'
import { cn } from '@renderer/lib/cn'

type ToolItem = Extract<AgentTranscriptItem, { kind: 'tool' }>

function argumentSummary(item: ToolItem): string {
  const input = item.input
  for (const key of ['command', 'path', 'file_path', 'query', 'pattern']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ').slice(0, 120)
  }
  const first = Object.values(input).find((value) => typeof value === 'string')
  return typeof first === 'string' ? first.replace(/\s+/g, ' ').slice(0, 120) : ''
}

function editSnippet(item: ToolItem): string | undefined {
  if (item.toolName !== 'edit') return undefined
  const before = item.input.oldText ?? item.input.old_string
  const after = item.input.newText ?? item.input.new_string
  if (typeof before !== 'string' || typeof after !== 'string') return undefined
  return `- ${before.slice(0, 500)}\n+ ${after.slice(0, 500)}`
}

export function ToolChip({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = argumentSummary(item)
  const diff = editSnippet(item)
  const hasDetails = Boolean(item.output || diff || Object.keys(item.input).length)

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        className="grid min-h-9 w-full grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-2 border-0 bg-transparent px-2.5 text-left hover:bg-surface-hover"
        aria-expanded={open}
        disabled={!hasDetails}
        onClick={() => setOpen((value) => !value)}
      >
        {item.status === 'running' ? (
          <LoaderCircle size={13} className="spinner text-accent" />
        ) : item.status === 'error' ? (
          <CircleAlert size={13} className="text-danger" />
        ) : (
          <Check size={13} className="text-success" />
        )}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <TerminalSquare size={12} />
            {item.toolName}
          </span>
          {summary && (
            <span className="block overflow-hidden text-[9px] text-ellipsis whitespace-nowrap text-foreground-muted">
              {summary}
            </span>
          )}
        </span>
        {hasDetails && (
          <ChevronRight
            size={12}
            className={cn('text-foreground-muted transition-transform', open && 'rotate-90')}
          />
        )}
      </button>
      {open && (
        <div className="border-t border-border bg-surface-muted/45 p-2.5">
          {diff && (
            <pre className="mb-2 max-h-44 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-[9px] leading-[1.5] whitespace-pre-wrap text-foreground-soft">
              {diff}
            </pre>
          )}
          {item.output ? (
            <pre className="m-0 max-h-52 overflow-auto font-mono text-[9px] leading-[1.5] whitespace-pre-wrap text-foreground-soft">
              {item.output}
            </pre>
          ) : !diff ? (
            <pre className="m-0 max-h-40 overflow-auto font-mono text-[9px] leading-[1.5] whitespace-pre-wrap text-foreground-soft">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          ) : null}
          {item.truncated && <p className="mt-2 mb-0 text-[9px] text-warning">Output was truncated for display.</p>}
        </div>
      )}
    </div>
  )
}
