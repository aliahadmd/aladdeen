import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DocxEditor,
  type DocxEditorRef,
  type EditorMode
} from '@eigenpal/docx-editor-react'
import {
  PluginHost,
  type EditorPlugin
} from '@eigenpal/docx-editor-react/plugin-api'
import '@eigenpal/docx-editor-react/styles.css'
import { CheckCircle2, CloudOff, LoaderCircle, PencilLine, SaveAll } from 'lucide-react'
import { BrandMark } from '@renderer/components/BrandMark'
import { cn } from '@renderer/lib/cn'
import { useAppStore } from '@renderer/store/app-store'
import type {
  BinarySearchRevealContext,
  DocumentTransaction,
  GlobalSearchMatch
} from '@shared/contracts'
import type { DocumentAdapterProps } from './registry'
import {
  recordDocumentTransaction,
  registerDocumentRuntime
} from './runtime'

const EMPTY_PLUGINS: EditorPlugin[] = []
const SEARCH_HIGHLIGHT = 'color-mix(in srgb, var(--accent) 30%, transparent)'

export interface DocxAdapterHandle {
  serialize(): Promise<ArrayBuffer>
  extractText(): string
  reveal(match: GlobalSearchMatch, context: BinarySearchRevealContext): boolean
  focus(): void
  undo(): boolean
  redo(): boolean
  getEditor(): DocxEditorRef | null
}

