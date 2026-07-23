import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Copy, DownloadCloud, GitMerge, UploadCloud } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

export function ConflictDialog(): React.JSX.Element {
  const conflictPath = useAppStore((state) => state.conflictFileId)
  const documents = useAppStore((state) => state.documents)
  const resolveConflict = useAppStore((state) => state.resolveConflict)
  const document = documents.find((candidate) => candidate.id === conflictPath)

  return (
    <AlertDialog.Root open={Boolean(conflictPath)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content conflict-dialog">
          <div className="dialog-icon warning">
            <GitMerge size={19} />
          </div>
          <AlertDialog.Title className="dialog-title">{document?.name ?? 'This file'} changed on disk</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">
            FluidMD paused autosave so neither version is lost. Choose which copy should become the active document.
          </AlertDialog.Description>
          <div className="conflict-options">
            <button onClick={() => void resolveConflict('reload')}>
              <DownloadCloud size={17} />
              <span>
                <strong>Reload external</strong>
                <small>Discard local edits and use the file on disk.</small>
              </span>
            </button>
            <button onClick={() => void resolveConflict('keep')}>
              <UploadCloud size={17} />
              <span>
                <strong>Keep mine</strong>
                <small>Overwrite the external change with this tab.</small>
              </span>
            </button>
            <button onClick={() => void resolveConflict('copy')}>
              <Copy size={17} />
              <span>
                <strong>Save local copy</strong>
                <small>Save your edits elsewhere, then reload disk.</small>
              </span>
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
