import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Highlighter,
  LoaderCircle,
  ListTree,
  MessageSquareText,
  MousePointer2,
  Pencil,
  RotateCw,
  Save,
  SaveAll,
  Search,
  Stamp,
  Trash2,
  Redo2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type { DocumentTransaction } from '@shared/contracts'
import type { DocumentAdapterProps } from './registry'
import {
  recordDocumentTransaction,
  registerDocumentRuntime
} from './runtime'

type PdfMode = 'read' | 'annotate' | 'pages'
type AnnotationTool = 'highlight' | 'freeText' | 'ink' | 'stamp' | 'signature'

interface PdfAnnotation {
  id: string
  pageIndex: number
  xRatio: number
  yRatio: number
  tool: AnnotationTool
  text?: string
}

interface PageChange {
  rotation?: number
  deleted?: boolean
}

interface PdfEditSnapshot {
  annotations: PdfAnnotation[]
  pageChanges: Record<number, PageChange>
}

interface PdfOutlineItem {
  title: string
  depth: number
  dest: string | unknown[]
}

interface PdfEventBus {
  dispatch(name: string, data: unknown): void
}

interface PdfLinkService {
  goToDestination(dest: string | unknown[]): Promise<void>
}

export function PdfDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const viewerElement = useRef<HTMLDivElement>(null)
  const pdfDocument = useRef<PDFDocumentProxy | null>(null)
  const eventBusRef = useRef<PdfEventBus | null>(null)
  const linkServiceRef = useRef<PdfLinkService | null>(null)
  const pdfViewer = useRef<{
    currentPageNumber: number
    currentScale: number
    currentScaleValue: string
    pagesCount: number
    setDocument(document: PDFDocumentProxy | null): void
    scrollPageIntoView(options: { pageNumber: number }): void
    cleanup(): void
  } | null>(null)
  const markBinaryDirty = useAppStore((state) => state.markBinaryDirty)
  const saveDocument = useAppStore((state) => state.saveDocument)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)
  const [mode, setMode] = useState<PdfMode>('read')
  const [tool, setTool] = useState<AnnotationTool>('highlight')
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const [pageChanges, setPageChanges] = useState<Record<number, PageChange>>({})
  const pageChangesRef = useRef(pageChanges)
  pageChangesRef.current = pageChanges
  const undoHistory = useRef<PdfEditSnapshot[]>([])
  const redoHistory = useRef<PdfEditSnapshot[]>([])
  const historyRuntime = useRef({ undo: (): void => undefined, redo: (): void => undefined })
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findCount, setFindCount] = useState({ current: 0, total: 0 })
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<PdfOutlineItem[]>([])
  const [passwordPrompt, setPasswordPrompt] = useState<{
    update(password: string): void
    reason: number
  } | null>(null)
  const sessionUrl = document.documentKind === 'pdf' ? document.session.url : ''
  const snapshotEdits = (): PdfEditSnapshot => ({
    annotations: [...annotationsRef.current],
    pageChanges: structuredClone(pageChangesRef.current)
  })
  const restoreEditSnapshot = (snapshot: PdfEditSnapshot): void => {
    setAnnotations(snapshot.annotations)
    setPageChanges(snapshot.pageChanges)
    markChanged(document.id, 'user', markBinaryDirty, document.revision.sha256)
  }
  const rememberEdit = (): void => {
    undoHistory.current.push(snapshotEdits())
    if (undoHistory.current.length > 100) undoHistory.current.shift()
    redoHistory.current = []
  }
  historyRuntime.current.undo = () => {
    const previous = undoHistory.current.pop()
    if (!previous) return
    redoHistory.current.push(snapshotEdits())
    restoreEditSnapshot(previous)
  }
  historyRuntime.current.redo = () => {
    const next = redoHistory.current.pop()
    if (!next) return
    undoHistory.current.push(snapshotEdits())
    restoreEditSnapshot(next)
  }

  useEffect(() => {
    if (!findOpen || loading || !eventBusRef.current) return
    const timer = window.setTimeout(() => {
      eventBusRef.current?.dispatch('find', {
        source: null,
        type: '',
        query: findQuery,
        phraseSearch: true,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
        matchDiacritics: false
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [findOpen, findQuery, loading])

  useEffect(() => {
    const viewer = viewerElement.current
    if (!viewer) return
    for (const existing of viewer.querySelectorAll('[data-aladdeen-pdf-annotation]')) existing.remove()
    for (const annotation of annotations) {
      const pageElement = viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${annotation.pageIndex + 1}"]`
      )
      if (!pageElement) continue
      const marker = viewer.ownerDocument.createElement('span')
      marker.dataset.aladdeenPdfAnnotation = annotation.id
      marker.className = `aladdeen-pdf-annotation is-${annotation.tool}`
      marker.style.left = `${annotation.xRatio * 100}%`
      marker.style.top = `${annotation.yRatio * 100}%`
      marker.textContent = annotation.text ?? (annotation.tool === 'highlight' ? '' : '•')
      marker.title = annotation.text ?? annotation.tool
      pageElement.append(marker)
    }
  }, [annotations, page, scale])

  useEffect(() => {
    if (document.documentKind !== 'pdf' || !container.current || !viewerElement.current) return
    let cancelled = false
    let unregister = (): void => undefined
    let loadingTask: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const [pdfjs, viewerModule] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/web/pdf_viewer.mjs')
        ])
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        loadingTask = pdfjs.getDocument({
          url: sessionUrl,
          enableXfa: true
        })
        loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          setPasswordPrompt({ update: updatePassword, reason })
        }
        const loaded = await loadingTask.promise
        if (cancelled || !container.current || !viewerElement.current) {
          await loaded.cleanup()
          await loadingTask.destroy()
          return
        }
        pdfDocument.current = loaded
        const eventBus = new viewerModule.EventBus()
        const linkService = new viewerModule.PDFLinkService({ eventBus })
        eventBusRef.current = eventBus
        linkServiceRef.current = linkService
        linkService.externalLinkEnabled = false
        const findController = new viewerModule.PDFFindController({
          eventBus,
          linkService
        })
        const viewer = new viewerModule.PDFViewer({
          container: container.current,
          viewer: viewerElement.current,
          eventBus,
          linkService,
          findController,
          textLayerMode: 1,
          annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
          removePageBorders: false
        })
        pdfViewer.current = viewer
        linkService.setViewer(viewer)
        linkService.setDocument(loaded)
        viewer.setDocument(loaded)
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width'
          setScale(viewer.currentScale)
          setLoading(false)
        })
        eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => setPage(pageNumber))
        eventBus.on('scalechanging', ({ scale: nextScale }: { scale: number }) => setScale(nextScale))
        eventBus.on('updatefindmatchescount', (
          { matchesCount }: { matchesCount: { current: number; total: number } }
        ) => setFindCount(matchesCount))
        setPages(loaded.numPages)
        setOutline(flattenOutline(await loaded.getOutline()))
        const handleFormChange = (event: Event): void => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
            markChanged(document.id, 'user', markBinaryDirty, document.revision.sha256)
          }
        }
        container.current.addEventListener('change', handleFormChange)

        unregister = registerDocumentRuntime(document.id, {
          serialize: async () => {
            const saved = await loaded.saveDocument()
            return applyPdfChanges(saved, annotationsRef.current, pageChangesRef.current)
          },
          extractText: async () => {
            const output: string[] = []
            for (let pageIndex = 1; pageIndex <= loaded.numPages; pageIndex += 1) {
              const loadedPage = await loaded.getPage(pageIndex)
              const text = await loadedPage.getTextContent()
              output.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '))
              loadedPage.cleanup()
            }
            output.push(...annotationsRef.current.flatMap((annotation) => annotation.text ? [annotation.text] : []))
            return output.join('\n')
          },
          reveal: (match) => {
            const pageNumber = (match.pageIndex ?? 0) + 1
            viewer.currentPageNumber = Math.min(Math.max(1, pageNumber), loaded.numPages)
            viewer.scrollPageIntoView({ pageNumber: viewer.currentPageNumber })
          },
          undo: () => historyRuntime.current.undo(),
          redo: () => historyRuntime.current.redo(),
          focus: () => container.current?.focus(),
          cleanup: () => {
            container.current?.removeEventListener('change', handleFormChange)
            viewer.cleanup()
            void loaded.cleanup()
            void loadingTask?.destroy()
          }
        })
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'The PDF could not be opened.')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      unregister()
      loadingTask?.destroy()
      pdfViewer.current?.cleanup()
      pdfViewer.current = null
      eventBusRef.current = null
      linkServiceRef.current = null
      void pdfDocument.current?.cleanup()
      pdfDocument.current = null
    }
  }, [document.documentKind, document.id, document.revision.sha256, markBinaryDirty, sessionUrl])

  if (document.documentKind !== 'pdf') return <div />

  const changePage = (next: number): void => {
    const viewer = pdfViewer.current
    if (!viewer) return
    viewer.currentPageNumber = Math.min(Math.max(1, next), Math.max(1, pages))
  }
  const changeScale = (delta: number): void => {
    const viewer = pdfViewer.current
    if (!viewer) return
    viewer.currentScale = Math.min(4, Math.max(0.35, viewer.currentScale + delta))
  }
  const markPageChange = (change: PageChange): void => {
    rememberEdit()
    setPageChanges((current) => ({
      ...current,
      [page - 1]: { ...current[page - 1], ...change }
    }))
    markChanged(document.id, 'user', markBinaryDirty, document.revision.sha256)
  }
  const addAnnotation = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (mode !== 'annotate') return
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.page') : null
    if (!target) return
    const rect = target.getBoundingClientRect()
    const pageIndex = Math.max(0, Number(target.dataset.pageNumber ?? page) - 1)
    const text = tool === 'freeText' || tool === 'stamp' || tool === 'signature'
      ? window.prompt(tool === 'signature' ? 'Signature text' : tool === 'stamp' ? 'Stamp label' : 'Annotation text')?.trim()
      : undefined
    if ((tool === 'freeText' || tool === 'stamp' || tool === 'signature') && !text) return
    rememberEdit()
    setAnnotations((current) => [...current, {
      id: crypto.randomUUID(),
      pageIndex,
      xRatio: (event.clientX - rect.left) / rect.width,
      yRatio: (event.clientY - rect.top) / rect.height,
      tool,
      text
    }])
    markChanged(document.id, 'user', markBinaryDirty, document.revision.sha256)
  }
  const findAgain = (findPrevious: boolean): void => {
    if (!findQuery) return
    eventBusRef.current?.dispatch('find', {
      source: null,
      type: 'again',
      query: findQuery,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      matchDiacritics: false
    })
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] bg-surface-muted">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2.5">
        <ModeButton active={mode === 'read'} onClick={() => setMode('read')} icon={<MousePointer2 size={13} />}>Read</ModeButton>
        <ModeButton active={mode === 'annotate'} onClick={() => setMode('annotate')} icon={<Highlighter size={13} />}>Annotate</ModeButton>
        <ModeButton active={mode === 'pages'} onClick={() => setMode('pages')} icon={<RotateCw size={13} />}>Pages</ModeButton>
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        {mode === 'annotate' && (
          <>
            <ToolButton active={tool === 'highlight'} label="Highlight" onClick={() => setTool('highlight')}><Highlighter size={14} /></ToolButton>
            <ToolButton active={tool === 'freeText'} label="Free text" onClick={() => setTool('freeText')}><MessageSquareText size={14} /></ToolButton>
            <ToolButton active={tool === 'ink'} label="Ink mark" onClick={() => setTool('ink')}><Pencil size={14} /></ToolButton>
            <ToolButton active={tool === 'stamp'} label="Stamp" onClick={() => setTool('stamp')}><Stamp size={14} /></ToolButton>
            <ToolButton active={tool === 'signature'} label="Signature" onClick={() => setTool('signature')}><FileSignature size={14} /></ToolButton>
          </>
        )}
        {mode === 'pages' && (
          <>
            <ToolButton label="Rotate page" onClick={() => markPageChange({ rotation: ((pageChanges[page - 1]?.rotation ?? 0) + 90) % 360 })}><RotateCw size={14} /></ToolButton>
            <ToolButton label="Delete page" active={pageChanges[page - 1]?.deleted} onClick={() => markPageChange({ deleted: !pageChanges[page - 1]?.deleted })}><Trash2 size={14} /></ToolButton>
          </>
        )}
        <ToolButton label="Undo PDF change" onClick={() => historyRuntime.current.undo()}><Undo2 size={14} /></ToolButton>
        <ToolButton label="Redo PDF change" onClick={() => historyRuntime.current.redo()}><Redo2 size={14} /></ToolButton>
        <div className="relative ml-1 flex shrink-0 items-center gap-1">
          <ToolButton
            label={findOpen ? 'Close PDF search' : 'Search PDF'}
            active={findOpen}
            onClick={() => setFindOpen((value) => !value)}
          >
            {findOpen ? <X size={14} /> : <Search size={14} />}
          </ToolButton>
          {findOpen && (
            <label className="flex h-7 items-center rounded-md border border-border bg-surface-elevated px-2">
              <span className="sr-only">Search PDF</span>
              <input
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') findAgain(event.shiftKey)
                  if (event.key === 'Escape') setFindOpen(false)
                }}
                autoFocus
                placeholder="Find…"
                className="w-28 border-0 bg-transparent text-[10px] text-foreground outline-none placeholder:text-foreground-subtle"
              />
              <span className="text-[9px] tabular-nums text-foreground-subtle">
                {findCount.current}/{findCount.total}
              </span>
            </label>
          )}
          <ToolButton
            label="Document outline"
            active={outlineOpen}
            onClick={() => setOutlineOpen((value) => !value)}
          >
            <ListTree size={14} />
          </ToolButton>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ToolButton label="Previous page" onClick={() => changePage(page - 1)}><ChevronLeft size={14} /></ToolButton>
          <span className="min-w-[54px] text-center text-[10px] text-foreground-muted">{page} / {pages || '—'}</span>
          <ToolButton label="Next page" onClick={() => changePage(page + 1)}><ChevronRight size={14} /></ToolButton>
          <ToolButton label="Zoom out" onClick={() => changeScale(-0.1)}><ZoomOut size={14} /></ToolButton>
          <span className="min-w-[38px] text-center text-[9px] text-foreground-muted">{Math.round(scale * 100)}%</span>
          <ToolButton label="Zoom in" onClick={() => changeScale(0.1)}><ZoomIn size={14} /></ToolButton>
          <ToolButton label="Save PDF" onClick={() => void saveDocument(document.id)}><Save size={14} /></ToolButton>
          <ToolButton label="Save PDF as" onClick={() => void saveDocumentAs(document.id)}><SaveAll size={14} /></ToolButton>
        </div>
      </div>
      <div className="relative min-h-0">
        {outlineOpen && (
          <aside className="absolute left-3 top-3 z-20 max-h-[min(420px,75%)] w-[min(320px,calc(100%-24px))] overflow-auto rounded-lg border border-border bg-surface p-1.5 shadow-xl">
            <div className="flex h-8 items-center justify-between px-2">
              <strong className="text-[11px] text-foreground">Document outline</strong>
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded border-0 bg-transparent text-foreground-muted hover:bg-surface-hover"
                onClick={() => setOutlineOpen(false)}
                aria-label="Close document outline"
              >
                <X size={13} />
              </button>
            </div>
            {outline.length === 0 ? (
              <p className="px-2 pb-2 text-[10px] text-foreground-subtle">This PDF has no outline.</p>
            ) : outline.map((item, index) => (
              <button
                type="button"
                key={`${item.title}-${index}`}
                className="block min-h-7 w-full truncate rounded border-0 bg-transparent py-1 pr-2 text-left text-[10px] text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                onClick={() => {
                  void linkServiceRef.current?.goToDestination(item.dest)
                  setOutlineOpen(false)
                }}
                title={item.title}
              >
                {item.title}
              </button>
            ))}
          </aside>
        )}
        <div
          ref={container}
          tabIndex={0}
          className={cn(
            'pdf-viewer-container absolute inset-0 overflow-auto outline-none',
            mode === 'annotate' && 'cursor-crosshair'
          )}
          onClick={addAnnotation}
        >
          <div ref={viewerElement} className="pdfViewer" />
          {annotations.map((annotation) => (
            <span className="sr-only" key={annotation.id}>
              {annotation.tool} annotation on page {annotation.pageIndex + 1}
            </span>
          ))}
        </div>
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-surface-elevated text-foreground-muted">
            <span className="flex items-center gap-2 text-[12px]"><LoaderCircle className="spinner" size={16} /> Opening PDF…</span>
          </div>
        )}
        {passwordPrompt && (
          <div className="absolute inset-0 grid place-items-center bg-surface-elevated p-6">
            <form
              className="grid w-full max-w-sm gap-3 rounded-xl border border-border bg-surface p-5 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault()
                const value = event.currentTarget.password.value
                setPasswordPrompt(null)
                passwordPrompt.update(value)
              }}
            >
              <strong className="text-[14px] text-foreground">PDF password required</strong>
              <span className="text-[11px] text-foreground-muted">{passwordPrompt.reason === 2 ? 'That password was incorrect. Try again.' : 'The password stays in memory for this tab only.'}</span>
              <input name="password" type="password" autoFocus className="h-9 rounded-md border border-border bg-surface-elevated px-3 text-[12px] outline-none focus:border-accent" />
              <button className="h-9 rounded-md border-0 bg-accent px-3 text-[12px] font-semibold text-accent-contrast">Open PDF</button>
            </form>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-surface-elevated p-8 text-center">
            <div><strong className="block text-[14px] text-danger">Could not open this PDF</strong><span className="mt-2 block max-w-md text-[11px] text-foreground-muted">{error}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