export function DocxDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const editorRef = useRef<DocxEditorRef>(null)
  const unregisterRuntimeRef = useRef<(() => void) | null>(null)
  const trackingReadyRef = useRef(false)
  const trackingFrameRef = useRef<number | null>(null)
  const stagedSaveBufferRef = useRef<ArrayBuffer | null>(null)
  const serializingRef = useRef(false)
  const serializedRevisionRef = useRef<string | null>(null)
  const loadedRevisionRef = useRef<string | null>(null)
  const documentRef = useRef(document)
  const markBinaryDirty = useAppStore((state) => state.markBinaryDirty)
  const saveDocument = useAppStore((state) => state.saveDocument)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)
  const colorMode = useAppStore((state) => state.settings.theme)
  const [mode, setMode] = useState<EditorMode>('editing')
  const [sourceBuffer, setSourceBuffer] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  documentRef.current = document
  const sessionUrl = document.documentKind === 'docx' ? document.session.url : ''

  const serialize = useCallback(async (): Promise<ArrayBuffer> => {
    const staged = stagedSaveBufferRef.current
    stagedSaveBufferRef.current = null
    let saved = staged
    if (!saved) {
      serializingRef.current = true
      try {
        saved = await editorRef.current?.save() ?? null
      } finally {
        serializingRef.current = false
      }
      // Eigenpal calls onSave while resolving save(). That callback is useful
      // for its toolbar and Cmd+S, but this serialization already owns the
      // returned buffer and must not enqueue a duplicate disk write.
      if (stagedSaveBufferRef.current === saved) stagedSaveBufferRef.current = null
    }
    if (!saved) throw new Error('The Word editor did not produce a document to save.')
    const transferable = saved.slice(0)
    serializedRevisionRef.current = await sha256Hex(transferable)
    return transferable
  }, [])

  const extractText = useCallback((): string => {
    const state = editorRef.current?.getEditorRef()?.getState()
    return state?.doc.textBetween(0, state.doc.content.size, '\n', '\n') ?? ''
  }, [])

  const reveal = useCallback((
    match: GlobalSearchMatch,
    context: BinarySearchRevealContext
  ): boolean => {
    const editor = editorRef.current
    if (!editor) return false
    const query = context.query.trim() || matchedSnippet(match)
    if (!query) return false
    const candidates = editor.findInDocument(query, {
      caseSensitive: context.matchCase,
      limit: 500
    })
    const candidate = chooseSearchCandidate(candidates, match, context.matchCase)
    if (candidate) {
      const didScroll = editor.scrollToParaId(candidate.paraId, {
        highlight: { color: SEARCH_HIGHLIGHT, durationMs: 1_200 }
      })
      const range = findParagraphRange(editor, candidate.paraId, candidate.match, context.matchCase)
      if (range) editor.highlightRange(range.from, range.to)
      editor.focus()
      return didScroll || Boolean(range)
    }

    const position = match.documentPosition
    const state = editor.getEditorRef()?.getState()
    if (position === undefined || !state) return false
    const clamped = Math.max(0, Math.min(position, state.doc.content.size))
    editor.scrollToPosition(clamped)
    editor.highlightRange(clamped, Math.min(clamped + query.length, state.doc.content.size))
    editor.focus()
    return true
  }, [])

  const registerRuntime = useCallback((): void => {
    unregisterRuntimeRef.current?.()
    const handle: DocxAdapterHandle = {
      serialize,
      extractText,
      reveal,
      focus: () => editorRef.current?.focus(),
      undo: () => editorRef.current?.getEditorRef()?.undo() ?? false,
      redo: () => editorRef.current?.getEditorRef()?.redo() ?? false,
      getEditor: () => editorRef.current
    }
    unregisterRuntimeRef.current = registerDocumentRuntime(document.id, {
      serialize: handle.serialize,
      extractText: handle.extractText,
      reveal: handle.reveal,
      undo: () => { handle.undo() },
      redo: () => { handle.redo() },
      focus: handle.focus,
      cleanup: () => {
        trackingReadyRef.current = false
        stagedSaveBufferRef.current = null
      }
    })
  }, [document.id, extractText, reveal, serialize])

  const loadSessionBuffer = useCallback(async (): Promise<ArrayBuffer> => {
    const response = await fetch(sessionUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error('The DOCX session expired. Reopen the document.')
    return response.arrayBuffer()
  }, [sessionUrl])

  useEffect(() => {
    if (document.documentKind !== 'docx') return
    let cancelled = false
    trackingReadyRef.current = false
    setSourceBuffer(null)
    setLoading(true)
    setError(null)

    void loadSessionBuffer()
      .then((buffer) => {
        if (cancelled) return
        loadedRevisionRef.current = documentRef.current.revision.sha256
        setSourceBuffer(buffer)
      })
      .catch((caught) => {
        if (cancelled) return
        setError(errorMessage(caught))
        setLoading(false)
      })

    return () => {
      cancelled = true
      if (trackingFrameRef.current !== null) cancelAnimationFrame(trackingFrameRef.current)
      trackingFrameRef.current = null
      trackingReadyRef.current = false
      unregisterRuntimeRef.current?.()
      unregisterRuntimeRef.current = null
      stagedSaveBufferRef.current = null
    }
  }, [document.documentKind, document.id, loadSessionBuffer])

  useEffect(() => {
    if (
      document.documentKind !== 'docx' ||
      !sourceBuffer ||
      loadedRevisionRef.current === document.revision.sha256
    ) return

    if (serializedRevisionRef.current === document.revision.sha256) {
      loadedRevisionRef.current = document.revision.sha256
      serializedRevisionRef.current = null
      return
    }

    let cancelled = false
    trackingReadyRef.current = false
    setLoading(true)
    void loadSessionBuffer()
      .then(async (buffer) => {
        if (cancelled) return
        const editor = editorRef.current
        if (!editor) {
          setSourceBuffer(buffer)
          return
        }
        await editor.loadDocumentBuffer(buffer)
        if (cancelled) return
        loadedRevisionRef.current = document.revision.sha256
        registerRuntime()
        trackingFrameRef.current = requestAnimationFrame(() => {
          trackingReadyRef.current = true
          setLoading(false)
        })
      })
      .catch((caught) => {
        if (cancelled) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    document.documentKind,
    document.revision.sha256,
    loadSessionBuffer,
    registerRuntime,
    sourceBuffer
  ])

  const titleBarActions = useMemo(() => (
    <div className="flex min-w-0 items-center gap-1.5 pr-1">
      <DocxSaveState status={document.status} error={document.error} />
      <button
        type="button"
        className="aladdeen-docx-title-action"
        onClick={() => void saveDocumentAs(document.id)}
        title="Save this Word document to another location"
      >
        <SaveAll size={14} />
        <span>Save As</span>
      </button>
    </div>
  ), [document.error, document.id, document.status, saveDocumentAs])

  if (document.documentKind !== 'docx') return <div />

  return (
    <div className="aladdeen-docx-host relative h-full min-h-0 min-w-0 overflow-hidden bg-surface-muted">
      {sourceBuffer && (
        <PluginHost plugins={EMPTY_PLUGINS} className="aladdeen-docx-plugin-host">
          <DocxEditor
            key={document.id}
            ref={editorRef}
            documentBuffer={sourceBuffer}
            author="Aladdeen User"
            mode={mode}
            onModeChange={setMode}
            colorMode={colorMode}
            showToolbar
            showFileOpen={false}
            showHelpMenu={false}
            showZoomControl
            showRuler
            rulerUnit="inch"
            showOutline={false}
            showOutlineButton
            documentName={document.name}
            documentNameEditable={false}
            renderLogo={() => <BrandMark className="h-6 w-6 shrink-0" title="Aladdeen" />}
            renderTitleBarRight={() => titleBarActions}
            onEditorViewReady={() => {
              registerRuntime()
              setLoading(false)
              if (trackingFrameRef.current !== null) cancelAnimationFrame(trackingFrameRef.current)
              trackingFrameRef.current = requestAnimationFrame(() => {
                trackingReadyRef.current = true
              })
            }}
            onChange={() => {
              if (!trackingReadyRef.current) return
              stagedSaveBufferRef.current = null
              markBinaryDirty(document.id)
              recordDocumentTransaction({
                id: crypto.randomUUID(),
                fileId: document.id,
                documentKind: 'docx',
                actor: 'user',
                baseRevision: documentRef.current.revision.sha256,
                createdAt: Date.now()
              } satisfies DocumentTransaction)
            }}
            onSave={(buffer) => {
              stagedSaveBufferRef.current = buffer
              if (!serializingRef.current) void saveDocument(document.id, true)
            }}
            onError={(caught) => {
              setError(errorMessage(caught))
              setLoading(false)
            }}
            loadingIndicator={<DocxLoading />}
          />
        </PluginHost>
      )}

      {(loading || !sourceBuffer) && !error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-surface-elevated text-foreground-muted">
          <DocxLoading />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-surface-elevated p-8 text-center">
          <div>
            <strong className="block text-[14px] text-danger">Could not open this DOCX</strong>
            <span className="mt-2 block max-w-md text-[11px] text-foreground-muted">{error}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DocxLoading(): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 text-[12px]">
      <LoaderCircle className="spinner" size={16} />
      Opening Word document…
    </span>
  )
}

function DocxSaveState({
  status,
  error
}: {
  status: string
  error?: string
}): React.JSX.Element {
  const label = status === 'saving'
    ? 'Saving'
    : status === 'editing'
      ? 'Editing'
      : status === 'conflict'
        ? 'Conflict'
        : status === 'error'
          ? 'Save error'
          : 'Saved'
  const Icon = status === 'saving'
    ? LoaderCircle
    : status === 'editing'
      ? PencilLine
      : status === 'conflict' || status === 'error'
        ? CloudOff
        : CheckCircle2
  return (
    <span
      className={cn(
        'aladdeen-docx-save-state',
        status === 'saved' && 'text-success',
        status === 'conflict' && 'text-warning',
        status === 'error' && 'text-danger'
      )}
      title={error}
      aria-label={`Document status: ${label}`}
    >
      <Icon size={13} className={status === 'saving' ? 'spinner' : undefined} />
      <span>{label}</span>
    </span>
  )
}

function matchedSnippet(match: GlobalSearchMatch): string {
  return match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)
}

function chooseSearchCandidate(
  candidates: Array<{ paraId: string; match: string; before: string; after: string }>,
  match: GlobalSearchMatch,
  matchCase: boolean
): { paraId: string; match: string; before: string; after: string } | undefined {
  if (candidates.length < 2) return candidates[0]
  const normalize = (value: string): string => matchCase ? value : value.toLocaleLowerCase()
  const expectedBefore = normalize(match.snippet.slice(0, match.snippetMatchStart))
  const expectedAfter = normalize(match.snippet.slice(match.snippetMatchEnd))
  return [...candidates].sort((left, right) => {
    const leftScore = contextScore(normalize(left.before), expectedBefore, true)
      + contextScore(normalize(left.after), expectedAfter, false)
    const rightScore = contextScore(normalize(right.before), expectedBefore, true)
      + contextScore(normalize(right.after), expectedAfter, false)
    return rightScore - leftScore
  })[0]
}

function contextScore(actual: string, expected: string, fromEnd: boolean): number {
  const limit = Math.min(actual.length, expected.length, 80)
  let score = 0
  for (let index = 1; index <= limit; index += 1) {
    const actualCharacter = fromEnd ? actual.at(-index) : actual.at(index - 1)
    const expectedCharacter = fromEnd ? expected.at(-index) : expected.at(index - 1)
    if (actualCharacter !== expectedCharacter) break
    score += 1
  }
  return score
}

function findParagraphRange(
  editor: DocxEditorRef,
  paraId: string,
  query: string,
  matchCase: boolean
): { from: number; to: number } | null {
  const state = editor.getEditorRef()?.getState()
  if (!state) return null
  let range: { from: number; to: number } | null = null
  state.doc.descendants((node, position) => {
    if (range || node.attrs.paraId !== paraId) return !range
    const haystack = matchCase ? node.textContent : node.textContent.toLocaleLowerCase()
    const needle = matchCase ? query : query.toLocaleLowerCase()
    const index = haystack.indexOf(needle)
    if (index < 0) return false
    const from = Math.min(position + 1 + index, state.doc.content.size)
    range = {
      from,
      to: Math.min(from + query.length, state.doc.content.size)
    }
    return false
  })
  return range
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'The DOCX document could not be opened.'
}
