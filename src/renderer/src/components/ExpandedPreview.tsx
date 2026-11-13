import { useRef, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Maximize2, X } from 'lucide-react'

interface ExpandedPreviewProps {
  title: string
  children: ReactNode
  trigger?: ReactNode
  triggerClassName?: string
  triggerLabel?: string
  onExpand?: () => void
  disabled?: boolean
}

/** A portal keeps expanded content out of the prose width and source-click navigation. */
export function ExpandedPreview({ title, children, trigger, triggerClassName = 'preview-expand', triggerLabel = `Expand ${title.toLowerCase()}`, onExpand, disabled }: ExpandedPreviewProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const readingPosition = useRef<{ element: HTMLElement; top: number; left: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root onOpenChange={(open) => {
      if (open) {
        onExpand?.()
        const element = triggerRef.current?.closest<HTMLElement>('.preview-scroll')
        readingPosition.current = element ? { element, top: element.scrollTop, left: element.scrollLeft } : null
      }
    }}>
      <Dialog.Trigger asChild>
        <button ref={triggerRef} type="button" className={triggerClassName} aria-label={triggerLabel} title={triggerLabel} data-preview-source-ignore="" disabled={disabled}>
          {trigger ?? <Maximize2 size={16} aria-hidden="true" />}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="expanded-preview-overlay" />
        <Dialog.Content
          ref={contentRef}
          className="expanded-preview"
          data-preview-expanded=""
          data-preview-source-ignore=""
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const target = contentRef.current?.querySelector<HTMLElement>('[data-preview-canvas], [data-preview-scroll]')
            target?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const position = readingPosition.current
            if (position?.element.isConnected) {
              position.element.scrollTop = position.top
              position.element.scrollLeft = position.left
            }
            triggerRef.current?.focus({ preventScroll: true })
          }}
          onKeyDown={(event) => {
            // Escape reaches Radix's document listener; other keys belong to the viewer.
            if (event.key !== 'Escape') event.stopPropagation()
          }}
        >
          <header className="expanded-preview-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description className="sr-only">Expanded preview. Press Escape or Close to return to the document.</Dialog.Description>
            <Dialog.Close className="preview-control preview-close" aria-label="Close expanded preview" title="Close (Esc)">
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
