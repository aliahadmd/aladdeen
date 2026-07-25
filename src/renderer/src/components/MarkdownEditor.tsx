import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { EditorRevealRequest, TextOpenDocument } from '@shared/contracts'
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

function syncScrollRail(
  view: EditorView,
  rail: HTMLDivElement,
  thumb: HTMLDivElement
): void {
  const maximum = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
  const railHeight = rail.clientHeight
  const thumbHeight = maximum === 0
    ? railHeight
    : Math.max(36, railHeight * view.scrollDOM.clientHeight / view.scrollDOM.scrollHeight)
  const available = Math.max(0, railHeight - thumbHeight)
  const top = maximum === 0 ? 0 : view.scrollDOM.scrollTop / maximum * available
  rail.dataset.scrollable = String(maximum > 0)
  rail.setAttribute('aria-valuemin', '0')
  rail.setAttribute('aria-valuemax', String(Math.round(maximum)))
  rail.setAttribute('aria-valuenow', String(Math.round(view.scrollDOM.scrollTop)))
  thumb.style.height = `${thumbHeight}px`
  thumb.style.transform = `translateY(${top}px)`
}

function installEditorScrolling(
  view: EditorView,
  rail: HTMLDivElement,
  thumb: HTMLDivElement
): () => void {
  let syncFrame: number | undefined

  const scheduleSync = (): void => {
    if (syncFrame !== undefined) return
    syncFrame = window.requestAnimationFrame(() => {
      syncFrame = undefined
      syncScrollRail(view, rail, thumb)
    })
  }

  view.scrollDOM.addEventListener('scroll', scheduleSync, { passive: true })
  const resizeObserver = new ResizeObserver(scheduleSync)
  resizeObserver.observe(view.scrollDOM)
  resizeObserver.observe(view.contentDOM)
  resizeObserver.observe(rail)
  scheduleSync()
  return () => {
    view.scrollDOM.removeEventListener('scroll', scheduleSync)
    resizeObserver.disconnect()
    if (syncFrame !== undefined) window.cancelAnimationFrame(syncFrame)
  }
}

export function MarkdownEditor({ document, dark }: { document: TextOpenDocument; dark: boolean }): React.JSX.Element {
  const updateContent = useAppStore((state) => state.updateContent)
  const updateEditorView = useAppStore((state) => state.updateEditorView)
  const getEditorView = useAppStore((state) => state.getEditorView)
  const consumeEditorReveal = useAppStore((state) => state.consumeEditorReveal)
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping],
    []
  )
  const editor = useRef<EditorView | null>(null)
  const revealTimer = useRef<number | undefined>(undefined)
  const revealFrame = useRef<number | undefined>(undefined)
  const scrollRail = useRef<HTMLDivElement | null>(null)
  const scrollThumb = useRef<HTMLDivElement | null>(null)
  const scrollCleanup = useRef<(() => void) | undefined>(undefined)
  const scrollDragOffset = useRef(0)
  const appliedRevealId = useRef<number | undefined>(undefined)
  const editorReveal = document.editorReveal

  useEffect(() => {
    const reveal = editorReveal
    const view = editor.current
    if (!reveal || !view || appliedRevealId.current === reveal.id) return
    appliedRevealId.current = reveal.id
    applyEditorReveal(view, reveal, revealTimer, revealFrame)
    consumeEditorReveal(document.id, reveal.id)
  }, [consumeEditorReveal, document.id, editorReveal])

  useEffect(() => {
    const view = editor.current
    const rail = scrollRail.current
    const thumb = scrollThumb.current
    if (!view || !rail || !thumb) return
    scrollCleanup.current?.()
    const cleanup = installEditorScrolling(view, rail, thumb)
    scrollCleanup.current = cleanup
    return () => {
      cleanup()
      if (scrollCleanup.current === cleanup) scrollCleanup.current = undefined
    }
  }, [document.id])

  useEffect(
    () => () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current)
      if (revealFrame.current) window.cancelAnimationFrame(revealFrame.current)
      scrollCleanup.current?.()
      editor.current?.dom.querySelector('.source-reveal-flash')?.classList.remove('source-reveal-flash')
    },
    []
  )

  const onUpdate = (update: ViewUpdate): void => {
    if (!update.selectionSet && !update.viewportChanged) return
    updateEditorView(document.id, update.view.scrollDOM.scrollTop, update.state.selection.main.head)
  }

  const scrollFromPointer = (clientY: number): void => {
    const view = editor.current
    const rail = scrollRail.current
    const thumb = scrollThumb.current
    if (!view || !rail || !thumb) return
    const maximum = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
    const available = Math.max(0, rail.clientHeight - thumb.clientHeight)
    if (maximum === 0 || available === 0) return
    const top = Math.min(
      available,
      Math.max(0, clientY - rail.getBoundingClientRect().top - scrollDragOffset.current)
    )
    view.scrollDOM.scrollTop = top / available * maximum
  }

  const handleScrollPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rail = scrollRail.current
    const thumb = scrollThumb.current
    if (!rail || !thumb || rail.dataset.scrollable !== 'true') return
    event.preventDefault()
    scrollDragOffset.current = event.target === thumb
      ? event.clientY - thumb.getBoundingClientRect().top
      : thumb.clientHeight / 2
    event.currentTarget.setPointerCapture(event.pointerId)
    scrollFromPointer(event.clientY)
  }

  const handleScrollPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    scrollFromPointer(event.clientY)
  }

  const handleScrollPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleScrollKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const view = editor.current
    if (!view) return
    let next: number | undefined
    if (event.key === 'ArrowUp') next = view.scrollDOM.scrollTop - 44
    if (event.key === 'ArrowDown') next = view.scrollDOM.scrollTop + 44
    if (event.key === 'PageUp') next = view.scrollDOM.scrollTop - view.scrollDOM.clientHeight * 0.9
    if (event.key === 'PageDown') next = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight * 0.9
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = view.scrollDOM.scrollHeight
    if (next === undefined) return
    event.preventDefault()
    view.scrollDOM.scrollTop = next
  }

  return (
    <div className="editor-pane relative h-full min-h-0 min-w-0 overflow-hidden bg-surface" aria-label={`Editing ${document.name}`}>
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
          const rail = scrollRail.current
          const thumb = scrollThumb.current
          if (rail && thumb) {
            scrollCleanup.current?.()
            scrollCleanup.current = installEditorScrolling(view, rail, thumb)
          }
          requestAnimationFrame(() => {
            if (document.editorReveal) {
              const reveal = document.editorReveal
              if (appliedRevealId.current !== reveal.id) {
                appliedRevealId.current = reveal.id
                applyEditorReveal(view, reveal, revealTimer, revealFrame)
                consumeEditorReveal(document.id, reveal.id)
              }
            } else {
              const viewport = getEditorView(document.id)
              view.scrollDOM.scrollTop = viewport?.scrollTop ?? document.editorScrollTop
            }
            const selection = getEditorView(document.id)?.selection ?? document.editorSelection
            if (!document.editorReveal && selection <= view.state.doc.length) {
              view.dispatch({ selection: { anchor: selection }, scrollIntoView: false })
            }
          })
        }}
      />
      <div
        ref={scrollRail}
        className="editor-scrollbar"
        role="scrollbar"
        aria-label="Editor scroll position"
        aria-orientation="vertical"
        tabIndex={0}
        onKeyDown={handleScrollKeyDown}
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerEnd}
        onPointerCancel={handleScrollPointerEnd}
      >
        <div ref={scrollThumb} className="editor-scrollbar-thumb" />
      </div>
    </div>
  )
}
