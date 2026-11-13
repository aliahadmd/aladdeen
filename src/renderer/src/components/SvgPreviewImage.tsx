import { useEffect, useState } from 'react'

/** Image context isolates SVG IDs/CSS from the inline diagram and keeps zoom vector-sharp. */
export function SvgPreviewImage({ markup, label }: { markup: string; label: string }): React.JSX.Element | null {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') {
      setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)
      return
    }
    const next = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [markup])
  return url ? <img className="preview-vector-image" src={url} alt={label} draggable={false} /> : null
}
