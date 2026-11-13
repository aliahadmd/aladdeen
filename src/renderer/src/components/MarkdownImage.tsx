import { useContext, useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toAssetUrl } from '@shared/path'
import type { MarkdownSourceDataAttributes } from '@shared/markdown'
import { ExpandedPreview } from './ExpandedPreview'
import { ZoomablePreview } from './ZoomablePreview'
import { LinkedImageContext } from '@renderer/lib/markdown-context'

interface MarkdownImageProps {
  documentId: string
  src?: string
  alt?: string
  title?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
  sourceAttributes?: MarkdownSourceDataAttributes
  interactive?: boolean
}

export function MarkdownImage({
  documentId,
  src,
  alt = '',
  title,
  width,
  height,
  loading = 'lazy',
  sourceAttributes,
  interactive = true
}: MarkdownImageProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const linked = useContext(LinkedImageContext)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  const isRemote = !src || /^(https?:|data:|file:|\/\/)/i.test(src)
  const asset = isRemote ? null : toAssetUrl(documentId, src)
  useEffect(() => { setFailed(false); setSize(null) }, [asset])
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

  const image = (
    <img
      {...sourceAttributes}
      src={asset}
      alt={alt}
      title={title}
      width={width}
      height={height}
      loading={loading}
      onError={() => setFailed(true)}
      onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
    />
  )
  if (!interactive || linked) return image
  return (
    <ExpandedPreview key={asset} title={title || alt || 'Image'} triggerLabel={`Expand image${alt ? `: ${alt}` : ''}`} triggerClassName="markdown-image-trigger" trigger={image} disabled={!size}>
      <ZoomablePreview width={size?.width || 640} height={size?.height || 480} label={alt || title || 'Image'} initialFit>
        <img className="preview-vector-image" src={asset} alt={alt} draggable={false} />
      </ZoomablePreview>
    </ExpandedPreview>
  )
}
