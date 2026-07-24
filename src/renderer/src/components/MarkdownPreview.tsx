import type { OpenDocument } from '@shared/contracts'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useAppStore } from '@renderer/store/app-store'
import { MarkdownContent } from './MarkdownContent'

export function MarkdownPreview({ document }: { document: OpenDocument }): React.JSX.Element {
  const openRelativeDocument = useAppStore((state) => state.openRelativeDocument)
  const dark = useEffectiveDarkMode()

  return (
    <div className="preview-scroll">
      <MarkdownContent
        content={document.content}
        documentId={document.id}
        fallbackTitle={document.name}
        theme={dark ? 'dark' : 'light'}
        onOpenExternal={(target) => void window.fluidmd.system.openExternal(target)}
        onOpenRelativeDocument={(target) => void openRelativeDocument(document.id, target)}
      />
    </div>
  )
}
