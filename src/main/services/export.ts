import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  type BrowserWindow as BrowserWindowType,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'
import {
  BorderStyle,
  AlignmentType,
  Document,
  ExternalHyperlink,
  FileChild,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild
} from 'docx'
import imageSize from 'image-size'
import type { FootnoteDefinition, PhrasingContent, Root, RootContent, Table as MdTable } from 'mdast'
import { DesktopError } from '@main/errors'
import type { ExportRequest, SaveCopyResult } from '@shared/contracts'
import {
  createMarkdownAstProcessor,
  extractMarkdownMetadata,
  prepareMarkdownSource
} from '@shared/markdown'
import type { WorkspaceService } from './workspace'
import { MAX_DOCUMENT_BYTES } from '@shared/limits'

const mainBundleDirectory = import.meta.dirname
const EXPORT_LOAD_TIMEOUT_MS = 15_000
const EXPORT_RENDER_TIMEOUT_MS = 45_000
const EXPORT_PRINT_TIMEOUT_MS = 30_000

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  subScript?: boolean
  superScript?: boolean
  underline?: { color?: string }
}

export class ExportService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly getParentWindow: () => BrowserWindowType | null
  ) {}

  async exportDocument(request: ExportRequest): Promise<SaveCopyResult> {
    this.assertContentSize(request.content)
    return request.format === 'pdf' ? this.exportPdf(request) : this.exportDocx(request)
  }

  async saveCopy(fileId: string, content: string): Promise<SaveCopyResult> {
    this.assertContentSize(content)
    const sourcePath = this.workspace.getTrackedFilePath(fileId)
    const suggestedName = basename(sourcePath, extname(sourcePath)) + '-copy.md'
    const result = await this.showSaveDialog({
      title: 'Save a copy',
      defaultPath: suggestedName,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (result.canceled || !result.filePath) throw new DesktopError('CANCELLED', 'Save copy was cancelled.')
    await writeFile(result.filePath, content, { encoding: 'utf8', flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      await writeFile(result.filePath!, content, 'utf8')
    })
    return { path: result.filePath }
  }

  private assertContentSize(content: string): void {
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new DesktopError('INVALID_FILE', 'This document is larger than Aladdeen’s 20 MiB limit.')
    }
  }

  private async exportPdf(request: ExportRequest): Promise<SaveCopyResult> {
    const destination = await this.showSaveDialog({
      title: 'Export PDF',
      defaultPath: `${request.title}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    if (destination.canceled || !destination.filePath) throw new DesktopError('CANCELLED', 'PDF export was cancelled.')

    const printWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    printWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

    try {
      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        const rendererUrl = process.env.ELECTRON_RENDERER_URL.endsWith('/')
          ? process.env.ELECTRON_RENDERER_URL
          : `${process.env.ELECTRON_RENDERER_URL}/`
        await withTimeout(
          printWindow.loadURL(new URL('export.html', rendererUrl).toString()),
          EXPORT_LOAD_TIMEOUT_MS,
          'The PDF export renderer did not load.'
        )
      } else {
        await withTimeout(
          printWindow.loadFile(join(mainBundleDirectory, '../renderer/export.html')),
          EXPORT_LOAD_TIMEOUT_MS,
          'The PDF export renderer did not load.'
        )
      }
      await waitForExportRenderer(printWindow)
      const payload = JSON.stringify({
        fileId: request.fileId,
        title: request.title,
        content: request.content
      })
      await withTimeout(
        printWindow.webContents.executeJavaScript(`window.renderAladdeenExport(${payload})`, true),
        EXPORT_RENDER_TIMEOUT_MS,
        'The PDF export content did not finish rendering.'
      )
      const buffer = await withTimeout(printWindow.webContents.printToPDF({
        pageSize: 'A4',
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true
      }), EXPORT_PRINT_TIMEOUT_MS, 'Electron did not finish printing the PDF.')
      await writeFile(destination.filePath, buffer)
      return { path: destination.filePath }
    } catch (error) {
      throw new DesktopError('EXPORT_FAILED', 'Could not generate the PDF.', error instanceof Error ? error.message : undefined)
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
    }
  }

  private async exportDocx(request: ExportRequest): Promise<SaveCopyResult> {
    const destination = await this.showSaveDialog({
      title: 'Export Word document',
      defaultPath: `${request.title}.docx`,
      filters: [{ name: 'Word document', extensions: ['docx'] }]
    })
    if (destination.canceled || !destination.filePath) throw new DesktopError('CANCELLED', 'DOCX export was cancelled.')

    try {
      const metadata = extractMarkdownMetadata(request.content)
      const processor = createMarkdownAstProcessor()
      const parsed = processor.parse(prepareMarkdownSource(request.content))
      const tree = (await processor.run(parsed)) as Root
      const definitions = tree.children.filter(
        (node): node is FootnoteDefinition => node.type === 'footnoteDefinition'
      )
      const footnoteIds = new Map(definitions.map((definition, index) => [definition.identifier, index + 1]))
      const body = tree.children.filter((node) => node.type !== 'footnoteDefinition')
      const children = await this.blocksToDocx(body, request.fileId, 0, footnoteIds)
      const footnotes: Record<string, { children: Paragraph[] }> = {}
      for (const definition of definitions) {
        const id = footnoteIds.get(definition.identifier)
        if (!id) continue
        const blocks = await this.blocksToDocx(definition.children, request.fileId, 0, footnoteIds)
        footnotes[String(id)] = {
          children: blocks.filter((block): block is Paragraph => block instanceof Paragraph)
        }
      }
      const metadataDetails = [
        metadata?.date ? `Date: ${metadata.date}` : '',
        metadata?.version ? `Version: ${metadata.version}` : ''
      ].filter(Boolean)
      const document = new Document({
        title: metadata?.title || request.title,
        creator: metadata?.author || 'Aladdeen',
        keywords: metadata?.tags.join(', ') || undefined,
        description: ['Exported from Markdown by Aladdeen', ...metadataDetails].join('. '),
        footnotes,
        styles: {
          default: {
            document: {
              run: { font: 'Aptos', size: 22, color: '252535' },
              paragraph: { spacing: { after: 150, line: 320 } }
            }
          },
          paragraphStyles: [
            {
              id: 'AladdeenCode',
              name: 'Aladdeen Code',
              basedOn: 'Normal',
              quickFormat: true,
              run: { font: 'Courier New', size: 18, color: '252535' },
              paragraph: { spacing: { before: 120, after: 120 }, indent: { left: 180, right: 180 } }
            }
          ]
        },
        sections: [
          {
            properties: {
              page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1020, right: 965, bottom: 1134, left: 965 }
              }
            },
            children
          }
        ]
      })
      const buffer = await Packer.toBuffer(document)
      await writeFile(destination.filePath, buffer)
      return { path: destination.filePath }
    } catch (error) {
      throw new DesktopError('EXPORT_FAILED', 'Could not generate the Word document.', error instanceof Error ? error.message : undefined)
    }
  }

  private async blocksToDocx(
    nodes: RootContent[],
    fileId: string,
    listLevel = 0,
    footnoteIds = new Map<string, number>()
  ): Promise<FileChild[]> {
    const children: FileChild[] = []
    for (const node of nodes) {
      const extended = node as unknown as {
        type: string
        value?: string
        children?: Array<{ type: string; children?: PhrasingContent[] }>
      }
      if (extended.type === 'math') {
        children.push(
          new Paragraph({
            style: 'AladdeenCode',
            children: [
              new TextRun({ text: 'Math', bold: true, font: 'Courier New' }),
              new TextRun({ break: 1, text: extended.value ?? '', font: 'Courier New' })
            ],
            shading: { type: ShadingType.CLEAR, fill: 'F1F1F6', color: 'auto' }
          })
        )
        continue
      }
      if (extended.type === 'descriptionlist') {
        for (const entry of extended.children ?? []) {
          if (!entry.children) continue
          children.push(
            new Paragraph({
              children: await this.inlineToDocx(
                entry.children,
                fileId,
                entry.type === 'descriptionterm' ? { bold: true } : {},
                footnoteIds
              ),
              indent: entry.type === 'descriptiondetails' ? { left: 360 } : undefined,
              spacing: entry.type === 'descriptionterm' ? { before: 140, after: 40 } : { after: 100 }
            })
          )
        }
        continue
      }
      switch (node.type) {
        case 'heading':
          children.push(
            new Paragraph({
              heading: [
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
                HeadingLevel.HEADING_6
              ][node.depth - 1],
              children: await this.inlineToDocx(node.children, fileId, {}, footnoteIds),
              spacing: { before: node.depth === 1 ? 120 : 220, after: 110 }
            })
          )
          break
        case 'paragraph':
          children.push(new Paragraph({ children: await this.inlineToDocx(node.children, fileId, {}, footnoteIds) }))
          break
        case 'blockquote': {
          for (const quoteNode of node.children) {
            if (quoteNode.type === 'paragraph') {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: '❝ ', color: '6D68C9' }),
                    ...(await this.inlineToDocx(quoteNode.children, fileId, {}, footnoteIds))
                  ],
                  indent: { left: 420 },
                  border: { left: { style: BorderStyle.SINGLE, color: 'AAA6ED', size: 12, space: 12 } }
                })
              )
            } else {
              children.push(...(await this.blocksToDocx([quoteNode], fileId, listLevel, footnoteIds)))
            }
          }
          break
        }
        case 'code':
          {
            const isMermaid = node.lang?.toLowerCase() === 'mermaid'
          children.push(
            new Paragraph({
              style: 'AladdeenCode',
              children: [
                ...(isMermaid
                  ? [
                      new TextRun({ text: 'Mermaid diagram', bold: true, font: 'Courier New' }),
                      new TextRun({ break: 1, text: '', font: 'Courier New' })
                    ]
                  : []),
                ...codeTextRuns(node.value)
              ],
              shading: { type: ShadingType.CLEAR, fill: 'F1F1F6', color: 'auto' }
            })
          )
          break
          }
        case 'list': {
          let index = node.start ?? 1
          for (const item of node.children) {
            const marker = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : node.ordered ? `${index}. ` : ''
            let paragraphIndex = 0
            for (const itemChild of item.children) {
              if (itemChild.type === 'paragraph') {
                const firstParagraph = paragraphIndex === 0
                children.push(
                  new Paragraph({
                    children: [
                      ...(firstParagraph && marker ? [new TextRun({ text: marker })] : []),
                      ...(await this.inlineToDocx(itemChild.children, fileId, {}, footnoteIds))
                    ],
                    bullet: firstParagraph && !node.ordered ? { level: Math.min(listLevel, 8) } : undefined,
                    indent: node.ordered && firstParagraph
                      ? { left: 360 + listLevel * 240, hanging: 240 }
                      : !firstParagraph
                        ? { left: 600 + listLevel * 240 }
                        : undefined
                  })
                )
                paragraphIndex += 1
              } else {
                children.push(...(await this.blocksToDocx(
                  [itemChild as RootContent],
                  fileId,
                  listLevel + 1,
                  footnoteIds
                )))
              }
            }
            index += 1
          }
          break
        }
        case 'table':
          children.push(await this.tableToDocx(node, fileId, footnoteIds))
          break
        case 'thematicBreak':
          children.push(
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, color: 'D9D9E2', size: 8, space: 8 } },
              spacing: { before: 160, after: 160 }
            })
          )
          break
        case 'html': {
          const text = this.safeHtmlText(node.value)
          if (text) children.push(new Paragraph({ children: [new TextRun({ text })] }))
          break
        }
        default:
          if ('children' in node && Array.isArray(node.children)) {
            children.push(
              ...(await this.blocksToDocx(node.children as RootContent[], fileId, listLevel, footnoteIds))
            )
          }
      }
    }
    return children
  }

  private async tableToDocx(
    node: MdTable,
    fileId: string,
    footnoteIds: Map<string, number>
  ): Promise<Table> {
    const rows = await Promise.all(
      node.children.map(async (row, rowIndex) =>
        new TableRow({
          children: await Promise.all(
            row.children.map(async (cell, cellIndex) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: await this.inlineToDocx(cell.children, fileId, {}, footnoteIds),
                    alignment: node.align?.[cellIndex] === 'center'
                      ? AlignmentType.CENTER
                      : node.align?.[cellIndex] === 'right'
                        ? AlignmentType.RIGHT
                        : AlignmentType.LEFT
                  })
                ],
                shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'F0F0F5', color: 'auto' } : undefined,
                margins: { top: 90, right: 110, bottom: 90, left: 110 }
              })
            )
          )
        })
      )
    )
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
  }

  private async inlineToDocx(
    nodes: PhrasingContent[],
    fileId: string,
    style: InlineStyle = {},
    footnoteIds = new Map<string, number>()
  ): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = []
    let activeStyle = { ...style }
    const htmlStyleStack: Array<{ tag: string; style: InlineStyle }> = []
    for (const node of nodes) {
      const extended = node as unknown as { type: string; value?: string; identifier?: string }
      if (extended.type === 'inlineMath') {
        result.push(
          new TextRun({
            text: `\\(${extended.value ?? ''}\\)`,
            font: 'Courier New',
            shading: { type: ShadingType.CLEAR, fill: 'EEEEF4', color: 'auto' }
          })
        )
        continue
      }
      if (extended.type === 'footnoteReference') {
        const id = extended.identifier ? footnoteIds.get(extended.identifier) : undefined
        if (id) result.push(new FootnoteReferenceRun(id))
        continue
      }
      if (extended.type === 'html') {
        const html = extended.value ?? ''
        if (/^<\s*br\s*\/?\s*>$/i.test(html)) {
          result.push(new TextRun({ break: 1 }))
          continue
        }
        const tag = /^<\s*(\/?)\s*([a-z0-9-]+)/i.exec(html)
        if (!tag) continue
        const name = tag[2]!.toLowerCase()
        if (tag[1]) {
          const index = htmlStyleStack.findLastIndex((entry) => entry.tag === name)
          if (index !== -1) {
            activeStyle = htmlStyleStack[index]!.style
            htmlStyleStack.splice(index)
          }
          continue
        }
        const nextStyle = this.htmlInlineStyle(name, activeStyle)
        if (nextStyle) {
          htmlStyleStack.push({ tag: name, style: activeStyle })
          activeStyle = nextStyle
        }
        continue
      }
      switch (node.type) {
        case 'text':
          result.push(new TextRun({ text: node.value, ...activeStyle }))
          break
        case 'strong':
          result.push(
            ...(await this.inlineToDocx(
              node.children,
              fileId,
              { ...activeStyle, bold: true },
              footnoteIds
            ))
          )
          break
        case 'emphasis':
          result.push(
            ...(await this.inlineToDocx(
              node.children,
              fileId,
              { ...activeStyle, italics: true },
              footnoteIds
            ))
          )
          break
        case 'delete':
          result.push(
            ...(await this.inlineToDocx(
              node.children,
              fileId,
              { ...activeStyle, strike: true },
              footnoteIds
            ))
          )
          break
        case 'inlineCode':
          result.push(
            new TextRun({
              text: node.value,
              font: 'Courier New',
              size: 19,
              shading: { type: ShadingType.CLEAR, fill: 'EEEEF4', color: 'auto' }
            })
          )
          break
        case 'break':
          result.push(new TextRun({ break: 1 }))
          break
        case 'link': {
          const linkChildren = await this.inlineToDocx(
            node.children,
            fileId,
            { ...activeStyle },
            footnoteIds
          )
          if (/^(https?:|mailto:)/i.test(node.url)) {
            result.push(new ExternalHyperlink({ children: linkChildren, link: node.url }))
          } else result.push(...linkChildren)
          break
        }
        case 'image':
          result.push(await this.imageToDocx(node.url, node.alt ?? 'Image', fileId))
          break
        case 'imageReference':
        case 'linkReference':
          result.push(new TextRun({ text: node.label ?? node.identifier, ...activeStyle }))
          break
        default:
          if ('children' in node && Array.isArray(node.children)) {
            result.push(
              ...(await this.inlineToDocx(
                node.children as PhrasingContent[],
                fileId,
                activeStyle,
                footnoteIds
              ))
            )
          }
      }
    }
    return result
  }

  private htmlInlineStyle(tag: string, current: InlineStyle): InlineStyle | null {
    if (tag === 'b' || tag === 'strong') return { ...current, bold: true }
    if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'var') {
      return { ...current, italics: true }
    }
    if (tag === 'del' || tag === 's') return { ...current, strike: true }
    if (tag === 'sub') return { ...current, subScript: true }
    if (tag === 'sup') return { ...current, superScript: true }
    if (tag === 'u' || tag === 'ins') return { ...current, underline: {} }
    return null
  }

  private safeHtmlText(value: string): string {
    if (/<\s*(?:script|style|iframe|object|embed|form|svg)\b/i.test(value)) return ''
    return value
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .trim()
  }

  private async imageToDocx(target: string, alt: string, fileId: string): Promise<ParagraphChild> {
    if (!target || /^(https?:|data:|file:)/i.test(target)) return new TextRun({ text: `[Image: ${alt}]`, italics: true, color: '666675' })
    const extension = extname(target.split(/[?#]/)[0] ?? '').toLowerCase()
    const type = extension === '.jpg' || extension === '.jpeg' ? 'jpg' : extension === '.png' ? 'png' : extension === '.gif' ? 'gif' : null
    if (!type) return new TextRun({ text: `[Image: ${alt}]`, italics: true, color: '666675' })

    try {
      const { data } = await this.workspace.readAsset(fileId, target)
      const dimensions = imageSize(data)
      const naturalWidth = dimensions.width || 640
      const naturalHeight = dimensions.height || 360
      const width = Math.min(naturalWidth, 560)
      const height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width))
      return new ImageRun({
        type,
        data,
        transformation: { width, height },
        altText: { name: alt, description: alt, title: alt }
      })
    } catch {
      return new TextRun({ text: `[Image unavailable: ${alt}]`, italics: true, color: '666675' })
    }
  }

  private showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
    const parent = this.getParentWindow()
    return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
  }
}

function codeTextRuns(value: string): TextRun[] {
  return value.split('\n').map((line, index) => new TextRun({
    text: line,
    break: index === 0 ? undefined : 1,
    font: 'Courier New'
  }))
}

async function waitForExportRenderer(window: BrowserWindowType): Promise<void> {
  const deadline = Date.now() + EXPORT_LOAD_TIMEOUT_MS
  while (!window.isDestroyed()) {
    const ready = await window.webContents.executeJavaScript(
      'typeof window.renderAladdeenExport === "function"',
      true
    ) as boolean
    if (ready) return
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('The PDF export renderer did not become ready.')
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
