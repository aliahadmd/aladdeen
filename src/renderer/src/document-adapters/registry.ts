import type { ComponentType } from 'react'
import { lazy } from 'react'
import type {
  DocumentCapabilities,
  DocumentKind,
  OpenDocument
} from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'

export interface DocumentAdapterProps {
  document: OpenDocument
}
export interface DocumentAdapterDefinition {
  kind: DocumentKind
  capabilities: DocumentCapabilities
  component: React.LazyExoticComponent<ComponentType<DocumentAdapterProps>>
}

const MarkdownDocument = lazy(() => import('./MarkdownDocument').then((module) => ({
  default: module.MarkdownDocument
})))
const HtmlDocument = lazy(() => import('./HtmlDocument').then((module) => ({
  default: module.HtmlDocument
})))
const DocxDocument = lazy(() => import('./DocxDocument').then((module) => ({
  default: module.DocxDocument
})))
const PdfDocument = lazy(() => import('./PdfDocument').then((module) => ({
  default: module.PdfDocument
})))

export const DocumentAdapterRegistry: Readonly<Record<DocumentKind, DocumentAdapterDefinition>> = {
  markdown: {
    kind: 'markdown',
    capabilities: DOCUMENT_CAPABILITIES.markdown,
    component: MarkdownDocument
  },
  html: {
    kind: 'html',
    capabilities: DOCUMENT_CAPABILITIES.html,
    component: HtmlDocument
  },
  docx: {
    kind: 'docx',
    capabilities: DOCUMENT_CAPABILITIES.docx,
    component: DocxDocument
  },
  pdf: {
    kind: 'pdf',
    capabilities: DOCUMENT_CAPABILITIES.pdf,
    component: PdfDocument
  }
}
