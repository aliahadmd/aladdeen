import { useMemo, type MouseEvent, type Ref } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import type { PreviewSourceTarget } from '@shared/contracts'
import {
  extractMarkdownMetadata,
  liresearchMarkdownRehypePlugins,
  liresearchMarkdownRemarkPlugins,
  prepareMarkdownSourceWithMap,
  rehypeLiResearchSourcePositions,
  type MarkdownSourceDataAttributes
} from '@shared/markdown'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownImage } from './MarkdownImage'
import { LinkedImageContext } from '@renderer/lib/markdown-context'
import { MarkdownTable } from './MarkdownTable'
import { MarkdownMath } from './MarkdownMath'

interface MarkdownContentProps {
  content: string
  documentId: string
  fallbackTitle: string
  theme: 'light' | 'dark'
  onOpenRelativeDocument?: (target: string) => void
  onOpenExternal?: (target: string) => void
  onRevealSource?: (target: PreviewSourceTarget) => void
  interactive?: boolean
  sourceNavigationEnabled?: boolean
  articleRef?: Ref<HTMLElement>
}

const SOURCE_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-preview-source-ignore]'
].join(',')

function safeUrlTransform(url: string): string {
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  if ((protocol && protocol !== 'http' && protocol !== 'https') || url.startsWith('//')) return ''
  return defaultUrlTransform(url)
}

function sourceDataAttributes(props: Record<string, unknown>): MarkdownSourceDataAttributes {
  const start = props['data-liresearch-source-start'] ?? props.dataLiresearchSourceStart
  const end = props['data-liresearch-source-end'] ?? props.dataLiresearchSourceEnd
  const exact = props['data-liresearch-source-exact'] ?? props.dataLiresearchSourceExact
  return {
    ...(typeof start === 'number' || typeof start === 'string'
      ? { 'data-liresearch-source-start': start }
      : {}),
    ...(typeof end === 'number' || typeof end === 'string'
      ? { 'data-liresearch-source-end': end }
      : {}),
    ...(typeof exact === 'string' ? { 'data-liresearch-source-exact': exact } : {})
  }
}

export function MarkdownContent({
  content,
  documentId,
  fallbackTitle,
  theme,
  onOpenRelativeDocument,
  onOpenExternal,
  onRevealSource,
  interactive = true,
  sourceNavigationEnabled = false,
  articleRef
}: MarkdownContentProps): React.JSX.Element {
  const prepared = useMemo(() => prepareMarkdownSourceWithMap(content), [content])
  const metadata = useMemo(() => extractMarkdownMetadata(content), [content])
  const rehypePlugins = useMemo<PluggableList>(
    () =>
      sourceNavigationEnabled
        ? [
            ...liresearchMarkdownRehypePlugins,
            [
              rehypeLiResearchSourcePositions,
              { preparedContent: prepared.content, sourceMap: prepared.sourceMap }
            ]
          ]
        : liresearchMarkdownRehypePlugins,
    [prepared, sourceNavigationEnabled]
  )

  const components = useMemo<Components>(
    () => ({
      a({ href, children, node: _node, ...props }) {
        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              if (!interactive || !href) return
              if (/^https?:/i.test(href)) {
                event.preventDefault()
                onOpenExternal?.(href)
                return
              }
              if (href.startsWith('#')) {
                event.preventDefault()
                let targetId = href.slice(1)
                try {
                  targetId = decodeURIComponent(targetId)
                } catch {
                  // Use the literal fragment when it contains malformed percent encoding.
                }
                document.getElementById(targetId)?.scrollIntoView({ block: 'start' })
                return
              }
              event.preventDefault()
              let target = href.split('#')[0] ?? ''
              try {
                target = decodeURIComponent(target)
              } catch {
                // The main process still validates an undecodable local path.
              }
              if (/\.(md|markdown)$/i.test(target)) onOpenRelativeDocument?.(target)
            }}
          >
            <LinkedImageContext.Provider value>{children}</LinkedImageContext.Provider>
          </a>
        )
      },
      img({ src, alt, title, width, height, node: _node, ...props }) {
        return (
          <MarkdownImage
            key={`${documentId}:${typeof src === 'string' ? src : 'blocked-image'}`}
            documentId={documentId}
            src={typeof src === 'string' ? src : undefined}
            alt={alt ?? ''}
            title={title}
            width={width}
            height={height}
            loading={interactive ? 'lazy' : 'eager'}
            sourceAttributes={sourceDataAttributes(props as Record<string, unknown>)}
            interactive={interactive}
          />
        )
      },
      input({ type, node: _node, ...props }) {
        return <input {...props} type={type} disabled />
      },
      pre({ children, node: _node, ...props }) {
        return (
          <MarkdownCodeBlock
            theme={theme}
            sourceAttributes={sourceDataAttributes(props as Record<string, unknown>)}
            interactive={interactive}
          >
            {children}
          </MarkdownCodeBlock>
        )
      },
      table({ children, node: _node, ...props }) {
        return (
          <MarkdownTable {...props} interactive={interactive}>{children}</MarkdownTable>
        )
      },
      span({ children, className, node: _node, ...props }) {
        if (className?.split(/\s+/).includes('katex-display')) {
          return <MarkdownMath {...props} className={className} interactive={interactive}>{children}</MarkdownMath>
        }
        return <span {...props} className={className}>{children}</span>
      }
    }),
    [documentId, interactive, onOpenExternal, onOpenRelativeDocument, theme]
  )

  const handleSourceClick = (event: MouseEvent<HTMLElement>): void => {
    if (
      !sourceNavigationEnabled ||
      !onRevealSource ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return
    }
    const target = event.target
    if (!(target instanceof Element) || target.closest(SOURCE_INTERACTIVE_SELECTOR)) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    const sourceElement = target.closest<HTMLElement>('[data-liresearch-source-start][data-liresearch-source-end]')
    if (!sourceElement || !event.currentTarget.contains(sourceElement)) return
    const from = Number(sourceElement.dataset.liresearchSourceStart)
    const to = Number(sourceElement.dataset.liresearchSourceEnd)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) return
    onRevealSource({
      from,
      to,
      exact: sourceElement.dataset.liresearchSourceExact === 'true'
    })
  }

  return (
    <article
      ref={articleRef}
      className={`markdown-body${sourceNavigationEnabled ? ' is-source-navigation-enabled' : ''}`}
      aria-label={metadata?.title || fallbackTitle}
      data-document-title={metadata?.title}
      data-document-author={metadata?.author}
      onClick={handleSourceClick}
    >
      <ReactMarkdown
        remarkPlugins={liresearchMarkdownRemarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={safeUrlTransform}
      >
        {prepared.content}
      </ReactMarkdown>
    </article>
  )
}
