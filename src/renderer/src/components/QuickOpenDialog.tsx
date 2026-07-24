import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Search } from 'lucide-react'
import type { IndexedFileSummary } from '@shared/contracts'
import { useAppStore } from '@renderer/store/app-store'

export function QuickOpenDialog(): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const openDocument = useAppStore((state) => state.openDocument)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IndexedFileSummary[]>([])
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
    const timer = setTimeout(() => {
      void window.aladdeen.projects.search(query, 60).then((result) => {
        if (currentRequest !== requestId.current || !result.ok) return
        setResults(result.value)
        setActiveIndex(0)
      })
    }, query ? 120 : 0)
    return () => clearTimeout(timer)
  }, [environment, open, query])

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
        <Dialog.Overlay className="dialog-overlay quick-open-overlay" />
        <Dialog.Content className="quick-open-dialog">
          <Dialog.Title className="sr-only">Quick open Markdown file</Dialog.Title>
          <label className="quick-open-search">
            <Search size={17} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search indexed Markdown files…"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveIndex((index) => Math.min(results.length - 1, index + 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveIndex((index) => Math.max(0, index - 1))
                } else if (event.key === 'Enter' && results[activeIndex]) {
                  event.preventDefault()
                  choose(results[activeIndex])
                }
              }}
            />
            <kbd>⌘P</kbd>
          </label>
          <div className="quick-open-results" role="listbox" aria-label="Indexed Markdown files">
            {results.map((file, index) => (
              <button
                key={`${file.projectId}:${file.relativePath}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'is-active' : ''}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(file)}
              >
                <FileText size={15} />
                <span><strong>{file.name}</strong><small>{file.location}</small></span>
              </button>
            ))}
            {results.length === 0 && <div className="quick-open-empty">{query ? 'No indexed files match your search.' : 'No project files are indexed yet.'}</div>}
          </div>
          <div className="quick-open-footer"><span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
