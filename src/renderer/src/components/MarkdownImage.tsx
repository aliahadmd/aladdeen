import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toAssetUrl } from '@shared/path'

interface MarkdownImageProps {
  documentId: string
  src?: string
  alt?: string
  title?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
}

export function MarkdownImage({
  documentId,
  src,
  alt = '',
  title,
  width,
  height,
  loading = 'lazy'
}: MarkdownImageProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  const isRemote = !src || /^(https?:|data:|file:|\/\/)/i.test(src)
  const asset = isRemote ? null : toAssetUrl(documentId, src)
  if (!asset || failed) {
    const message = isRemote ? 'Remote image blocked' : 'Image unavailable'
    return (
      <span className="blocked-image" role="img" aria-label={`${message}${alt ? `: ${alt}` : ''}`} title={message}>
        <ImageOff size={18} aria-hidden="true" />
        <span>{alt || message}</span>
      </span>
    )
  }

  return (
    <img
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
