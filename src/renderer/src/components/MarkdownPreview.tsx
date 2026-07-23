import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ImageOff } from 'lucide-react'
import type { OpenDocument } from '@shared/contracts'
import { toAssetUrl } from '@shared/path'
import { useAppStore } from '@renderer/store/app-store'

export function MarkdownPreview({ document }: { document: OpenDocument }): React.JSX.Element {
  const openRelativeDocument = useAppStore((state) => state.openRelativeDocument)

  return (
    <div className="preview-scroll">
      <article className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true }]]}
          skipHtml
          components={{
            a({ href, children, ...props }) {
              return (
                <a
                  {...props}
                  href={href}
                  onClick={(event) => {
                    if (!href) return
                    if (/^(https?:|mailto:)/i.test(href)) {
                      event.preventDefault()
                      void window.fluidmd.system.openExternal(href)
                      return
                    }
                    if (href.startsWith('#')) return
                    const target = href.split('#')[0] ?? ''
                    if (/\.(md|markdown)$/i.test(target)) {
                      event.preventDefault()
                      void openRelativeDocument(document.id, target)
                    }
                  }}
                >
                  {children}
                </a>
              )
            },
            img({ src, alt }) {
              if (!src || /^(https?:|data:|file:)/i.test(src)) {
                return (
                  <span className="blocked-image" title="Remote images stay offline">
                    <ImageOff size={18} />
                    <span>{alt || 'Remote image blocked'}</span>
                  </span>
                )
              }
              const asset = toAssetUrl(document.id, src)
              return asset ? <img src={asset} alt={alt ?? ''} loading="lazy" /> : null
            },
            input({ type, ...props }) {
              return <input {...props} type={type} disabled={type === 'checkbox' || props.disabled} />
            }
          }}
        >
          {document.content}
        </ReactMarkdown>
      </article>
    </div>
  )
}
