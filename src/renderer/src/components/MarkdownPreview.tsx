import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { TextOpenDocument } from '@shared/contracts'
import { READING_COLUMN_WIDTH_VALUES, READING_LINE_HEIGHT_VALUES } from '@shared/reading'
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
  const readingFont = useAppStore((state) => state.settings.readingFont)
  const readingFontSize = useAppStore((state) => state.settings.readingFontSize)
  const readingLineHeight = useAppStore((state) => state.settings.readingLineHeight)
  const readingColumnWidth = useAppStore((state) => state.settings.readingColumnWidth)
  const readingSurface = useAppStore((state) => state.settings.readingSurface)
  const dark = useEffectiveDarkMode()
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const scrollProgressRef = useRef(0)
  const readingStateRef = useRef({ documentId: document.id, signature: '' })
  const readingSignature = `${readingFont}:${readingFontSize}:${readingLineHeight}:${readingColumnWidth}:${readingSurface}`

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return
    scrollElement.scrollTop = getPreviewScroll(document.id)
    const maximumScroll = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
    scrollProgressRef.current = maximumScroll > 0 ? scrollElement.scrollTop / maximumScroll : 0
  }, [document.id, getPreviewScroll])

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    const previous = readingStateRef.current
    readingStateRef.current = { documentId: document.id, signature: readingSignature }
    if (!scrollElement || previous.documentId !== document.id || !previous.signature || previous.signature === readingSignature) return

    const nextScrollTop = scrollProgressRef.current * Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
    scrollElement.scrollTop = nextScrollTop
    updatePreviewScroll(document.id, nextScrollTop)
  }, [document.id, readingSignature, updatePreviewScroll])

  return (
    <div className="preview-pane relative h-full min-h-0 min-w-0 [container-type:inline-size]">
      <div
        ref={scrollRef}
        className="preview-scroll reading-surface h-full select-text overflow-auto"
        data-reading-font={readingFont}
        data-reading-line-height={readingLineHeight}
        data-reading-column-width={readingColumnWidth}
        data-reading-surface={readingSurface}
        style={{
          '--reading-font-size': `${readingFontSize}px`,
          '--reading-line-height': READING_LINE_HEIGHT_VALUES[readingLineHeight],
          '--reading-column-width': `${READING_COLUMN_WIDTH_VALUES[readingColumnWidth]}px`
        } as CSSProperties}
        onScroll={(event) => {
          const scrollElement = event.currentTarget
          const maximumScroll = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
          scrollProgressRef.current = maximumScroll > 0 ? scrollElement.scrollTop / maximumScroll : 0
          updatePreviewScroll(document.id, scrollElement.scrollTop)
        }}
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
