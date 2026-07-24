import { useMemo, type MouseEvent, type Ref } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import type { PreviewSourceTarget } from '@shared/contracts'
import {
  extractMarkdownMetadata,
  aladdeenMarkdownRehypePlugins,
  aladdeenMarkdownRemarkPlugins,
  prepareMarkdownSourceWithMap,
  rehypeAladdeenSourcePositions,
  type MarkdownSourceDataAttributes
} from '@shared/markdown'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownImage } from './MarkdownImage'

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
  const start = props['data-aladdeen-source-start'] ?? props.dataAladdeenSourceStart
  const end = props['data-aladdeen-source-end'] ?? props.dataAladdeenSourceEnd
  const exact = props['data-aladdeen-source-exact'] ?? props.dataAladdeenSourceExact
  return {
    ...(typeof start === 'number' || typeof start === 'string'
      ? { 'data-aladdeen-source-start': start }
      : {}),
    ...(typeof end === 'number' || typeof end === 'string'
      ? { 'data-aladdeen-source-end': end }
      : {}),
    ...(typeof exact === 'string' ? { 'data-aladdeen-source-exact': exact } : {})
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
            ...aladdeenMarkdownRehypePlugins,
            [
              rehypeAladdeenSourcePositions,
              { preparedContent: prepared.content, sourceMap: prepared.sourceMap }
            ]
          ]
        : aladdeenMarkdownRehypePlugins,
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
            {children}
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
          >
            {children}
          </MarkdownCodeBlock>
        )
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
    const sourceElement = target.closest<HTMLElement>('[data-aladdeen-source-start][data-aladdeen-source-end]')
    if (!sourceElement || !event.currentTarget.contains(sourceElement)) return
    const from = Number(sourceElement.dataset.aladdeenSourceStart)
    const to = Number(sourceElement.dataset.aladdeenSourceEnd)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) return
    onRevealSource({
      from,
      to,
      exact: sourceElement.dataset.aladdeenSourceExact === 'true'
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
        remarkPlugins={aladdeenMarkdownRemarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={safeUrlTransform}
      >
        {prepared.content}
      </ReactMarkdown>
    </article>
  )
}
