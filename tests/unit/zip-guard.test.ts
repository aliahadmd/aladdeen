// @vitest-environment node
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  inspectDocxBuffer,
  inspectPptxBuffer,
  inspectXlsxBuffer,
  requireZipEntryWithinBudget
} from '../../src/main/services/zip-guard'
import { workbookToBytes } from '@office-kit/xlsx/io'
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook'
import { setCell } from '@office-kit/xlsx/worksheet'

function createPackage(extraEntries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types />'),
    'word/document.xml': strToU8('<w:document />'),
    ...extraEntries
  })
}

function createPptxPackage(options: {
  presentationExtras?: string
  slideTarget?: string
  slideTargetMode?: string
  extraEntries?: Record<string, Uint8Array>
  slideRelationships?: string
} = {}): Uint8Array {
  const targetMode = options.slideTargetMode ? ` TargetMode="${options.slideTargetMode}"` : ''
  return zipSync({
    '[Content_Types].xml': strToU8('<Types />'),
    'ppt/presentation.xml': strToU8(
      `<p:presentation xmlns:p="p" xmlns:r="r">${options.presentationExtras ?? ''}<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${options.slideTarget ?? 'slides/slide1.xml'}"${targetMode}/></Relationships>`
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7" name="Title 1"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    ),
    ...(options.slideRelationships
      ? { 'ppt/slides/_rels/slide1.xml.rels': strToU8(options.slideRelationships) }
      : {}),
    ...options.extraEntries
  })
}

describe('DOCX package guard', () => {
  it('accepts the required OOXML parts from an in-memory save', () => {
    const entries = inspectDocxBuffer(createPackage())
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'word/document.xml'])
    )
  })

  it('enforces a strict extraction budget before inflating a requested part', () => {
    const entries = inspectDocxBuffer(createPackage())
    expect(requireZipEntryWithinBudget(entries, 'word/document.xml', {
      maxUncompressedBytes: 1_024,
      maxCompressionRatio: 200
    }).name).toBe('word/document.xml')
    expect(() => requireZipEntryWithinBudget(entries, 'word/document.xml', {
      maxUncompressedBytes: 1,
      maxCompressionRatio: 200
    })).toThrow(/permitted size/i)
  })

  it('rejects path traversal before an edited package reaches disk', () => {
    expect(() => inspectDocxBuffer(createPackage({
      '../outside.xml': strToU8('<unsafe />')
    }))).toThrow('unsafe filename')
  })

  it('rejects a generic ZIP that is not a DOCX package', () => {
    expect(() => inspectDocxBuffer(zipSync({
      'notes.txt': strToU8('not a document')
    }))).toThrow('not a valid DOCX')
  })

  it('rejects trailing data that makes the ZIP end record ambiguous', () => {
    const source = createPackage()
    const appended = new Uint8Array(source.byteLength + 1)
    appended.set(source)
    appended[source.byteLength] = 1
    expect(() => inspectDocxBuffer(appended)).toThrow(/comment length/i)
  })
})

describe('XLSX package guard', () => {
  it('requires real worksheet relationships and counts populated cells', async () => {
    const workbook = createWorkbook()
    const worksheet = addWorksheet(workbook, 'Sheet1')
    setCell(worksheet, 1, 1, 'hello')
    setCell(worksheet, 3, 2, 42)

    const inspection = inspectXlsxBuffer(await workbookToBytes(workbook))
    expect(inspection.worksheetParts).toEqual(['xl/worksheets/sheet1.xml'])
    expect(inspection.populatedCells).toBe(2)
  })

  it('rejects worksheet relationships that escape the worksheet directory', () => {
    const workbookXml = '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    const relationshipsXml = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../outside.xml"/></Relationships>'
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/_rels/workbook.xml.rels': strToU8(relationshipsXml),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet />'),
      'outside.xml': strToU8('<unsafe />')
    })
    expect(() => inspectXlsxBuffer(archive)).toThrow(/outside xl\/worksheets/i)
  })

  it('accepts namespace-qualified workbook and relationship elements', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<Types />'),
      'xl/workbook.xml': strToU8(
        '<x:workbook xmlns:x="spreadsheet"><x:sheets><x:sheet name="Data" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<r:Relationships xmlns:r="relationships"><r:Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></r:Relationships>'
      ),
      'xl/worksheets/sheet1.xml': strToU8('<x:worksheet xmlns:x="spreadsheet"><x:sheetData><x:row><x:c r="A1"/></x:row></x:sheetData></x:worksheet>')
    })

    expect(inspectXlsxBuffer(archive)).toMatchObject({
      worksheetParts: ['xl/worksheets/sheet1.xml'],
      populatedCells: 1
    })
  })
})

describe('PPTX package guard', () => {
  it('requires an ordered internal slide relationship and counts slide elements', () => {
    const inspection = inspectPptxBuffer(createPptxPackage())
    expect(inspection.slideParts).toEqual(['ppt/slides/slide1.xml'])
    expect(inspection.elementCount).toBe(1)
    expect(inspection.compatibility).toEqual({ level: 'supported', reasons: [], requiresSaveAs: false })
  })

  it('rejects external or missing slide targets', () => {
    expect(() => inspectPptxBuffer(createPptxPackage({
      slideTarget: 'https://example.invalid/slide.xml',
      slideTargetMode: 'External'
    }))).toThrow(/cannot be external/i)
    expect(() => inspectPptxBuffer(createPptxPackage({
      slideTarget: 'slides/missing.xml'
    }))).toThrow(/missing part/i)
  })

  it('requires a compatibility copy for preserved OOXML and linked content', () => {
    const inspection = inspectPptxBuffer(createPptxPackage({
      extraEntries: {
        'customXml/item1.xml': strToU8('<custom />'),
        'ppt/embeddings/oleObject1.bin': new Uint8Array([1, 2, 3])
      },
      slideRelationships: '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>'
    }))
    expect(inspection.compatibility.level).toBe('preserve-only')
    expect(inspection.compatibility.requiresSaveAs).toBe(true)
    expect(inspection.compatibility.reasons).toEqual(expect.arrayContaining([
      'custom XML',
      'embedded OLE content',
      'external or linked content'
    ]))
  })

  it('classifies signed, macro-bearing, and modify-protected presentations as read-only', () => {
    const signed = inspectPptxBuffer(createPptxPackage({
      extraEntries: { '_xmlsignatures/sig1.xml': strToU8('<Signature />') }
    }))
    expect(signed).toMatchObject({ signed: true, compatibility: { level: 'read-only' } })

    const macro = inspectPptxBuffer(createPptxPackage({
      extraEntries: { 'ppt/vbaProject.bin': new Uint8Array([1]) }
    }))
    expect(macro).toMatchObject({ restricted: true, compatibility: { level: 'read-only' } })

    const protectedDeck = inspectPptxBuffer(createPptxPackage({
      presentationExtras: '<p:modifyVerifier cryptProviderType="rsaAES"/>'
    }))
    expect(protectedDeck).toMatchObject({ restricted: true, compatibility: { level: 'read-only' } })
  })
})
