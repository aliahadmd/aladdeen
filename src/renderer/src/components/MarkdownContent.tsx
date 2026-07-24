import { useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import {
  extractMarkdownMetadata,
  fluidMarkdownRehypePlugins,
  fluidMarkdownRemarkPlugins,
  prepareMarkdownSource
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
  interactive?: boolean
}

function safeUrlTransform(url: string): string {
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  if ((protocol && protocol !== 'http' && protocol !== 'https') || url.startsWith('//')) return ''
  return defaultUrlTransform(url)
}

export function MarkdownContent({
  content,
  documentId,
  fallbackTitle,
  theme,
  onOpenRelativeDocument,
  onOpenExternal,
  interactive = true
}: MarkdownContentProps): React.JSX.Element {
  const prepared = useMemo(() => prepareMarkdownSource(content), [content])
  const metadata = useMemo(() => extractMarkdownMetadata(content), [content])

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
      img({ src, alt, title, width, height }) {
        return (
          <MarkdownImage
            key={typeof src === 'string' ? src : 'blocked-image'}
            documentId={documentId}
            src={typeof src === 'string' ? src : undefined}
            alt={alt ?? ''}
            title={title}
            width={width}
            height={height}
            loading={interactive ? 'lazy' : 'eager'}
          />
        )
      },
      input({ type, node: _node, ...props }) {
        return <input {...props} type={type} disabled />
      },
      pre({ children }) {
        return <MarkdownCodeBlock theme={theme}>{children}</MarkdownCodeBlock>
      }
    }),
    [documentId, interactive, onOpenExternal, onOpenRelativeDocument, theme]
  )

  return (
    <article
      className="markdown-body"
      aria-label={metadata?.title || fallbackTitle}
      data-document-title={metadata?.title}
      data-document-author={metadata?.author}
    >
      <ReactMarkdown
        remarkPlugins={fluidMarkdownRemarkPlugins}
        rehypePlugins={fluidMarkdownRehypePlugins}
        components={components}
        urlTransform={safeUrlTransform}
      >
        {prepared}
      </ReactMarkdown>
    </article>
  )
}
