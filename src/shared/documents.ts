import type {
  DocumentCapabilities,
  DocumentKind,
  TextDocumentKind
} from './contracts'

export const DOCUMENT_EXTENSIONS = ['md', 'markdown', 'html', 'htm', 'docx', 'pdf', 'xlsx', 'pptx'] as const
export const DOCUMENT_EXTENSION_PATTERN = /\.(?:md|markdown|html?|docx|pdf|xlsx|pptx)$/i
export const MAX_DROPPED_DOCUMENTS = 20
export const DOCUMENT_KINDS = ['markdown', 'html', 'docx', 'pdf', 'xlsx', 'pptx'] as const satisfies readonly DocumentKind[]
export const DEFAULT_PROJECT_DOCUMENT_KINDS = ['markdown'] as const satisfies readonly DocumentKind[]
export const ALL_PROJECT_DOCUMENT_KINDS = [...DOCUMENT_KINDS]

export const DOCUMENT_CAPABILITIES: Record<DocumentKind, DocumentCapabilities> = {
  markdown: {
    edit: true,
    preview: true,
    split: true,
    outline: true,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: true,
    exportDocx: true,
    comments: false,
    trackedChanges: false,
    annotations: false,
    forms: false,
    pageTools: false
  },
  html: {
    edit: true,
    preview: true,
    split: true,
    outline: true,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: false,
    exportDocx: false,
    comments: false,
    trackedChanges: false,
    annotations: false,
    forms: false,
    pageTools: false
  },
  docx: {
    edit: true,
    preview: true,
    split: false,
    outline: true,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: false,
    exportDocx: false,
    comments: true,
    trackedChanges: true,
    annotations: false,
    forms: false,
    pageTools: false
  },
  pdf: {
    edit: true,
    preview: true,
    split: false,
    outline: true,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: false,
    exportDocx: false,
    comments: true,
    trackedChanges: false,
    annotations: true,
    forms: true,
    pageTools: true
  },
  xlsx: {
    edit: true,
    preview: true,
    split: false,
    outline: false,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: false,
    exportDocx: false,
    comments: false,
    trackedChanges: false,
    annotations: false,
    forms: false,
    pageTools: false
  },
  pptx: {
    edit: true,
    preview: true,
    split: false,
    outline: false,
    search: true,
    undoRedo: true,
    save: true,
    saveAs: true,
    exportPdf: false,
    exportDocx: false,
    comments: true,
    trackedChanges: false,
    annotations: false,
    forms: false,
    pageTools: false
  }
}

export function documentKindFromName(name: string): DocumentKind | null {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.html' || extension === '.htm') return 'html'
  if (extension === '.docx') return 'docx'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.xlsx') return 'xlsx'
  if (extension === '.pptx') return 'pptx'
  return null
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value)
}

export function isSupportedDocumentName(name: string): boolean {
  return documentKindFromName(name) !== null
}

export function isTextDocumentKind(kind: DocumentKind): kind is TextDocumentKind {
  return kind === 'markdown' || kind === 'html'
}

export function defaultExtensionForKind(kind: Exclude<DocumentKind, 'pdf'>): string {
  if (kind === 'markdown') return '.md'
  if (kind === 'html') return '.html'
  if (kind === 'docx') return '.docx'
  if (kind === 'xlsx') return '.xlsx'
  return '.pptx'
}

export function defaultNameForKind(kind: Exclude<DocumentKind, 'pdf'>): string {
  if (kind === 'markdown') return 'Untitled.md'
  if (kind === 'html') return 'Untitled.html'
  if (kind === 'docx') return 'Untitled.docx'
  if (kind === 'xlsx') return 'Untitled.xlsx'
  return 'Untitled.pptx'
}
