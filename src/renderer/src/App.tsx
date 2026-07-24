import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { LoaderCircle, PanelLeftOpen } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import type { CloseRequest } from '@shared/contracts'
import { AddProjectsDialog } from './components/AddProjectsDialog'
import { BrandMark } from './components/BrandMark'
import { CloseRecoveryDialog } from './components/CloseRecoveryDialog'
import { ConflictDialog } from './components/ConflictDialog'
import { DocumentView } from './components/DocumentView'
import { GlobalSearchDialog } from './components/GlobalSearchDialog'
import { OnboardingDialog } from './components/OnboardingDialog'
import { QuickOpenDialog } from './components/QuickOpenDialog'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { useEffectiveDarkMode } from './hooks/use-effective-dark-mode'
import { cn } from './lib/cn'
import { COMPACT_WORKSPACE_QUERY } from './lib/breakpoints'
import { useAppStore } from './store/app-store'

const SIDEBAR_MIN_WIDTH = 248
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 420

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export default function App(): React.JSX.Element {
  const bootStatus = useAppStore((state) => state.bootStatus)
  const initialize = useAppStore((state) => state.initialize)
  const flushDocuments = useAppStore((state) => state.flushDocuments)
  const saveDirtyCopies = useAppStore((state) => state.saveDirtyCopies)
  const environment = useAppStore((state) => state.environment)
  const acceptSystemOpenFile = useAppStore((state) => state.acceptSystemOpenFile)
  const handleEnvironmentEvent = useAppStore((state) => state.handleEnvironmentEvent)
  const openDroppedFile = useAppStore((state) => state.openDroppedFile)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const editing = useAppStore((state) => state.editing)
  const setEditing = useAppStore((state) => state.setEditing)
  const saveDocument = useAppStore((state) => state.saveDocument)
  const addProject = useAppStore((state) => state.addProject)
  const openFile = useAppStore((state) => state.openFile)
  const dark = useEffectiveDarkMode()
  const sidebarWidthRef = useRef(settings.sidebarWidth)
  const resizeState = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null)

  useEffect(() => {
    void initialize()
    const offEvent = window.aladdeen.document.onEvent((event) => void handleEnvironmentEvent(event))
    const offOpenFileRequest = window.aladdeen.document.onOpenFileRequest((request) => void acceptSystemOpenFile(request))
    return () => {
      offEvent()
      offOpenFileRequest()
    }
  }, [acceptSystemOpenFile, handleEnvironmentEvent, initialize])

  useEffect(() => window.aladdeen.lifecycle.onPrepareClose((request) => {
    void flushDocuments().then(async (saved) => {
      if (!saved) {
        toast.error('Aladdeen kept the window open because one or more documents could not be saved.')
        setCloseRequest(request)
      } else {
        setCloseRequest(null)
      }
      await window.aladdeen.lifecycle.completeClose({
        requestId: request.id,
        outcome: saved ? 'ready' : 'blocked'
      })
    })
  }), [flushDocuments])

  const completeRecovery = async (outcome: 'ready' | 'blocked' | 'cancelled'): Promise<void> => {
    if (!closeRequest) return
    const requestId = closeRequest.id
    if (outcome !== 'blocked') setCloseRequest(null)
    await window.aladdeen.lifecycle.completeClose({ requestId, outcome })
  }

  const retryClose = async (): Promise<void> => {
    const saved = await flushDocuments()
    if (!saved) {
      toast.error('The documents still could not be saved. Your edits remain open.')
      await completeRecovery('blocked')
      return
    }
    await completeRecovery('ready')
  }

  const saveCopiesAndClose = async (): Promise<void> => {
    if (await saveDirtyCopies()) await completeRecovery('ready')
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.accent = settings.accent
  }, [dark, settings.accent])

  useEffect(() => {
    sidebarWidthRef.current = settings.sidebarWidth
    document.documentElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`)
  }, [settings.sidebarWidth])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) {
        if (event.key === 'Escape') setSidebarOpen(false)
        return
      }
      if (event.key.toLowerCase() === 's' && activeFileId) {
        event.preventDefault()
        void saveDocument(activeFileId)
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setEditing(!editing)
      } else if (event.key.toLowerCase() === 'o' && event.shiftKey) {
        event.preventDefault()
        void addProject()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void openFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeFileId, addProject, editing, openFile, saveDocument, setEditing, setSidebarOpen])

  useEffect(() => {
    const prevent = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent): void => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      for (const file of Array.from(event.dataTransfer.files)) {
        if (/\.(md|markdown)$/i.test(file.name)) void openDroppedFile(file)
      }
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [openDroppedFile])

  if (bootStatus !== 'ready') {
    return (
      <div className="flex h-full items-center justify-center gap-[13px] bg-background text-foreground-muted">
        <BrandMark
          className="block h-[38px] w-[38px] shrink-0 drop-shadow-[0_3px_7px_rgb(0_0_0/.16)]"
          title="Aladdeen"
        />
        {bootStatus === 'booting' ? (
          <LoaderCircle className="spinner" size={18} />
        ) : (
          <button
            type="button"
            className="rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-foreground hover:bg-surface-hover"
            onClick={() => void initialize()}
          >
            Retry startup
          </button>
        )}
      </div>
    )
  }

  const previewSidebarWidth = (width: number): void => {
    const next = clampSidebarWidth(width)
    sidebarWidthRef.current = next
    document.documentElement.style.setProperty('--sidebar-width', `${next}px`)
  }

  const persistSidebarWidth = (): void => {
    document.body.classList.remove('is-resizing-sidebar')
    resizeState.current = null
    if (sidebarWidthRef.current !== settings.sidebarWidth) {
      void updateSettings({ sidebarWidth: sidebarWidthRef.current })
    }
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || resizeState.current) return
    resizeState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidthRef.current
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing-sidebar')
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeState.current
    if (!resize || resize.pointerId !== event.pointerId) return
    previewSidebarWidth(resize.startWidth + event.clientX - resize.startX)
    event.currentTarget.setAttribute('aria-valuenow', String(sidebarWidthRef.current))
  }

  const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (resizeState.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    persistSidebarWidth()
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = sidebarWidthRef.current - 16
    if (event.key === 'ArrowRight') next = sidebarWidthRef.current + 16
    if (event.key === 'Home') next = SIDEBAR_MIN_WIDTH
    if (event.key === 'End') next = SIDEBAR_MAX_WIDTH
    if (next === undefined) return
    event.preventDefault()
    previewSidebarWidth(next)
    event.currentTarget.setAttribute('aria-valuenow', String(sidebarWidthRef.current))
    void updateSettings({ sidebarWidth: sidebarWidthRef.current })
  }

  const openSidebar = (): void => {
    if (window.matchMedia(COMPACT_WORKSPACE_QUERY).matches) setSidebarOpen(true)
    else void updateSettings({ sidebarCollapsed: false })
  }

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)] bg-background">
      <div className={cn(
        'workspace-grid relative grid min-h-0 min-w-0 grid-cols-[var(--sidebar-width)_minmax(0,1fr)] max-[959px]:grid-cols-[minmax(0,1fr)]',
        settings.sidebarCollapsed && 'sidebar-collapsed grid-cols-[0_minmax(0,1fr)] max-[959px]:grid-cols-[minmax(0,1fr)]'
      )}>
        <div className="min-h-0 min-w-0 overflow-hidden max-[959px]:hidden"><Sidebar /></div>
        <div
          className={cn(
            "sidebar-resizer absolute inset-y-0 left-[calc(var(--sidebar-width)-3px)] z-40 w-[6px] touch-none cursor-col-resize outline-0 after:absolute after:inset-y-0 after:left-0.5 after:w-px after:bg-transparent after:content-[''] hover:after:bg-accent focus-visible:after:bg-accent max-[959px]:hidden",
            settings.sidebarCollapsed && 'hidden'
          )}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={settings.sidebarWidth}
          tabIndex={0}
          onDoubleClick={() => {
            previewSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
            void updateSettings({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH })
          }}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
        />
        <main className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-surface-elevated">
          <TabBar />
          <DocumentView />
          <button className={cn(
            'sidebar-launcher absolute top-[47px] left-[10px] z-[35] hidden h-[33px] w-[33px] place-items-center rounded-[9px] border border-border bg-[color-mix(in_oklab,var(--surface-elevated)_92%,transparent)] p-0 text-foreground-soft shadow-[0_5px_18px_rgb(0_0_0/.09)] backdrop-blur-[12px] transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground max-[959px]:grid',
            settings.sidebarCollapsed && 'grid'
          )} onClick={openSidebar} aria-label="Show sidebar" title="Show sidebar">
            <PanelLeftOpen size={17} />
          </button>
        </main>
      </div>

      {sidebarOpen && (
        <div className="compact-sidebar-layer hidden max-[959px]:block" role="dialog" aria-modal="true" aria-label="Environment files">
          <button className="sheet-backdrop fixed inset-0 z-[150] h-full w-full border-0 bg-[rgb(10_10_15/.38)] p-0 opacity-100 transition-opacity duration-[170ms] ease-[ease]" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
          <div className="sheet-panel fixed inset-y-0 left-0 z-[151] w-[min(88vw,320px)] translate-x-0 transition-transform duration-[210ms] ease-fluid-out"><Sidebar compact /></div>
        </div>
      )}

      {!environment && <OnboardingDialog />}
      <AddProjectsDialog />
      <QuickOpenDialog />
      <GlobalSearchDialog />
      {!closeRequest && <ConflictDialog />}
      <CloseRecoveryDialog
        request={closeRequest}
        onRetry={retryClose}
        onSaveCopy={saveCopiesAndClose}
        onDiscard={() => completeRecovery('ready')}
        onCancel={() => completeRecovery('cancelled')}
      />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" closeButton toastOptions={{ className: 'app-toast' }} />
    </div>
  )
}
