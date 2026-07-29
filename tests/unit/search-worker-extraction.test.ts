// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  extractDocxText,
  extractPptxText,
  extractPresentationEntries,
  extractSpreadsheetCells,
  extractTextForKind,
  extractXlsxText,
  mapExtractedSourceRange
} from '@main/services/search-worker'
import { workbookToBytes } from '@office-kit/xlsx/io'
import { setFormula } from '@office-kit/xlsx/cell'
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook'
import { setCell } from '@office-kit/xlsx/worksheet'

describe('search worker text extraction', () => {
  it('maps decoded HTML entities back to their complete source ranges', () => {
    const source = '<p>A &amp; B &#x1f680;</p>'
    const extracted = extractTextForKind(source, 'html')
    expect(extracted.content).toContain('A & B 🚀')

    const ampersand = extracted.content.indexOf('&')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      ampersand,
      ampersand + 1
    )).toEqual({
      start: source.indexOf('&amp;'),
      end: source.indexOf('&amp;') + '&amp;'.length
    })

    const rocket = extracted.content.indexOf('🚀')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      rocket,
      rocket + '🚀'.length
    )).toEqual({
      start: source.indexOf('&#x1f680;'),
      end: source.indexOf('&#x1f680;') + '&#x1f680;'.length
    })
  })

  it('keeps ordinary visible HTML text on linear source offsets', () => {
    const source = '<div>ordinary text</div>'
    const extracted = extractTextForKind(source, 'html')
    const start = extracted.content.indexOf('text')
    expect(mapExtractedSourceRange(
      extracted.sourceSegments ?? [],
      start,
      start + 4
    )).toEqual({ start: source.indexOf('text'), end: source.indexOf('text') + 4 })
  })

  it('streams the searchable DOCX part through the bounded extractor', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Bounded Word search</w:t></w:r></w:p></w:body></w:document>'
      )
    })
    expect(extractDocxText(Buffer.from(archive))?.content).toContain('Bounded Word search')
  })

  it('extracts XLSX values and formulas with exact sheet and A1 locators', async () => {
    const workbook = createWorkbook()
    const worksheet = addWorksheet(workbook, 'Forecast')
    setCell(worksheet, 1, 1, 'Revenue')
    const formula = setCell(worksheet, 2, 3, null)
    setFormula(formula, 'SUM(A1:A2)', { cachedValue: 99 })

    const extracted = await extractXlsxText(Buffer.from(await workbookToBytes(workbook)))
    expect(extracted?.content).toContain('Revenue')
    expect(extracted?.content).toContain('=SUM(A1:A2)')
    expect(extracted?.spreadsheetSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: { sheetName: 'Forecast', address: 'A1', row: 1, column: 1 } }),
      expect.objectContaining({ locator: { sheetName: 'Forecast', address: 'C2', row: 2, column: 3 } })
    ]))
  })

  it('uses structured dirty spreadsheet cells without serializing a workbook', () => {
    const extracted = extractSpreadsheetCells([{
      sheetName: 'Draft',
      address: 'B4',
      row: 4,
      column: 2,
      value: 'unsaved needle',
      formula: '=LOWER("NEEDLE")'
    }])
    expect(extracted.content).toBe('unsaved needle\n=LOWER("NEEDLE")\n')
    expect(extracted.spreadsheetSegments).toHaveLength(2)
    expect(extracted.spreadsheetSegments?.[1]?.locator.address).toBe('B4')
  })

  it('extracts slide and speaker-note text with presentation locators', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'ppt/presentation.xml': strToU8(
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
      ),
      'ppt/_rels/presentation.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
      ),
      'ppt/slides/slide1.xml': strToU8(
        '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7" name="Revenue title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Quarterly revenue</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
      ),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>'
      ),
      'ppt/notesSlides/notesSlide1.xml': strToU8(
        '<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Mention forecast assumptions</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>'
      )
    })
    const extracted = extractPptxText(Buffer.from(archive))
    expect(extracted?.content).toContain('Quarterly revenue')
    expect(extracted?.content).toContain('Mention forecast assumptions')
    expect(extracted?.presentationSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: expect.objectContaining({ slideNumber: 1, elementId: '7', source: 'slide' }) }),
      expect.objectContaining({ locator: expect.objectContaining({ slideNumber: 1, source: 'notes' }) })
    ]))
  })

  it('uses structured dirty presentation entries without serializing a deck', () => {
    const extracted = extractPresentationEntries([{
      slideIndex: 2,
      slideNumber: 3,
      slideId: 'slide-3',
      elementId: 'shape-9',
      elementName: 'Summary',
      source: 'slide',
      text: 'unsaved presentation needle'
    }])
    expect(extracted.content).toBe('unsaved presentation needle\n')
    expect(extracted.presentationSegments?.[0]?.locator).toEqual({
      slideIndex: 2,
      slideNumber: 3,
      slideId: 'slide-3',
      elementId: 'shape-9',
      elementName: 'Summary',
      source: 'slide'
    })
  })
})
