import { ShieldAlert } from 'lucide-react'
import type { AgentApprovalDecision } from '@shared/contracts'
import type { AgentTranscriptItem } from '@renderer/store/app-store'
import { buttonClasses } from '@renderer/lib/ui-styles'

type ApprovalItem = Extract<AgentTranscriptItem, { kind: 'approval' }>

function previewInput(input: Record<string, unknown>): string {
  const command = input.command
  if (typeof command === 'string') return command
  const path = input.path ?? input.file_path
  if (typeof path === 'string') return path
  return JSON.stringify(input, null, 2)
}

function decisionLabel(decision: AgentApprovalDecision): string {
  if (decision === 'allow') return 'Allowed once'
  if (decision === 'allow-always') return 'Always allowed for this session'
  if (decision === 'deny') return 'Denied'
  return 'Cancelled'
}

export function ApprovalCard({
  item,
  onRespond
}: {
  item: ApprovalItem
  onRespond(decision: 'allow' | 'allow-always' | 'deny'): void
}): React.JSX.Element {
  return (
    <div className="my-3 rounded-xl border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,var(--surface-elevated))] p-3 shadow-[0_7px_22px_rgb(0_0_0/.06)]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-warning">
          <ShieldAlert size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11px] font-bold text-foreground">Approve {item.toolName}</p>
          <p className="mt-0.5 mb-0 text-[9px] leading-[1.45] text-foreground-muted">
            This action can change files or run a command in the active project.
          </p>
        </div>
      </div>
      <pre className="my-2.5 max-h-32 overflow-auto rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-[9px] leading-[1.45] whitespace-pre-wrap text-foreground-soft">
        {previewInput(item.input).slice(0, 4_000)}
      </pre>
      {item.decision ? (
        <p className="m-0 text-[10px] font-semibold text-foreground-muted">{decisionLabel(item.decision)}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={buttonClasses({ variant: 'danger', className: 'h-7 px-2.5 text-[10px]' })}
            onClick={() => onRespond('deny')}
          >
            Deny
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary', className: 'h-7 px-2.5 text-[10px]' })}
            onClick={() => onRespond('allow')}
          >
            Allow
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'primary', className: 'h-7 flex-1 px-2.5 text-[10px]' })}
            onClick={() => onRespond('allow-always')}
          >
            Always allow this session
          </button>
        </div>
      )}
    </div>
  )
}
