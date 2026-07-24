import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toAssetUrl } from '@shared/path'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'

interface MarkdownImageProps {
  documentId: string
  src?: string
  alt?: string
  title?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
  sourceAttributes?: MarkdownSourceDataAttributes
}

export function MarkdownImage({
  documentId,
  src,
  alt = '',
  title,
  width,
  height,
  loading = 'lazy',
  sourceAttributes
}: MarkdownImageProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  const isRemote = !src || /^(https?:|data:|file:|\/\/)/i.test(src)
  const asset = isRemote ? null : toAssetUrl(documentId, src)
  useEffect(() => setFailed(false), [asset])
  if (!asset || failed) {
    const message = isRemote ? 'Remote image blocked' : 'Image unavailable'
    return (
      <span
        {...sourceAttributes}
        className="inline-flex items-center gap-2 rounded-[7px] border border-dashed border-border-strong bg-surface-muted px-[10px] py-2 text-[12px] text-foreground-muted"
        role="img"
        aria-label={`${message}${alt ? `: ${alt}` : ''}`}
        title={message}
      >
        <ImageOff size={18} aria-hidden="true" />
        <span>{alt || message}</span>
      </span>
    )
  }

  return (
    <img
      {...sourceAttributes}
      src={asset}
      alt={alt}
      title={title}
      width={width}
      height={height}
      loading={loading}
      onError={() => setFailed(true)}
    />
  )
}
