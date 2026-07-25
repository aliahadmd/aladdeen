import { useLayoutEffect, useRef } from 'react'
import type { TextOpenDocument } from '@shared/contracts'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useAppStore } from '@renderer/store/app-store'
import { HeadingOutline } from './HeadingOutline'
import { MarkdownContent } from './MarkdownContent'

export function MarkdownPreview({
  document,
  sourceNavigationReady = true
}: {
  document: TextOpenDocument
  sourceNavigationReady?: boolean
}): React.JSX.Element {
  const openRelativeDocument = useAppStore((state) => state.openRelativeDocument)
  const editing = useAppStore((state) => state.editing)
  const revealPreviewSource = useAppStore((state) => state.revealPreviewSource)
  const updatePreviewScroll = useAppStore((state) => state.updatePreviewScroll)
  const getPreviewScroll = useAppStore((state) => state.getPreviewScroll)
  const dark = useEffectiveDarkMode()
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = getPreviewScroll(document.id)
  }, [document.id, getPreviewScroll])

  return (
    <div className="preview-pane relative h-full min-h-0 min-w-0 [container-type:inline-size]">
      <div
        ref={scrollRef}
        className="preview-scroll h-full select-text overflow-auto bg-surface-elevated"
        onScroll={(event) => updatePreviewScroll(document.id, event.currentTarget.scrollTop)}
      >
        <MarkdownContent
          articleRef={articleRef}
          content={document.content}
          documentId={document.id}
          fallbackTitle={document.name}
          theme={dark ? 'dark' : 'light'}
          onOpenExternal={(target) => void window.aladdeen.system.openExternal(target)}
          onOpenRelativeDocument={(target) => void openRelativeDocument(document.id, target)}
          onRevealSource={(target) => revealPreviewSource(document.id, target)}
          sourceNavigationEnabled={editing && sourceNavigationReady}
        />
      </div>
      <HeadingOutline
        articleRef={articleRef}
        scrollRef={scrollRef}
        contentRevision={document.content}
      />
    </div>
  )
}
