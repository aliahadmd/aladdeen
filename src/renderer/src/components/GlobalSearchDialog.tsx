import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import {
  AlertTriangle,
  CaseSensitive,
  Check,
  ChevronDown,
  FileSearch2,
  FileText,
  FolderKanban,
  LoaderCircle,
  Search,
  WholeWord,
  X
} from 'lucide-react'
import type {
  GlobalSearchEvent,
  GlobalSearchMatch,
  GlobalSearchScope,
  GlobalSearchSummary
} from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { dialogOverlayClasses } from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'

interface SearchProgress {
  scannedFiles: number
  totalFiles: number
  skippedFiles: number
}

interface ResultGroup {
  key: string
  name: string
  location: string
  matches: Array<{ match: GlobalSearchMatch; index: number }>
  truncated: boolean
}

export function GlobalSearchDialog(): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const documents = useAppStore((state) => state.documents)
  const open = useAppStore((state) => state.globalSearchOpen)
  const setOpen = useAppStore((state) => state.setGlobalSearchOpen)
  const openSearchMatch = useAppStore((state) => state.openSearchMatch)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scope, setScope] = useState<GlobalSearchScope>({ kind: 'environment' })
  const [results, setResults] = useState<GlobalSearchMatch[]>([])
  const [summary, setSummary] = useState<GlobalSearchSummary | null>(null)
  const [progress, setProgress] = useState<SearchProgress>({ scannedFiles: 0, totalFiles: 0, skippedFiles: 0 })
  const [status, setStatus] = useState<'idle' | 'searching' | 'complete' | 'error'>('idle')
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const activeSession = useRef<string | null>(null)
  const activeSearchKey = useRef<string | null>(null)
  const completedSearchKey = useRef<string | null>(null)
  const requestId = useRef(0)
  const resultViewport = useRef<HTMLDivElement | null>(null)
  const environmentId = environment?.environment.id

  const cancelCurrent = useCallback((): void => {
    requestId.current += 1
    const sessionId = activeSession.current
    activeSession.current = null
    if (sessionId) void window.aladdeen.search.cancel(sessionId)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        if (environment) setOpen(true)
      }
    }
    const offOpenRequest = window.aladdeen.search.onOpenRequest(() => {
      if (environment) setOpen(true)
    })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      offOpenRequest()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [environment, setOpen])

  useEffect(() => {
    const offEvent = window.aladdeen.search.onEvent((event: GlobalSearchEvent) => {
      if (event.sessionId !== activeSession.current) return
      if (event.type === 'batch') {
        setResults((current) => [...current, ...event.matches])
        setProgress({
          scannedFiles: event.scannedFiles,
          totalFiles: event.totalFiles,
          skippedFiles: event.skippedFiles
        })
      } else if (event.type === 'complete') {
        activeSession.current = null
        completedSearchKey.current = activeSearchKey.current
        setSummary(event.summary)
        setProgress({
          scannedFiles: event.summary.scannedFiles,
          totalFiles: event.summary.totalFiles,
          skippedFiles: event.summary.skippedFiles
        })
        setStatus('complete')
      } else if (event.type === 'error') {
        activeSession.current = null
        activeSearchKey.current = null
        setError(event.error.message)
        setStatus('error')
      } else {
        activeSession.current = null
        activeSearchKey.current = null
        setStatus('idle')
      }
    })
    return offEvent
  }, [])

  useEffect(() => {
    cancelCurrent()
    setOpen(false)
    setQuery('')
    setResults([])
    setSummary(null)
    setProgress({ scannedFiles: 0, totalFiles: 0, skippedFiles: 0 })
    setStatus('idle')
    setError('')
    setScope({ kind: 'environment' })
    activeSearchKey.current = null
    completedSearchKey.current = null
  }, [cancelCurrent, environmentId, setOpen])

  const runSearch = useCallback(async (allowSingleCharacter = false): Promise<void> => {
    const normalizedQuery = query.trim()
    if (!environment || (!allowSingleCharacter && normalizedQuery.length < 2) || normalizedQuery.length === 0) return

    const currentRequest = ++requestId.current
    const searchKey = createSearchKey(normalizedQuery, matchCase, wholeWord, scope)
    const priorSession = activeSession.current
    activeSession.current = null
    if (priorSession) await window.aladdeen.search.cancel(priorSession)
    setResults([])
    setSummary(null)
    setProgress({ scannedFiles: 0, totalFiles: 0, skippedFiles: 0 })
    setStatus('searching')
    setError('')
    setActiveIndex(0)
    activeSearchKey.current = searchKey
    completedSearchKey.current = null

    const result = await window.aladdeen.search.start({
      query: normalizedQuery,
      matchCase,
      wholeWord,
      scope,
      bufferOverrides: documents
        .filter((document) => !document.deleted && document.content !== document.savedContent)
        .map((document) => ({ fileId: document.id, content: document.content }))
    })
    if (currentRequest !== requestId.current) {
      if (result.ok) void window.aladdeen.search.cancel(result.value.sessionId)
      return
    }
    if (!result.ok) {
      activeSearchKey.current = null
      setStatus('error')
      setError(result.error.message)
      return
    }
    activeSession.current = result.value.sessionId
  }, [documents, environment, matchCase, query, scope, wholeWord])

  useEffect(() => {
    if (!open) return
    const searchKey = createSearchKey(query.trim(), matchCase, wholeWord, scope)
    if (completedSearchKey.current === searchKey) return
    if (query.trim().length < 2) {
      cancelCurrent()
      setResults([])
      setSummary(null)
      setProgress({ scannedFiles: 0, totalFiles: 0, skippedFiles: 0 })
      setStatus('idle')
      completedSearchKey.current = null
      return
    }
    const timer = window.setTimeout(() => void runSearch(), 250)
    return () => window.clearTimeout(timer)
  }, [cancelCurrent, matchCase, open, query, runSearch, scope, wholeWord])

  useEffect(() => {
    const active = resultViewport.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const groups = useMemo(() => groupResults(results), [results])
  const scopeLabel = getScopeLabel(scope, environment)

  const choose = (match: GlobalSearchMatch): void => {
    cancelCurrent()
    void openSearchMatch(match, query.trim(), matchCase, wholeWord)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) cancelCurrent()
    setOpen(nextOpen)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(dialogOverlayClasses, 'global-search-overlay')} />
        <Dialog.Content className="global-search-dialog">
          <Dialog.Title className="sr-only">Search Markdown contents</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Markdown source across the active environment.
          </Dialog.Description>

          <header className="global-search-header">
            <div className="global-search-title">
              <FileSearch2 size={17} />
              <span>Search contents</span>
            </div>
            <Dialog.Close className="global-search-close" aria-label="Close search"><X size={16} /></Dialog.Close>
          </header>

          <div className="global-search-controls">
            <label className="global-search-field">
              <Search size={17} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value.replace(/[\r\n]/g, ''))}
                placeholder="Search Markdown source…"
                aria-label="Search Markdown source"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && results.length > 0) {
                    event.preventDefault()
                    setActiveIndex((index) => Math.min(results.length - 1, index + 1))
                  } else if (event.key === 'ArrowUp' && results.length > 0) {
                    event.preventDefault()
                    setActiveIndex((index) => Math.max(0, index - 1))
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    if (results[activeIndex]) choose(results[activeIndex])
                    else void runSearch(true)
                  }
                }}
              />
              {status === 'searching' && <LoaderCircle className="spinner" size={15} aria-label="Searching" />}
              {query && status !== 'searching' && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>
              )}
            </label>

            <div className="global-search-options">
              <ScopePicker
                scope={scope}
                label={scopeLabel}
                projects={environment?.projects.filter((project) => !project.archived) ?? []}
                onChange={setScope}
              />
              <button
                type="button"
                className={matchCase ? 'is-active' : ''}
                aria-pressed={matchCase}
                aria-label="Match case"
                title="Match case"
                onClick={() => setMatchCase((value) => !value)}
              >
                <CaseSensitive size={17} />
              </button>
              <button
                type="button"
                className={wholeWord ? 'is-active' : ''}
                aria-pressed={wholeWord}
                aria-label="Match whole word"
                title="Match whole word"
                onClick={() => setWholeWord((value) => !value)}
              >
                <WholeWord size={17} />
              </button>
            </div>
          </div>

          <div className="global-search-status" aria-live="polite">
            <SearchStatus status={status} query={query} results={results} summary={summary} progress={progress} error={error} />
          </div>

          <div
            className="global-search-results"
            ref={resultViewport}
            role="listbox"
            aria-label="Content search results"
          >
            {groups.map((group) => (
              <section className="global-search-group" key={group.key} aria-label={group.name}>
                <div className="global-search-group-heading">
                  <FileText size={14} />
                  <span><strong>{group.name}</strong><small>{group.location}</small></span>
                  <b>{group.matches.length}{group.truncated ? '+' : ''}</b>
                </div>
                {group.matches.map(({ match, index }) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? 'is-active' : ''}
                    data-search-index={index}
                    key={match.id}
                    onPointerMove={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => choose(match)}
                  >
                    <span className="global-search-line">{match.lineNumber}</span>
                    <code>
                      {match.snippet.slice(0, match.snippetMatchStart)}
                      <mark>{match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)}</mark>
                      {match.snippet.slice(match.snippetMatchEnd)}
                    </code>
                  </button>
                ))}
              </section>
            ))}

            {results.length === 0 && status !== 'searching' && (
              <div className="flex min-h-[210px] flex-col items-center justify-center gap-[9px] text-center text-[10px] text-foreground-muted">
                {status === 'error' ? <AlertTriangle size={20} /> : <FileSearch2 size={20} />}
                <span className="max-w-[390px] leading-[1.5]">
                  {status === 'error'
                    ? 'Search could not be completed.'
                    : query.trim().length === 1
                      ? 'Press Enter to search for one character.'
                      : query.trim().length > 1
                        ? 'No Markdown source matches this search.'
                        : 'Search every selected Markdown file without importing its content.'}
                </span>
              </div>
            )}
          </div>

          <footer className="global-search-footer">
            <span>↑↓ Navigate</span><span>↵ Open match</span><span>Esc Close</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ScopePicker({
  scope,
  label,
  projects,
  onChange
}: {
  scope: GlobalSearchScope
  label: string
  projects: Array<{ id: string; name: string; displayPath: string }>
  onChange: (scope: GlobalSearchScope) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLocaleLowerCase()
  const visibleProjects = projects.filter((project) =>
    `${project.name} ${project.displayPath}`.toLocaleLowerCase().includes(needle)
  )
  const choose = (nextScope: GlobalSearchScope): void => {
    onChange(nextScope)
    setFilter('')
    setOpen(false)
  }

  return (
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="global-search-scope" title={label}>
          <span>{label}</span><ChevronDown size={13} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="global-search-scope-popover" sideOffset={5} align="start">
          <label><Search size={13} /><input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter projects…" /></label>
          <div className="global-search-scope-list">
            <ScopeOption active={scope.kind === 'environment'} icon={<FolderKanban size={14} />} label="Entire environment" onClick={() => choose({ kind: 'environment' })} />
            <ScopeOption active={scope.kind === 'standalone'} icon={<FileText size={14} />} label="Standalone files" onClick={() => choose({ kind: 'standalone' })} />
            {visibleProjects.map((project) => (
              <ScopeOption
                key={project.id}
                active={scope.kind === 'project' && scope.projectId === project.id}
                icon={<FolderKanban size={14} />}
                label={project.name}
                secondary={project.displayPath}
                onClick={() => choose({ kind: 'project', projectId: project.id })}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ScopeOption({
  active,
  icon,
  label,
  secondary,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  secondary?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={active ? 'is-active' : ''} onClick={onClick}>
      {icon}<span><strong>{label}</strong>{secondary && <small>{secondary}</small>}</span>
      {active && <Check size={13} />}
    </button>
  )
}

function SearchStatus({
  status,
  query,
  results,
  summary,
  progress,
  error
}: {
  status: 'idle' | 'searching' | 'complete' | 'error'
  query: string
  results: GlobalSearchMatch[]
  summary: GlobalSearchSummary | null
  progress: SearchProgress
  error: string
}): React.JSX.Element {
  if (status === 'error') return <><AlertTriangle size={13} /><span>{error}</span></>
  if (status === 'searching') {
    return <><span>Searching {progress.scannedFiles.toLocaleString()} of {progress.totalFiles ? progress.totalFiles.toLocaleString() : '…'} files</span><span>{results.length.toLocaleString()} matches</span></>
  }
  if (summary) {
    return (
      <>
        <span>{summary.totalMatches.toLocaleString()} matches in {summary.matchedFiles.toLocaleString()} files</span>
        {summary.skippedFiles > 0 && <span>{summary.skippedFiles.toLocaleString()} skipped</span>}
        {summary.truncated && <span>Result limit reached</span>}
      </>
    )
  }
  return <span>{query.trim().length < 2 ? 'Type at least two characters, or press Enter for one.' : 'Ready'}</span>
}

function groupResults(results: GlobalSearchMatch[]): ResultGroup[] {
  const groups = new Map<string, ResultGroup>()
  results.forEach((match, index) => {
    const key = match.target.kind === 'project'
      ? `project:${match.target.projectId}:${match.target.relativePath}`
      : `tracked:${match.target.fileId}`
    const group = groups.get(key) ?? {
      key,
      name: match.name,
      location: match.location,
      matches: [],
      truncated: false
    }
    group.matches.push({ match, index })
    group.truncated ||= match.fileTruncated
    groups.set(key, group)
  })
  return [...groups.values()]
}

function getScopeLabel(
  scope: GlobalSearchScope,
  environment: ReturnType<typeof useAppStore.getState>['environment']
): string {
  if (scope.kind === 'environment') return 'Entire environment'
  if (scope.kind === 'standalone') return 'Standalone files'
  return environment?.projects.find((project) => project.id === scope.projectId)?.name ?? 'Project'
}

function createSearchKey(
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  scope: GlobalSearchScope
): string {
  const scopeKey = scope.kind === 'project' ? `project:${scope.projectId}` : scope.kind
  return JSON.stringify([query, matchCase, wholeWord, scopeKey])
}
