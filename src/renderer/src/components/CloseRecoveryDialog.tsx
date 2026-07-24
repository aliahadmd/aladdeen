import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, Copy, RefreshCw, Trash2 } from 'lucide-react'
import type { CloseRequest } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  buttonClasses,
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogIconClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'

interface CloseRecoveryDialogProps {
  request: CloseRequest | null
  onRetry(): Promise<void>
  onSaveCopy(): Promise<void>
  onDiscard(): Promise<void>
  onCancel(): Promise<void>
}

const recoveryOptionClasses =
  'grid min-h-[48px] w-full grid-cols-[20px_minmax(0,1fr)] items-start gap-[9px] rounded-[9px] border border-border bg-surface p-[10px] text-left text-foreground-soft hover:border-accent-muted hover:bg-accent-soft disabled:cursor-wait disabled:opacity-50'

export function CloseRecoveryDialog({
  request,
  onRetry,
  onSaveCopy,
  onDiscard,
  onCancel
}: CloseRecoveryDialogProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const action = request?.reason === 'quit' ? 'quit' : request?.reason === 'reload' ? 'reload' : 'close'
  const actionProgressive = action === 'quit' ? 'quitting' : action === 'reload' ? 'reloading' : 'closing'

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root open={Boolean(request)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClasses} />
        <AlertDialog.Content
          className={cn(dialogContentClasses, 'w-[min(calc(100vw-32px),470px)]')}
          aria-busy={busy}
        >
          <div className={dialogIconClasses('warning')}>
            <AlertTriangle size={19} />
          </div>
          <AlertDialog.Title className={dialogTitleClasses}>Some edits could not be saved</AlertDialog.Title>
          <AlertDialog.Description className={dialogDescriptionClasses}>
            Aladdeen kept the window open. Retry the original files, save recoverable copies elsewhere,
            or explicitly discard the unsaved edits before {actionProgressive}.
          </AlertDialog.Description>
          <div className="mt-[18px] grid gap-[7px]">
            <button className={recoveryOptionClasses} disabled={busy} onClick={() => void run(onRetry)}>
              <RefreshCw size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-foreground">Retry save</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Try writing every edited document again.</small>
              </span>
            </button>
            <button className={recoveryOptionClasses} disabled={busy} onClick={() => void run(onSaveCopy)}>
              <Copy size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-foreground">Save copies and {action}</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Choose safe locations for edited documents, then continue.</small>
              </span>
            </button>
            <button
              className={cn(recoveryOptionClasses, 'text-danger hover:border-danger hover:bg-danger-soft')}
              disabled={busy}
              onClick={() => void run(onDiscard)}
            >
              <Trash2 size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-danger">Discard edits and {action}</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Continue without saving the remaining in-memory edits.</small>
              </span>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button className={buttonClasses({ variant: 'secondary' })} disabled={busy} onClick={() => void run(onCancel)}>
              Keep editing
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
