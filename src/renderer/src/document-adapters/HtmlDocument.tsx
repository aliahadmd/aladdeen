import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Columns2,
  Eye,
  Save,
  SaveAll,
  ShieldCheck
} from 'lucide-react'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useMediaQuery } from '@renderer/hooks/use-media-query'
import { COMPACT_WORKSPACE_QUERY } from '@renderer/lib/breakpoints'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type { DocumentAdapterProps } from './registry'
import { prepareHtmlPreview, validateHtmlSource } from './html-preview'

type HtmlMode = 'source' | 'preview' | 'split'

export function HtmlDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const updateContent = useAppStore((state) => state.updateContent)
  const revealPreviewSource = useAppStore((state) => state.revealPreviewSource)
  const consumeEditorReveal = useAppStore((state) => state.consumeEditorReveal)
  const saveDocument = useAppStore((state) => state.saveDocument)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY)
  const dark = useEffectiveDarkMode()
  const htmlContent = document.documentKind === 'html' ? document.content : ''
  const [mode, setMode] = useState<HtmlMode>(compact ? 'preview' : 'split')
  const [previewSource, setPreviewSource] = useState(htmlContent)
  const iframe = useRef<HTMLIFrameElement>(null)
  const editorView = useRef<EditorView | null>(null)
  const previewScroll = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewSource(htmlContent), 150)
    return () => window.clearTimeout(timer)
  }, [htmlContent])

  useEffect(() => {
    if (!document.editorReveal || !editorView.current) return
    const reveal = document.editorReveal
    const length = editorView.current.state.doc.length
    const from = Math.min(Math.max(0, reveal.from), length)
    const to = Math.min(Math.max(from, reveal.to), length)
    editorView.current.dispatch({
      selection: { anchor: from, head: reveal.select ? to : from },
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    })
    editorView.current.focus()
    consumeEditorReveal(document.id, reveal.id)
  }, [consumeEditorReveal, document.editorReveal, document.id])

  const preview = useMemo(
    () => prepareHtmlPreview(previewSource, document.id),
    [document.id, previewSource]
  )
  const diagnostics = useMemo(() => validateHtmlSource(previewSource), [previewSource])
  const extensions = useMemo(() => [html(), EditorView.lineWrapping], [])

  if (document.documentKind !== 'html') return <div />

  const sourcePane = (
    <div className="h-full min-h-0 overflow-hidden bg-surface">
      <CodeMirror
        value={document.content}
        height="100%"
        theme={dark ? oneDark : 'light'}
        extensions={extensions}
        onCreateEditor={(view) => { editorView.current = view }}
        onUpdate={(update: ViewUpdate) => {
          if (update.view !== editorView.current) editorView.current = update.view
        }}
        onChange={(value) => updateContent(document.id, value)}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: true,
          closeBrackets: true,
          searchKeymap: true
        }}
        className="html-source-editor h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
      />
    </div>
  )

  const previewPane = (
    <div className="relative h-full min-h-0 bg-surface-elevated">
      <iframe
        ref={iframe}
        title={`Preview of ${document.name}`}
        className="h-full w-full border-0 bg-surface-elevated"
        sandbox=""
        srcDoc={preview}
        onLoad={() => {
          const frameDocument = iframe.current?.contentDocument
          const frameWindow = iframe.current?.contentWindow
          if (!frameDocument || !frameWindow) return
          frameWindow.scrollTo(0, previewScroll.current)
          frameWindow.addEventListener('scroll', () => {
            previewScroll.current = frameWindow.scrollY
          }, { passive: true })
          frameDocument.addEventListener('click', (event) => {
            if (mode === 'preview' || frameWindow.getSelection()?.toString()) return
            const target = event.target as HTMLElement | null
            if (!target?.closest || target.closest('a,button,input,summary')) return
            const mapped = target.closest<HTMLElement>('[data-aladdeen-source-start]')
            if (!mapped) return
            const from = Number(mapped.dataset.aladdeenSourceStart)
            const to = Number(mapped.dataset.aladdeenSourceEnd)
            if (Number.isFinite(from) && Number.isFinite(to)) {
              revealPreviewSource(document.id, { from, to, exact: false })
              if (compact) setMode('source')
            }
          })
        }}
      />
    </div>
  )

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[39px_minmax(0,1fr)]">
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3">
        <ModeButton active={mode === 'source'} icon={<Code2 size={13} />} onClick={() => setMode('source')}>Source</ModeButton>
        <ModeButton active={mode === 'preview'} icon={<Eye size={13} />} onClick={() => setMode('preview')}>Preview</ModeButton>
        {!compact && (
          <ModeButton active={mode === 'split'} icon={<Columns2 size={13} />} onClick={() => setMode('split')}>Split</ModeButton>
        )}
        <button
          type="button"
          className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground"
          onClick={() => void saveDocument(document.id)}
          aria-label="Save HTML"
          title="Save HTML"
        >
          <Save size={14} />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground"
          onClick={() => void saveDocumentAs(document.id)}
          aria-label="Save HTML as"
          title="Save As…"
        >
          <SaveAll size={14} />
        </button>
        <span
          className="ml-auto flex items-center gap-1.5 text-[10px] text-foreground-muted"
          title={diagnostics.length > 0
            ? `${diagnostics.length} HTML parse issue${diagnostics.length === 1 ? '' : 's'}; the browser repaired the preview.`
            : 'Scripts, forms, remote resources, and navigation are disabled'}
        >
          {diagnostics.length > 0 ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}
          {diagnostics.length > 0 ? `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}` : 'Valid · Isolated'}
        </span>
      </div>
      <div className="min-h-0">
        {mode === 'source' ? sourcePane : mode === 'preview' ? previewPane : (
          <PanelGroup direction="horizontal" autoSaveId="aladdeen-html-split">
            <Panel defaultSize={48} minSize={28}>{sourcePane}</Panel>
            <PanelResizeHandle className="w-px bg-border data-[resize-handle-active]:bg-accent" />
            <Panel defaultSize={52} minSize={28}>{previewPane}</Panel>
          </PanelGroup>
        )}
      </div>
    </div>
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
        'flex h-7 items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[11px] font-medium text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        active && 'bg-accent-soft text-accent'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}{children}{active && <CheckCircle2 className="sr-only" size={1} />}
    </button>
  )
}
