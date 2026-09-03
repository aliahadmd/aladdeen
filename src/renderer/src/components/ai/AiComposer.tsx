import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, Square } from 'lucide-react'
import type { AiMentionedFile, AiMode, AiModelInfo, AiReasoning, IndexedFileSummary } from '@shared/contracts'
import { AI_MODES, AI_MODE_DESCRIPTIONS, AI_REASONING_LEVELS } from '@shared/ai'
import { cn } from '@renderer/lib/cn'
import { DocumentKindIcon } from '@renderer/components/DocumentKindIcon'
import { useAiStore } from '@renderer/store/ai-store'
import type { AppSettings } from '@shared/contracts'

interface AiComposerProps {
  settings: AppSettings
  projectId: string | null
  projectName: string | null
  onSend(content: string, mentioned: AiMentionedFile[]): void
  onCancel(): void
  onUpdateSettings(next: Partial<AppSettings>): void
}

interface MentionDraft {
  query: string
  startIndex: number
}

export function AiComposer({
  settings,
  projectId,
  projectName,
  onSend,
  onCancel,
  onUpdateSettings
}: AiComposerProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState<MentionDraft | null>(null)
  const [candidates, setCandidates] = useState<IndexedFileSummary[]>([])
  const [activeCandidate, setActiveCandidate] = useState(0)
  const [mentioned, setMentioned] = useState<AiMentionedFile[]>([])
  const [models, setModels] = useState<AiModelInfo[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runStatus = useAiStore((state) => state.runStatus)
  const requestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    window.aladdeen.ai.listModels(settings.aiProvider).then((result) => {
      if (cancelled) return
      if (result.ok) setModels(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [settings.aiProvider])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
  }, [draft])

  useEffect(() => {
    if (!mention) {
      setCandidates([])
      return
    }
    const current = ++requestId.current
    const timeout = setTimeout(() => {
      const query = mention.query
      const source = projectId !== null
        ? window.aladdeen.projects.listFiles(projectId)
        : window.aladdeen.projects.search(query, 40)
      void source.then((result) => {
        if (current !== requestId.current || !result.ok) return
        const files = result.value.filter((file) => {
          if (mentioned.some((entry) => entry.relativePath === file.relativePath && entry.projectId === file.projectId)) return false
          if (projectId !== null && file.projectId !== projectId && query === '') return false
          return query === '' || file.relativePath.toLowerCase().includes(query.toLowerCase())
        })
        setCandidates(files.slice(0, 40))
        setActiveCandidate(0)
      })
    }, 80)
    return () => {
      clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention?.query, mention === null, projectId])

  const disabled = runStatus !== 'idle'

  const updateMention = (value: string, caret: number): void => {
    const upToCaret = value.slice(0, caret)
    const match = /(^|\s)@([^\s@]*)$/u.exec(upToCaret)
    if (match) {
      const query = match[2] ?? ''
      setMention({ query, startIndex: caret - query.length - 1 })
    } else {
      setMention(null)
    }
  }

  const pickCandidate = (file: IndexedFileSummary): void => {
    const currentMention = mention
    if (!currentMention) return
    setMentioned((current) => [
      ...current,
      { projectId: file.projectId, relativePath: file.relativePath }
    ])
    setDraft((current) => {
      const before = current.slice(0, currentMention.startIndex)
      const after = current.slice(currentMention.startIndex + 1 + currentMention.query.length)
      return `${before}${after}`
    })
    setMention(null)
    textareaRef.current?.focus()
  }

  const submit = (): void => {
    if (disabled) return
    const content = draft.trim()
    if (content === '' && mentioned.length === 0) return
    const lines = mentioned.map((entry) => `@${entry.relativePath}`)
    onSend([...lines, content].filter((part) => part !== '').join('\n'), mentioned)
    setDraft('')
    setMentioned([])
    setMention(null)
  }

  const reasonLabel = useMemo(() => ({ low: 'Low', medium: 'Med', high: 'High', max: 'Max' }), [])

  return (
    <div className="border-t border-border bg-surface p-3">
      {mentioned.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {mentioned.map((entry) => (
            <span
              key={`${entry.projectId}/${entry.relativePath}`}
              className="flex items-center gap-1 rounded-full border border-accent-muted bg-accent-soft px-2 py-[2px] text-[11px] text-foreground"
            >
              <FileText size={11} />
              {entry.relativePath}
              <button
                type="button"
                className="text-foreground-muted hover:text-foreground"
                onClick={() => setMentioned((current) => current.filter((item) => item !== entry))}
                aria-label={`Remove ${entry.relativePath}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        {mention !== null && candidates.length > 0 && (
          <div
            className="absolute bottom-full left-0 z-10 mb-2 max-h-[240px] w-full overflow-y-auto rounded-[10px] border border-border bg-surface-elevated p-1 shadow-[0_12px_40px_rgb(0_0_0/.18)]"
            role="listbox"
            aria-label="Attach files"
          >
            {candidates.map((file, index) => (
              <button
                key={`${file.projectId}/${file.relativePath}`}
                type="button"
                role="option"
                aria-selected={index === activeCandidate}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[7px] border-0 bg-transparent px-2 py-[6px] text-left text-[12px] text-foreground',
                  index === activeCandidate && 'bg-accent-soft'
                )}
                onPointerMove={() => setActiveCandidate(index)}
                onClick={() => pickCandidate(file)}
              >
                <DocumentKindIcon kind={file.documentKind} />
                <span className="truncate font-medium">{file.name}</span>
                <span className="truncate text-[11px] text-foreground-muted">
                  {projectName !== null && file.projectId !== projectId ? `${file.location}` : file.relativePath}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="max-h-[180px] w-full resize-none rounded-[10px] border border-border bg-surface-elevated px-3 py-[10px] pr-11 text-[13px] leading-[1.5] text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
          rows={1}
          placeholder={
            projectId !== null
              ? `Ask about “${projectName}” — type @ to attach files`
              : 'Open a document to give the AI project context, or just ask.'
          }
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }}
          onKeyDown={(event) => {
            if (mention !== null && candidates.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveCandidate((index) => Math.min(index + 1, candidates.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveCandidate((index) => Math.max(index - 1, 0))
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                const selection = candidates[activeCandidate]
                if (selection) pickCandidate(selection)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMention(null)
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className={cn(
            'absolute bottom-[9px] right-[9px] grid h-7 w-7 place-items-center rounded-full border-0 transition-[filter] active:scale-[.94]',
            disabled
              ? 'bg-surface-hover text-foreground-soft'
              : 'bg-accent text-accent-contrast hover:brightness-110'
          )}
          onClick={() => (disabled ? onCancel() : submit())}
          disabled={!disabled && draft.trim() === '' && mentioned.length === 0}
          aria-label={disabled ? 'Stop response' : 'Send message'}
        >
          {disabled ? <Square size={12} /> : <ArrowUp size={14} />}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-[6px] text-[11px]">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Model</span>
          <select
            className="h-7 w-full truncate rounded-[7px] border border-border bg-surface px-[6px] text-foreground-soft outline-none focus:border-accent"
            value={models.some((model) => model.id === settings.aiModelId) ? settings.aiModelId : ''}
            onChange={(event) => onUpdateSettings({ aiModelId: event.target.value })}
            aria-label="Model"
          >
            {models.length === 0 && <option value="">{settings.aiModelId || 'No models'}</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
            {!models.some((model) => model.id === settings.aiModelId) && settings.aiModelId !== '' && (
              <option value={settings.aiModelId}>{settings.aiModelId}</option>
            )}
          </select>
        </label>
        <label>
          <span className="sr-only">Reasoning</span>
          <select
            className="h-7 rounded-[7px] border border-border bg-surface px-[6px] text-foreground-soft outline-none focus:border-accent"
            value={settings.aiReasoning}
            onChange={(event) => onUpdateSettings({ aiReasoning: event.target.value as AiReasoning })}
            aria-label="Reasoning effort"
          >
            {AI_REASONING_LEVELS.map((level) => (
              <option key={level} value={level}>{reasonLabel[level]}</option>
            ))}
          </select>
        </label>
        <label title={AI_MODE_DESCRIPTIONS[settings.aiMode]}>
          <span className="sr-only">Tool policy</span>
          <select
            className={cn(
              'h-7 rounded-[7px] border border-border bg-surface px-[6px] outline-none focus:border-accent',
              settings.aiMode === 'full' ? 'text-warning' : 'text-foreground-soft'
            )}
            value={settings.aiMode}
            onChange={(event) => onUpdateSettings({ aiMode: event.target.value as AiMode })}
            aria-label="Tool policy"
          >
            <option value={AI_MODES[0]}>Plan</option>
            <option value={AI_MODES[1]}>Ask first</option>
            <option value={AI_MODES[2]}>Full access</option>
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1 text-foreground-muted">
          {runStatus !== 'idle' && <Loader2 size={11} className="animate-spin" />}
          {runStatus === 'awaiting-approval' ? 'Waiting for you' : runStatus === 'streaming' ? 'Working…' : ''}
        </span>
      </div>
    </div>
  )
}
