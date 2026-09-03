import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FilePlus2, Loader2, Plus, ShieldAlert, Sparkles, X } from 'lucide-react'
import type { AiChatMessage, AiContentBlock } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useAppStore } from '@renderer/store/app-store'
import { refreshAiSessions, sendAiMessage, useAiStore } from '@renderer/store/ai-store'
import { MarkdownContent } from '@renderer/components/MarkdownContent'
import { AiComposer } from './AiComposer'

// Stable empty reference: an inline `?? []` inside a zustand selector would
// return a fresh array each notification and loop React into an update storm.
const EMPTY_MESSAGES: AiChatMessage[] = []

export function AiPanel(): React.JSX.Element {
  const dark = useEffectiveDarkMode()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const environment = useAppStore((state) => state.environment)
  const documents = useAppStore((state) => state.documents)
  const activeFileId = useAppStore((state) => state.activeFileId)

  const sessions = useAiStore((state) => state.sessions)
  const activeSessionId = useAiStore((state) => state.activeSessionId)
  const messagesBySession = useAiStore((state) => state.messagesBySession)
  const messages = activeSessionId !== null ? messagesBySession[activeSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  const runStatus = useAiStore((state) => state.runStatus)
  const pendingApproval = useAiStore((state) => state.pendingApproval)
  const applyEvent = useAiStore((state) => state.applyEvent)
  const openSession = useAiStore((state) => state.openSession)

  const bootstrapped = useRef(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const activeDocument = documents.find((document) => document.id === activeFileId)
  const projectId = activeDocument?.projectId ?? null
  const project = environment?.projects.find((entry) => entry.id === projectId) ?? null

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void (async () => {
      const unsubscribe = window.aladdeen.ai.onEvent((event) => applyEvent(event))
      void refreshAiSessions().then(async () => {
        const { sessions: current, openSession: open } = useAiStore.getState()
        const first = current[0]
        if (first) {
          const result = await window.aladdeen.ai.getSession(first.id)
          if (result.ok) open(result.value, result.value.messages)
          return
        }
        const created = await window.aladdeen.ai.createSession(null)
        if (created.ok) open(created.value, [])
      })
      return unsubscribe
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, runStatus])

  const projectName = project?.name ?? null
  const contextProjectId = project?.id ?? null

  const startNewChat = async (): Promise<void> => {
    const created = await window.aladdeen.ai.createSession(contextProjectId)
    if (created.ok) {
      openSession(created.value, [])
      void refreshAiSessions()
    }
  }

  const switchSession = async (sessionId: string): Promise<void> => {
    const result = await window.aladdeen.ai.getSession(sessionId)
    if (result.ok) openSession(result.value, result.value.messages)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-border bg-[color-mix(in_oklab,var(--surface)_98%,var(--bg))]">
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles size={14} className="text-accent" />
        <span className="text-[13px] font-[620] text-foreground">AI</span>
        <select
          className="ml-auto h-7 max-w-[150px] truncate rounded-[7px] border border-border bg-surface px-[6px] text-[11px] text-foreground-soft outline-none focus:border-accent"
          value={activeSessionId ?? ''}
          onChange={(event) => void switchSession(event.target.value)}
          aria-label="Chat session"
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>{session.title}</option>
          ))}
        </select>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-[7px] border border-border bg-surface text-foreground-soft transition-colors hover:bg-surface-hover hover:text-foreground"
          onClick={() => void startNewChat()}
          aria-label="New chat"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-[7px] text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          onClick={() => void updateSettings({ aiPanelCollapsed: true })}
          aria-label="Close AI panel"
        >
          <X size={14} />
        </button>
      </div>

      {project && (
        <div className="flex shrink-0 items-center gap-[6px] border-b border-border bg-surface-muted/60 px-3 py-[6px] text-[11px] text-foreground-soft">
          <span className="h-[6px] w-[6px] rounded-full bg-success" aria-hidden />
          Context: <span className="font-semibold text-foreground">{project.name}</span>
          <span className="text-foreground-muted">· new chats inherit this project</span>
        </div>
      )}

      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="grid gap-2 pt-10 text-center">
            <FilePlus2 size={22} className="mx-auto text-foreground-muted" />
            <p className="m-0 text-[13px] font-[620] text-foreground">Ask about your research</p>
            <p className="m-0 text-[12px] leading-[1.5] text-foreground-muted">
              The AI can list, read, and (depending on the tool policy) edit files in your project.
              Type <kbd className="rounded border border-border bg-surface px-1 text-[11px]">@</kbd> to attach files.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {messages.map((message) => (
              <AiMessage
                key={message.id}
                message={message}
                dark={dark}
                streaming={runStatus === 'streaming' && message.role === 'assistant' && message === messages[messages.length - 1] && message.blocks.length <= 1}
              />
            ))}
            {pendingApproval && (
              <ApprovalCard
                requestId={pendingApproval.requestId}
                name={pendingApproval.name}
                input={pendingApproval.input}
              />
            )}
          </div>
        )}
      </div>

      <AiComposer
        settings={settings}
        projectId={contextProjectId}
        projectName={projectName}
        onSend={(content, mentioned) => void sendAiMessage(content, mentioned)}
        onCancel={() => {
          if (activeSessionId) void window.aladdeen.ai.cancel(activeSessionId)
        }}
        onUpdateSettings={(next) => void updateSettings(next)}
      />
    </div>
  )
}

