import { useEffect, useRef } from 'react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { AlertTriangle, CircleEllipsis, RefreshCw } from 'lucide-react'
import type { AgentTranscriptItem } from '@renderer/store/app-store'
import { useAppStore } from '@renderer/store/app-store'
import { cn } from '@renderer/lib/cn'
import { AgentEmptyState } from './AgentEmptyState'
import { ApprovalCard } from './ApprovalCard'
import { ThinkingTrace } from './ThinkingTrace'
import { ToolChip } from './ToolChip'

export function UserMessageRow({
  item
}: {
  item: Extract<AgentTranscriptItem, { kind: 'user' }>
}): React.JSX.Element {
  return (
    <div className="my-3 flex justify-end">
      <div className="max-w-[88%] rounded-[13px] rounded-br-[5px] bg-accent px-3 py-2 text-[11px] leading-[1.55] whitespace-pre-wrap text-accent-contrast shadow-[0_4px_14px_color-mix(in_oklab,var(--accent)_18%,transparent)]">
        {item.text}
        {item.steering && (
          <span className="mt-1 block text-[8px] font-semibold tracking-wide opacity-70 uppercase">Steering</span>
        )}
      </div>
    </div>
  )
}

export function AssistantMessage({
  item
}: {
  item: Extract<AgentTranscriptItem, { kind: 'assistant' }>
}): React.JSX.Element {
  return (
    <article className="my-3">
      <ThinkingTrace content={item.thinking} complete={item.complete} />
      {item.text && (
        <div className="text-[11px] leading-[1.62] whitespace-pre-wrap text-foreground-soft">
          {item.text}
        </div>
      )}
      {item.error && (
        <p className="mt-2 mb-0 rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[10px] text-danger">
          {item.error}
        </p>
      )}
      {!item.complete && !item.text && !item.thinking && (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-foreground-muted">
          <CircleEllipsis size={13} className="animate-pulse" /> Responding…
        </span>
      )}
    </article>
  )
}

export function StatusRow({
  item
}: {
  item: Extract<AgentTranscriptItem, { kind: 'status' }>
}): React.JSX.Element {
  const Icon = item.statusType === 'retry'
    ? RefreshCw
    : item.tone === 'danger'
      ? AlertTriangle
      : CircleEllipsis
  return (
    <div className={cn(
      'my-2 flex items-start gap-2 rounded-md border border-border bg-surface-muted/45 px-2.5 py-2 text-[9px] leading-[1.45] text-foreground-muted',
      item.tone === 'warning' && 'border-warning/30 text-warning',
      item.tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger'
    )}>
      <Icon size={12} className="mt-px shrink-0" />
      <span>{item.message}</span>
    </div>
  )
}

export function AgentTranscript({ projectName }: { projectName?: string }): React.JSX.Element {
  const transcript = useAppStore((state) => state.agentTranscript)
  const respond = useAppStore((state) => state.respondAgentApproval)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !stickToBottom.current) return
    viewport.scrollTop = viewport.scrollHeight
  }, [transcript])

  return (
    <ScrollArea.Root className="min-h-0 flex-1 overflow-hidden">
      <ScrollArea.Viewport
        ref={viewportRef}
        className="h-full w-full"
        onScroll={(event) => {
          const viewport = event.currentTarget
          stickToBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48
        }}
      >
        {transcript.length === 0 ? (
          <AgentEmptyState projectName={projectName} />
        ) : (
          <div className="px-3.5 py-2">
            {transcript.map((item) => {
              if (item.kind === 'user') return <UserMessageRow key={item.id} item={item} />
              if (item.kind === 'assistant') return <AssistantMessage key={item.id} item={item} />
              if (item.kind === 'tool') return <ToolChip key={item.id} item={item} />
              if (item.kind === 'approval') {
                return (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    onRespond={(decision) => void respond(item.requestId, decision)}
                  />
                )
              }
              return <StatusRow key={item.id} item={item} />
            })}
          </div>
        )}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        className="flex w-2 touch-none select-none p-0.5"
        orientation="vertical"
      >
        <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