function flattenOutline(
  nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null,
  depth = 0
): PdfOutlineItem[] {
  if (!nodes) return []
  return nodes.flatMap((node) => [
    ...(node.dest ? [{ title: node.title, depth, dest: node.dest }] : []),
    ...flattenOutline(node.items, depth + 1)
  ])
}

function markChanged(
  fileId: string,
  actor: DocumentTransaction['actor'],
  markBinaryDirty: (fileId: string) => void,
  baseRevision: string
): void {
  markBinaryDirty(fileId)
  recordDocumentTransaction({
    id: crypto.randomUUID(),
    fileId,
    documentKind: 'pdf',
    actor,
    baseRevision,
    createdAt: Date.now()
  })
}

async function applyPdfChanges(
  source: Uint8Array,
  annotations: PdfAnnotation[],
  changes: Record<number, PageChange>
): Promise<ArrayBuffer> {
  const { degrees, PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const document = await PDFDocument.load(source, { updateMetadata: false })
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const [rawIndex, change] of Object.entries(changes)) {
    const index = Number(rawIndex)
    const page = document.getPage(index)
    if (!page || change.deleted) continue
    if (change.rotation !== undefined) page.setRotation(degrees(change.rotation))
  }
  for (const annotation of annotations) {
    const page = document.getPage(annotation.pageIndex)
    if (!page || changes[annotation.pageIndex]?.deleted) continue
    const x = annotation.xRatio * page.getWidth()
    const y = (1 - annotation.yRatio) * page.getHeight()
    if (annotation.tool === 'highlight') {
      page.drawRectangle({ x, y: y - 12, width: 120, height: 18, color: rgb(1, 0.85, 0.2), opacity: 0.35 })
    } else if (annotation.tool === 'ink') {
      page.drawLine({ start: { x: x - 24, y }, end: { x: x + 36, y: y + 12 }, thickness: 2, color: rgb(0.82, 0.12, 0.28), opacity: 0.9 })
    } else {
      const text = annotation.text ?? annotation.tool
      page.drawText(text, {
        x,
        y,
        size: annotation.tool === 'signature' ? 16 : 11,
        font,
        color: annotation.tool === 'stamp' ? rgb(0.75, 0.05, 0.12) : rgb(0.08, 0.2, 0.58)
      })
    }
  }
  const deleted = Object.entries(changes)
    .filter(([, change]) => change.deleted)
    .map(([index]) => Number(index))
    .sort((left, right) => right - left)
  for (const index of deleted) {
    if (document.getPageCount() > 1 && index < document.getPageCount()) document.removePage(index)
  }
  const bytes = await document.save()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function ToolButton({
  active = false,
  label,
  children,
  onClick
}: {
  active?: boolean
  label: string
  children: React.ReactNode
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        active && 'bg-accent-soft text-accent'
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

function ModeButton({
  active,
  icon,
  children,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  children: React.ReactNode
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[10px] font-semibold text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        active && 'bg-accent-soft text-accent'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}{children}
    </button>
  )
}