function AiMessage({
  message,
  dark,
  streaming
}: {
  message: AiChatMessage
  dark: boolean
  streaming: boolean
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="ml-6 rounded-[12px] rounded-tr-[4px] border border-border bg-surface-elevated px-3 py-2">
        <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.5] text-foreground">
          {message.blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')}
        </p>
      </div>
    )
  }
  const showCursor = streaming
  return (
    <div className="grid gap-[6px]">
      {message.blocks.map((block, index) => (
        <AiBlock key={index} block={block} dark={dark} showCursor={showCursor && index === message.blocks.length - 1} />
      ))}
      {message.blocks.length === 0 && (
        <div className="flex items-center gap-2 text-[12px] text-foreground-muted">
          <Loader2 size={12} className="animate-spin" /> Thinking…
        </div>
      )}
    </div>
  )
}

function AiBlock({
  block,
  dark,
  showCursor
}: {
  block: AiContentBlock
  dark: boolean
  showCursor: boolean
}): React.JSX.Element | null {
  const [thinkingOpen, setThinkingOpen] = useState(false)

  if (block.type === 'thinking') {
    return (
      <details className="group rounded-[9px] border border-border bg-surface" open={thinkingOpen}>
        <summary
          className="flex cursor-pointer select-none items-center gap-1 px-2 py-[6px] text-[11px] font-semibold text-foreground-muted marker:content-[''] hover:text-foreground"
          onClick={(event) => {
            event.preventDefault()
            setThinkingOpen((value) => !value)
          }}
        >
          <ChevronDown size={12} className={cn('transition-transform', thinkingOpen && 'rotate-180')} />
          Reasoning
        </summary>
        <p className="m-0 whitespace-pre-wrap border-t border-border px-2 py-2 text-[11px] leading-[1.55] text-foreground-soft">
          {block.text}
        </p>
      </details>
    )
  }
  if (block.type === 'tool_use') {
    return (
      <div className="flex items-center gap-[6px] self-start rounded-full border border-border bg-surface px-2 py-[3px] text-[11px] text-foreground-soft">
        <span className="font-semibold text-accent">{block.name}</span>
        <span className="max-w-[220px] truncate">{describeToolInput(block)}</span>
        <Loader2 size={10} className="animate-spin text-foreground-muted" />
      </div>
    )
  }
  if (block.type === 'tool_result') return null
  return (
    <div className="min-w-0 [&_.markdown-body]:text-[13px]">
      <MarkdownContent
        content={block.text + (showCursor ? ' ▍' : '')}
        documentId={`ai-${block.text.length}-${dark ? 'd' : 'l'}`}
        fallbackTitle="AI response"
        theme={dark ? 'dark' : 'light'}
        sourceNavigationEnabled={false}
      />
    </div>
  )
}

function describeToolInput(block: Extract<AiContentBlock, { type: 'tool_use' }>): string {
  const input = block.input as { relative_path?: string; project_id?: string }
  if (typeof input.relative_path === 'string') return input.relative_path
  if (block.name === 'list_files') return 'listing project files'
  return ''
}

function ApprovalCard({
  requestId,
  name,
  input
}: {
  requestId: string
  name: string
  input: Record<string, unknown>
}): React.JSX.Element {
  const [resolving, setResolving] = useState(false)
  const relativePath = typeof (input as { relative_path?: string }).relative_path === 'string'
    ? (input as { relative_path?: string }).relative_path
    : ''

  const resolve = (approved: boolean): void => {
    setResolving(true)
    void window.aladdeen.ai.approve(requestId, approved)
  }

  return (
    <div className="rounded-[11px] border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,var(--surface-elevated))] p-3">
      <div className="flex items-center gap-[6px] text-[12px] font-[620] text-foreground">
        <ShieldAlert size={13} className="text-warning" />
        The AI wants to {name === 'write_file' ? 'modify a file' : 'run a tool'}
      </div>
      {relativePath !== '' && (
        <p className="m-0 mt-1 font-mono text-[11px] text-foreground-soft">{relativePath}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-[7px] border border-transparent bg-accent px-3 text-[11px] font-semibold text-accent-contrast transition-[filter] hover:brightness-110 active:scale-[.97]"
          onClick={() => resolve(true)}
          disabled={resolving}
        >
          {resolving ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Approve
        </button>
        <button
          type="button"
          className="h-7 rounded-[7px] border border-border bg-surface px-3 text-[11px] font-semibold text-foreground-soft transition-colors hover:bg-surface-hover"
          onClick={() => resolve(false)}
          disabled={resolving}
        >
          Decline
        </button>
      </div>
    </div>
  )
}
