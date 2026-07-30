import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { cn } from '@renderer/lib/cn'

export function AgentComposer(): React.JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runState = useAppStore((state) => state.agentRunState)
  const session = useAppStore((state) => state.agentSession)
  const send = useAppStore((state) => state.sendAgentPrompt)
  const abort = useAppStore((state) => state.abortAgent)
  const running = runState !== 'idle'

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(140, Math.max(36, textarea.scrollHeight))}px`
  }, [message])

  const submit = (): void => {
    const text = message.trim()
    if (!text) return
    setMessage('')
    void send(text)
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface px-2.5 py-2.5">
      <div className="relative rounded-xl border border-border-strong bg-surface-elevated shadow-[0_2px_9px_rgb(0_0_0/.05)] focus-within:border-accent focus-within:shadow-[0_0_0_2px_var(--accent-soft)]">
        <textarea
          ref={textareaRef}
          value={message}
          rows={1}
          className="block min-h-9 max-h-[140px] w-full resize-none border-0 bg-transparent py-2 pr-11 pl-3 text-[11px] leading-5 text-foreground outline-none placeholder:text-foreground-muted"
          placeholder={running ? 'Steer the agent…' : session ? 'Ask about this project…' : 'Start a conversation…'}
          aria-label="Message the coding agent"
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        <button
          type="button"
          className={cn(
            'absolute right-1.5 bottom-1.5 grid h-7 w-7 place-items-center rounded-lg border-0 p-0 transition-transform active:scale-[.94]',
            running
              ? 'bg-foreground text-surface'
              : 'bg-accent text-accent-contrast disabled:opacity-35'
          )}
          aria-label={running ? 'Stop agent' : 'Send message'}
          title={running ? 'Stop' : 'Send'}
          disabled={!running && !message.trim()}
          onClick={() => running ? void abort() : submit()}
        >
          {running ? <Square size={11} fill="currentColor" /> : <ArrowUp size={14} />}
        </button>
      </div>
      <p className="mt-1.5 mb-0 px-1 text-[8px] text-foreground-muted">
        Enter to send · Shift+Enter for a new line{running ? ' · new messages steer the run' : ''}
      </p>
    </div>
  )
}
