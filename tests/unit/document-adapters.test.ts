import { describe, expect, it } from 'vitest'
import {
  defaultExtensionForKind,
  defaultNameForKind,
  DOCUMENT_CAPABILITIES,
  documentKindFromName,
  isSupportedDocumentName
} from '@shared/documents'
import {
  prepareHtmlPreview,
  validateHtmlSource
} from '@renderer/document-adapters/html-preview'

describe('document adapter selection', () => {
  it.each([
    ['notes.md', 'markdown'],
    ['notes.MARKDOWN', 'markdown'],
    ['page.HTML', 'html'],
    ['page.htm', 'html'],
    ['proposal.docx', 'docx'],
    ['proof.PDF', 'pdf'],
    ['budget.XLSX', 'xlsx'],
    ['briefing.PPTX', 'pptx']
  ] as const)('selects %s as %s', (name, kind) => {
    expect(documentKindFromName(name)).toBe(kind)
    expect(isSupportedDocumentName(name)).toBe(true)
  })

  it('rejects deceptive and unsupported filenames', () => {
    expect(documentKindFromName('proposal.docx.exe')).toBeNull()
    expect(documentKindFromName('proof.pdf.txt')).toBeNull()
    expect(isSupportedDocumentName('.pdf')).toBe(true)
    expect(isSupportedDocumentName('README')).toBe(false)
  })

  it('keeps creation defaults aligned with the writable formats', () => {
    expect(defaultNameForKind('markdown')).toBe('Untitled.md')
    expect(defaultNameForKind('html')).toBe('Untitled.html')
    expect(defaultNameForKind('docx')).toBe('Untitled.docx')
    expect(defaultNameForKind('xlsx')).toBe('Untitled.xlsx')
    expect(defaultNameForKind('pptx')).toBe('Untitled.pptx')
    expect(defaultExtensionForKind('docx')).toBe('.docx')
    expect(defaultExtensionForKind('xlsx')).toBe('.xlsx')
    expect(defaultExtensionForKind('pptx')).toBe('.pptx')
  })

  it('advertises only real per-format capabilities', () => {
    expect(DOCUMENT_CAPABILITIES.markdown).toMatchObject({ split: true, exportPdf: true })
    expect(DOCUMENT_CAPABILITIES.html).toMatchObject({ split: true, exportPdf: false })
    expect(DOCUMENT_CAPABILITIES.docx).toMatchObject({ comments: true, trackedChanges: true })
    expect(DOCUMENT_CAPABILITIES.pdf).toMatchObject({ annotations: true, forms: true, pageTools: true })
    expect(DOCUMENT_CAPABILITIES.xlsx).toMatchObject({ edit: true, search: true, pageTools: false })
    expect(DOCUMENT_CAPABILITIES.pptx).toMatchObject({ edit: true, search: true, undoRedo: true })
  })
})

describe('isolated HTML preview', () => {
  it('removes execution, forms, handlers, and remote resources', () => {
    const result = prepareHtmlPreview(`
      <html><head><script>alert(1)</script></head><body>
        <form><input value="secret"></form>
        <img src="https://tracker.example/a.png" onerror="alert(1)">
        <a href="https://example.com">Leave</a>
      </body></html>
    `, '11111111-1111-4111-8111-111111111111')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('<form')
    expect(result).not.toContain('<input')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('https://tracker.example')
    expect(result).not.toMatch(/<a[^>]+href=/)
  })

  it('rewrites only contained relative assets through the opaque protocol', () => {
    const result = prepareHtmlPreview(
      '<link rel="stylesheet" href="./theme.css"><img src="images/photo.png"><img src="/outside.png">',
      '11111111-1111-4111-8111-111111111111'
    )
    expect(result).toContain('aladdeen-asset://document/11111111-1111-4111-8111-111111111111?path=.%2Ftheme.css')
    expect(result).toContain('aladdeen-asset://document/11111111-1111-4111-8111-111111111111?path=images%2Fphoto.png')
    expect(result).not.toContain('/outside.png')
  })

  it('replaces spoofed source attributes with parser-owned offsets', () => {
    const result = prepareHtmlPreview(
      '<p data-aladdeen-source-start="9999" data-aladdeen-source-end="10000">Safe</p>',
      '11111111-1111-4111-8111-111111111111'
    )
    expect(result).not.toContain('data-aladdeen-source-start="9999"')
    expect(result).toContain('data-aladdeen-source-start="0"')
  })

  it('injects an offline CSP and reports malformed source diagnostics', () => {
    const result = prepareHtmlPreview('<p>hello</p>', '11111111-1111-4111-8111-111111111111')
    expect(result).toContain("default-src 'none'")
    expect(result).not.toContain('navigate-to')
    expect(validateHtmlSource('<div><span></div>')).not.toHaveLength(0)
  })
})
