import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Search } from 'lucide-react'
import type { IndexedFileSummary } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { dialogOverlayClasses } from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'

export function QuickOpenDialog(): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const openDocument = useAppStore((state) => state.openDocument)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IndexedFileSummary[]>([])
  const [resultQuery, setResultQuery] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        if (environment) setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [environment])

  useEffect(() => {
    if (!open || !environment) return
    const currentRequest = ++requestId.current
    setResults([])
    setResultQuery(null)
    setActiveIndex(0)
    const timer = setTimeout(() => {
      void window.aladdeen.projects.search(query, 60).then((result) => {
        if (currentRequest !== requestId.current || !result.ok) return
        setResults(result.value)
        setResultQuery(query)
        setActiveIndex(0)
      })
    }, query ? 120 : 0)
    return () => clearTimeout(timer)
  }, [environment, open, query])

  const currentResults = resultQuery === query ? results : []

  const choose = (file: IndexedFileSummary): void => {
    setOpen(false)
    setQuery('')
    void openDocument({ kind: 'project', projectId: file.projectId, relativePath: file.relativePath })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => {
      setOpen(value)
      if (!value) setQuery('')
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(dialogOverlayClasses, 'quick-open-overlay backdrop-blur-[2px]')} />
        <Dialog.Content className="quick-open-dialog fixed top-[min(18vh,150px)] left-1/2 z-[201] w-[min(calc(100vw-32px),640px)] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface-elevated shadow-[0_28px_80px_rgb(0_0_0/.28)]">
          <Dialog.Title className="sr-only">Quick open Markdown file</Dialog.Title>
          <label className="quick-open-search flex h-[51px] items-center gap-[10px] border-b border-border px-[14px] text-foreground-muted">
            <Search size={17} />
            <input
              className="min-w-0 flex-1 select-text border-0 bg-transparent text-[14px] text-foreground outline-0"
              autoFocus
              value={query}
              onChange={(event) => {
                requestId.current += 1
                setQuery(event.target.value)
                setResults([])
                setResultQuery(null)
                setActiveIndex(0)
              }}
              placeholder="Search indexed Markdown files…"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveIndex((index) => Math.max(0, Math.min(currentResults.length - 1, index + 1)))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveIndex((index) => Math.max(0, index - 1))
                } else if (event.key === 'Enter' && currentResults[activeIndex]) {
                  event.preventDefault()
                  choose(currentResults[activeIndex])
                }
              }}
            />
            <kbd className="rounded-[5px] border border-border bg-surface px-[6px] py-[3px] text-[9px] text-foreground-muted">⌘P</kbd>
          </label>
          <div className="quick-open-results max-h-[min(430px,55vh)] overflow-y-auto p-[6px]" role="listbox" aria-label="Indexed Markdown files">
            {currentResults.map((file, index) => (
              <button
                key={`${file.projectId}:${file.relativePath}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex min-h-11 w-full min-w-0 items-center gap-[9px] rounded-[7px] border-0 bg-transparent px-[9px] py-[5px] text-left text-foreground-soft hover:bg-surface-hover hover:text-foreground',
                  index === activeIndex && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
                )}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(file)}
              >
                <FileText size={15} />
                <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"><strong className="block min-w-0 overflow-hidden text-[12px] font-semibold text-ellipsis whitespace-nowrap text-foreground">{file.name}</strong><small className="mt-0.5 block min-w-0 overflow-hidden text-[9px] text-ellipsis whitespace-nowrap text-foreground-muted">{file.location}</small></span>
              </button>
            ))}
            {currentResults.length === 0 && <div className="grid min-h-[120px] place-items-center text-[11px] text-foreground-muted">{query ? 'No indexed files match your search.' : 'No project files are indexed yet.'}</div>}
          </div>
          <div className="quick-open-footer flex h-[29px] items-center gap-[13px] border-t border-border bg-surface px-3 text-[8px] text-foreground-muted"><span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
