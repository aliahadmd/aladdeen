import { lazy, Suspense, useDeferredValue } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useMediaQuery } from '@renderer/hooks/use-media-query'
import { COMPACT_WORKSPACE_QUERY } from '@renderer/lib/breakpoints'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type { DocumentAdapterProps } from './registry'

const MarkdownEditor = lazy(() => import('@renderer/components/MarkdownEditor').then((module) => ({
  default: module.MarkdownEditor
})))

export function MarkdownDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const editing = useAppStore((state) => state.editing)
  const mobilePane = useAppStore((state) => state.mobilePane)
  const setMobilePane = useAppStore((state) => state.setMobilePane)
  const dark = useEffectiveDarkMode()
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY)
  const content = document.documentKind === 'markdown' ? document.content : ''
  const deferredContent = useDeferredValue(content)

  if (document.documentKind !== 'markdown') return <div />
  const previewDocument = deferredContent === document.content
    ? document
    : { ...document, content: deferredContent }
  const editor = (
    <Suspense fallback={<div className="h-full min-h-0 bg-surface" aria-label="Loading Markdown editor" />}>
      <MarkdownEditor document={document} dark={dark} />
    </Suspense>
  )
  const preview = (
    <MarkdownPreview
      document={previewDocument}
      sourceNavigationReady={deferredContent === document.content}
    />
  )

  return (
    <div className={cn(
      'relative grid h-full min-h-0 min-w-0',
      editing && 'max-[959px]:grid-rows-[35px_minmax(0,1fr)]'
    )}>
      {editing && (
        <div className="compact-pane-switch hidden items-center justify-center gap-0.5 border-b border-border bg-surface max-[959px]:flex" role="tablist" aria-label="Document view">
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'editor'}
            className={cn(
              'h-[25px] rounded-md border-0 bg-transparent px-[14px] text-[11px] font-semibold text-foreground-muted',
              mobilePane === 'editor' && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.08)]'
            )}
            onClick={() => setMobilePane('editor')}
          >
            Editor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === 'preview'}
            className={cn(
              'h-[25px] rounded-md border-0 bg-transparent px-[14px] text-[11px] font-semibold text-foreground-muted',
              mobilePane === 'preview' && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.08)]'
            )}
            onClick={() => setMobilePane('preview')}
          >
            Preview
          </button>
        </div>
      )}

      <div className="h-full min-h-0 min-w-0">
        {editing ? (
          compact ? (
            mobilePane === 'editor' ? editor : preview
          ) : (
            <PanelGroup direction="horizontal" autoSaveId="aladdeen-markdown-split">
              <Panel defaultSize={44} minSize={28} maxSize={70}>{editor}</Panel>
              <PanelResizeHandle className="relative w-px bg-border after:absolute after:inset-y-0 after:left-0 after:z-[2] after:w-[7px] after:content-[''] data-[resize-handle-active]:bg-accent" />
              <Panel defaultSize={56} minSize={30}>{preview}</Panel>
            </PanelGroup>
          )
        ) : preview}
      </div>
    </div>
  )
}

