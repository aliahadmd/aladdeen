import { useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { OpenDocument } from '@shared/contracts'
import { useAppStore } from '@renderer/store/app-store'

export function MarkdownEditor({ document, dark }: { document: OpenDocument; dark: boolean }): React.JSX.Element {
  const updateContent = useAppStore((state) => state.updateContent)
  const updateEditorView = useAppStore((state) => state.updateEditorView)
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping],
    []
  )
  const editor = useRef<EditorView | null>(null)
  const editorReveal = document.editorReveal

  useEffect(() => {
    const reveal = editorReveal
    const view = editor.current
    if (!reveal || !view) return
    const from = Math.min(reveal.from, view.state.doc.length)
    const to = Math.min(Math.max(reveal.to, from), view.state.doc.length)
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
    view.focus()
  }, [editorReveal])

  const onUpdate = (update: ViewUpdate): void => {
    if (!update.selectionSet && !update.viewportChanged) return
    updateEditorView(document.id, update.view.scrollDOM.scrollTop, update.state.selection.main.head)
  }

  return (
    <div className="editor-pane" aria-label={`Editing ${document.name}`}>
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
              const from = Math.min(document.editorReveal.from, view.state.doc.length)
              const to = Math.min(Math.max(document.editorReveal.to, from), view.state.doc.length)
              view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
              view.focus()
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
