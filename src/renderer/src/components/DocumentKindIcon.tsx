import { FileCode2, FileText, FileType2, PanelsTopLeft } from 'lucide-react'
import type { DocumentKind } from '@shared/contracts'

export function DocumentKindIcon({
  kind,
  size = 14,
  className
}: {
  kind?: DocumentKind
  size?: number
  className?: string
}): React.JSX.Element {
  if (kind === 'html') return <FileCode2 className={className} size={size} />
  if (kind === 'docx') return <FileType2 className={className} size={size} />
  if (kind === 'pdf') return <PanelsTopLeft className={className} size={size} />
  return <FileText className={className} size={size} />
}
