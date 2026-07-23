import { writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  BrowserWindow,
  dialog,
  type BrowserWindow as BrowserWindowType,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'
import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  FileChild,
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
import type { PhrasingContent, Root, RootContent, Table as MdTable } from 'mdast'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { FluidError } from '@main/errors'
import type { ExportRequest, SaveCopyResult } from '@shared/contracts'
import { toAssetUrl } from '@shared/path'
import type { WorkspaceService } from './workspace'

const PRINT_CSS = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #252535; }
  @page { size: A4 portrait; margin: 18mm 17mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-size: 11pt; line-height: 1.65; overflow-wrap: anywhere; }
  article { max-width: 100%; }
  h1, h2, h3, h4, h5, h6 { color: #171725; line-height: 1.22; margin: 1.4em 0 .55em; page-break-after: avoid; }
  h1 { font-size: 28pt; letter-spacing: -.025em; border-bottom: 1px solid #e7e7ed; padding-bottom: .3em; }
  h2 { font-size: 20pt; letter-spacing: -.018em; border-bottom: 1px solid #ededf2; padding-bottom: .2em; }
  h3 { font-size: 15pt; }
  p, ul, ol, blockquote, pre, table { margin: .75em 0; }
  a { color: #4f46e5; text-decoration-color: #a5a1ef; }
  blockquote { border-left: 3px solid #aaa6ed; color: #5c5b6a; margin-left: 0; padding: .15em 0 .15em 1em; }
  code { font: .9em "SFMono-Regular", Consolas, "Liberation Mono", monospace; background: #f1f1f6; border-radius: 4px; padding: .12em .32em; }
  pre { background: #171721; color: #e9e9f3; border-radius: 9px; padding: 14px 16px; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: transparent; color: inherit; padding: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #dddde6; text-align: left; padding: 7px 9px; vertical-align: top; }
  th { background: #f4f4f8; font-weight: 650; }
  img { display: block; max-width: 100%; height: auto; margin: 1em auto; page-break-inside: avoid; }
  li + li { margin-top: .2em; }
  input[type="checkbox"] { margin-right: .45em; }
  .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #c792ea; }
  .hljs-string, .hljs-attr { color: #c3e88d; }
  .hljs-number, .hljs-built_in { color: #f78c6c; }
  .hljs-comment { color: #8a8a9d; font-style: italic; }
  .hljs-title, .hljs-function { color: #82aaff; }
`

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function localImagePlugin(fileId: string) {
  return () => (tree: unknown) => {
    visit(tree as never, 'element', (node: { tagName?: string; properties?: Record<string, unknown> }) => {
      if (node.tagName !== 'img' || typeof node.properties?.src !== 'string') return
      const url = toAssetUrl(fileId, node.properties.src)
      if (url) node.properties.src = url
      else {
        node.tagName = 'span'
        node.properties = { className: ['blocked-image'] }
      }
    })
  }
}

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

export class ExportService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly getParentWindow: () => BrowserWindowType | null
  ) {}

  async exportDocument(request: ExportRequest): Promise<SaveCopyResult> {
    return request.format === 'pdf' ? this.exportPdf(request) : this.exportDocx(request)
  }

  async saveCopy(fileId: string, content: string): Promise<SaveCopyResult> {
    const sourcePath = this.workspace.getTrackedFilePath(fileId)
    const suggestedName = basename(sourcePath, extname(sourcePath)) + '-copy.md'
    const result = await this.showSaveDialog({
      title: 'Save a copy',
      defaultPath: suggestedName,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (result.canceled || !result.filePath) throw new FluidError('CANCELLED', 'Save copy was cancelled.')
    await writeFile(result.filePath, content, { encoding: 'utf8', flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      await writeFile(result.filePath!, content, 'utf8')
    })
    return { path: result.filePath }
  }

  private async exportPdf(request: ExportRequest): Promise<SaveCopyResult> {
    const destination = await this.showSaveDialog({
      title: 'Export PDF',
      defaultPath: `${request.title}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    if (destination.canceled || !destination.filePath) throw new FluidError('CANCELLED', 'PDF export was cancelled.')

    const rendered = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(localImagePlugin(request.fileId))
      .use(rehypeHighlight, { detect: true })
      .use(rehypeStringify)
      .process(request.content)

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src fluidmd-asset: data:; style-src 'unsafe-inline'"><title>${escapeHtml(request.title)}</title><style>${PRINT_CSS}</style></head><body><article>${String(rendered)}</article></body></html>`
    const printWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault())

    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await printWindow.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); }))])`)
      const buffer = await printWindow.webContents.printToPDF({
        pageSize: 'A4',
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true
      })
      await writeFile(destination.filePath, buffer)
      return { path: destination.filePath }
    } catch (error) {
      throw new FluidError('EXPORT_FAILED', 'Could not generate the PDF.', error instanceof Error ? error.message : undefined)
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
    if (destination.canceled || !destination.filePath) throw new FluidError('CANCELLED', 'DOCX export was cancelled.')

    try {
      const tree = unified().use(remarkParse).use(remarkGfm).parse(request.content) as Root
      const children = await this.blocksToDocx(tree.children, request.fileId)
      const document = new Document({
        title: request.title,
        creator: 'FluidMD',
        description: 'Exported from Markdown by FluidMD',
        styles: {
          default: {
            document: {
              run: { font: 'Aptos', size: 22, color: '252535' },
              paragraph: { spacing: { after: 150, line: 320 } }
            }
          },
          paragraphStyles: [
            {
              id: 'FluidCode',
              name: 'FluidMD Code',
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
      throw new FluidError('EXPORT_FAILED', 'Could not generate the Word document.', error instanceof Error ? error.message : undefined)
    }
  }

  private async blocksToDocx(nodes: RootContent[], fileId: string, listLevel = 0): Promise<FileChild[]> {
    const children: FileChild[] = []
    for (const node of nodes) {
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
              children: await this.inlineToDocx(node.children, fileId),
              spacing: { before: node.depth === 1 ? 120 : 220, after: 110 }
            })
          )
          break
        case 'paragraph':
          children.push(new Paragraph({ children: await this.inlineToDocx(node.children, fileId) }))
          break
        case 'blockquote': {
          for (const quoteNode of node.children) {
            if (quoteNode.type === 'paragraph') {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: '❝ ', color: '6D68C9' }),
                    ...(await this.inlineToDocx(quoteNode.children, fileId))
                  ],
                  indent: { left: 420 },
                  border: { left: { style: BorderStyle.SINGLE, color: 'AAA6ED', size: 12, space: 12 } }
                })
              )
            } else {
              children.push(...(await this.blocksToDocx([quoteNode], fileId, listLevel)))
            }
          }
          break
        }
        case 'code':
          children.push(
            new Paragraph({
              style: 'FluidCode',
              children: [new TextRun({ text: node.value, font: 'Courier New' })],
              shading: { type: ShadingType.CLEAR, fill: 'F1F1F6', color: 'auto' }
            })
          )
          break
        case 'list': {
          let index = node.start ?? 1
          for (const item of node.children) {
            const first = item.children[0]
            const marker = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : node.ordered ? `${index}. ` : ''
            if (first?.type === 'paragraph') {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: marker }), ...(await this.inlineToDocx(first.children, fileId))],
                  bullet: node.ordered ? undefined : { level: Math.min(listLevel, 8) },
                  indent: node.ordered ? { left: 360 + listLevel * 240, hanging: 240 } : undefined
                })
              )
            }
            const nested = item.children.filter((child) => child.type !== 'paragraph') as RootContent[]
            children.push(...(await this.blocksToDocx(nested, fileId, listLevel + 1)))
            index += 1
          }
          break
        }
        case 'table':
          children.push(await this.tableToDocx(node, fileId))
          break
        case 'thematicBreak':
          children.push(
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, color: 'D9D9E2', size: 8, space: 8 } },
              spacing: { before: 160, after: 160 }
            })
          )
          break
        case 'html':
          break
        default:
          if ('children' in node && Array.isArray(node.children)) {
            children.push(...(await this.blocksToDocx(node.children as RootContent[], fileId, listLevel)))
          }
      }
    }
    return children
  }

  private async tableToDocx(node: MdTable, fileId: string): Promise<Table> {
    const rows = await Promise.all(
      node.children.map(async (row, rowIndex) =>
        new TableRow({
          children: await Promise.all(
            row.children.map(async (cell) =>
              new TableCell({
                children: [new Paragraph({ children: await this.inlineToDocx(cell.children, fileId) })],
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
    style: InlineStyle = {}
  ): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = []
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          result.push(new TextRun({ text: node.value, ...style }))
          break
        case 'strong':
          result.push(...(await this.inlineToDocx(node.children, fileId, { ...style, bold: true })))
          break
        case 'emphasis':
          result.push(...(await this.inlineToDocx(node.children, fileId, { ...style, italics: true })))
          break
        case 'delete':
          result.push(...(await this.inlineToDocx(node.children, fileId, { ...style, strike: true })))
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
          const linkChildren = await this.inlineToDocx(node.children, fileId, { ...style })
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
          result.push(new TextRun({ text: node.label ?? node.identifier, ...style }))
          break
        case 'html':
          break
        default:
          if ('children' in node && Array.isArray(node.children)) {
            result.push(...(await this.inlineToDocx(node.children as PhrasingContent[], fileId, style)))
          }
      }
    }
    return result
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
