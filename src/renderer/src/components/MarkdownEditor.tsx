import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { EditorRevealRequest, OpenDocument } from '@shared/contracts'
import { useAppStore } from '@renderer/store/app-store'

function flashRevealedLine(
  view: EditorView,
  position: number,
  timer: MutableRefObject<number | undefined>,
  frame: MutableRefObject<number | undefined>
): void {
  view.dom.querySelector('.source-reveal-flash')?.classList.remove('source-reveal-flash')
  if (timer.current) window.clearTimeout(timer.current)
  if (frame.current) window.cancelAnimationFrame(frame.current)
  frame.current = window.requestAnimationFrame(() => {
    frame.current = undefined
    let line: Element | null = null
    try {
      const node = view.domAtPos(position).node
      const element = node instanceof Element ? node : node.parentElement
      line = element?.closest('.cm-line') ?? null
    } catch {
      // The editor can be replaced while a compact pane is switching.
    }
    if (!line) return
    line.classList.remove('source-reveal-flash')
    void (line as HTMLElement).offsetWidth
    line.classList.add('source-reveal-flash')
    timer.current = window.setTimeout(() => {
      line?.classList.remove('source-reveal-flash')
      timer.current = undefined
    }, 900)
  })
}

function applyEditorReveal(
  view: EditorView,
  reveal: EditorRevealRequest,
  timer: MutableRefObject<number | undefined>,
  frame: MutableRefObject<number | undefined>
): void {
  const from = Math.min(reveal.from, view.state.doc.length)
  const to = Math.min(Math.max(reveal.to, from), view.state.doc.length)
  view.dispatch({
    selection: reveal.select ? { anchor: from, head: to } : { anchor: from },
    effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 64 })
  })
  view.focus()
  flashRevealedLine(view, from, timer, frame)
}

export function MarkdownEditor({ document, dark }: { document: OpenDocument; dark: boolean }): React.JSX.Element {
  const updateContent = useAppStore((state) => state.updateContent)
  const updateEditorView = useAppStore((state) => state.updateEditorView)
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping],
    []
  )
  const editor = useRef<EditorView | null>(null)
  const revealTimer = useRef<number | undefined>(undefined)
  const revealFrame = useRef<number | undefined>(undefined)
  const editorReveal = document.editorReveal

  useEffect(() => {
    const reveal = editorReveal
    const view = editor.current
    if (!reveal || !view) return
    applyEditorReveal(view, reveal, revealTimer, revealFrame)
  }, [editorReveal])

  useEffect(
    () => () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current)
      if (revealFrame.current) window.cancelAnimationFrame(revealFrame.current)
      editor.current?.dom.querySelector('.source-reveal-flash')?.classList.remove('source-reveal-flash')
    },
    []
  )

  const onUpdate = (update: ViewUpdate): void => {
    if (!update.selectionSet && !update.viewportChanged) return
    updateEditorView(document.id, update.view.scrollDOM.scrollTop, update.state.selection.main.head)
  }

  return (
    <div className="editor-pane h-full min-h-0 min-w-0 overflow-hidden bg-surface" aria-label={`Editing ${document.name}`}>
      <CodeMirror
        key={document.id}
        value={document.content}
        height="100%"
        extensions={extensions}
        theme={dark ? oneDark : 'light'}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          searchKeymap: true
        }}
        onChange={(value) => updateContent(document.id, value)}
        onUpdate={onUpdate}
        onCreateEditor={(view) => {
          editor.current = view
          requestAnimationFrame(() => {
            if (document.editorReveal) {
              applyEditorReveal(view, document.editorReveal, revealTimer, revealFrame)
            } else {
              view.scrollDOM.scrollTop = document.editorScrollTop
            }
            if (!document.editorReveal && document.editorSelection <= view.state.doc.length) {
              view.dispatch({ selection: { anchor: document.editorSelection }, scrollIntoView: false })
            }
          })
        }}
      />
    </div>
  )
}
