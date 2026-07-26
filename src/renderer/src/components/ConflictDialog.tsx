import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Copy, DownloadCloud, GitMerge, UploadCloud } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import {
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogIconClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'

const conflictOptionClasses =
  'grid grid-cols-[22px_minmax(0,1fr)] items-start gap-[9px] rounded-[9px] border border-border bg-surface p-[10px] text-left text-foreground-soft hover:border-accent-muted hover:bg-accent-soft'

export function ConflictDialog(): React.JSX.Element {
  const conflictFileIds = useAppStore((state) => state.conflictFileIds)
  const documents = useAppStore((state) => state.documents)
  const resolveConflict = useAppStore((state) => state.resolveConflict)
  const conflictPath = conflictFileIds[0]
  const document = documents.find((candidate) => candidate.id === conflictPath)

  return (
    <AlertDialog.Root open={Boolean(conflictPath)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClasses} />
        <AlertDialog.Content className={cn(dialogContentClasses, 'conflict-dialog w-[min(calc(100vw-32px),450px)]')}>
          <div className={dialogIconClasses('warning')}>
            <GitMerge size={19} />
          </div>
          <AlertDialog.Title className={dialogTitleClasses}>{document?.name ?? 'This file'} changed on disk</AlertDialog.Title>
          <AlertDialog.Description className={dialogDescriptionClasses}>
            Aladdeen paused autosave so neither version is lost. Choose which copy should become the active document.
            {conflictFileIds.length > 1 && ` ${conflictFileIds.length - 1} more conflicted ${conflictFileIds.length === 2 ? 'document is' : 'documents are'} waiting.`}
          </AlertDialog.Description>
          <div className="mt-[18px] grid gap-[7px]">
            <button className={conflictOptionClasses} onClick={() => void resolveConflict('reload')}>
              <DownloadCloud size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-foreground">Reload external</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Discard local edits and use the file on disk.</small>
              </span>
            </button>
            <button className={conflictOptionClasses} onClick={() => void resolveConflict('keep')}>
              <UploadCloud size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-foreground">Keep mine</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Overwrite the external change with this tab.</small>
              </span>
            </button>
            <button className={conflictOptionClasses} onClick={() => void resolveConflict('copy')}>
              <Copy size={17} />
              <span>
                <strong className="mb-0.5 block text-[12px] text-foreground">Save local copy</strong>
                <small className="block text-[10px] leading-[1.4] text-foreground-muted">Save your edits elsewhere, then reload disk.</small>
              </span>
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
