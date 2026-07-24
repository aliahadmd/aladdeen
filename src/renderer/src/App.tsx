import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { LoaderCircle, PanelLeftOpen } from 'lucide-react'
import { Toaster } from 'sonner'
import { AddProjectsDialog } from './components/AddProjectsDialog'
import { BrandMark } from './components/BrandMark'
import { ConflictDialog } from './components/ConflictDialog'
import { DocumentView } from './components/DocumentView'
import { OnboardingDialog } from './components/OnboardingDialog'
import { QuickOpenDialog } from './components/QuickOpenDialog'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { useEffectiveDarkMode } from './hooks/use-effective-dark-mode'
import { useAppStore } from './store/app-store'

const SIDEBAR_MIN_WIDTH = 248
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_MAX_WIDTH = 420

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export default function App(): React.JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const initialize = useAppStore((state) => state.initialize)
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

  useEffect(() => {
    void initialize()
    const offEvent = window.aladdeen.document.onEvent((event) => void handleEnvironmentEvent(event))
    const offOpenFileRequest = window.aladdeen.document.onOpenFileRequest((request) => void acceptSystemOpenFile(request))
    return () => {
      offEvent()
      offOpenFileRequest()
    }
  }, [acceptSystemOpenFile, handleEnvironmentEvent, initialize])

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

  if (!initialized) {
    return (
      <div className="loading-screen">
        <BrandMark className="brand-mark large-mark" title="Aladdeen" />
        <LoaderCircle className="spinner" size={18} />
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
    if (window.matchMedia('(max-width: 959px)').matches) setSidebarOpen(true)
    else void updateSettings({ sidebarCollapsed: false })
  }

  return (
    <div className="app-shell">
      <div className={`workspace-grid ${settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="desktop-sidebar"><Sidebar /></div>
        <div
          className="sidebar-resizer"
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
        <main className="content-shell">
          <TabBar />
          <DocumentView />
          <button className="sidebar-launcher" onClick={openSidebar} aria-label="Show sidebar" title="Show sidebar">
            <PanelLeftOpen size={17} />
          </button>
        </main>
      </div>

      {sidebarOpen && (
        <div className="compact-sidebar-layer" role="dialog" aria-modal="true" aria-label="Environment files">
          <button className="sheet-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
          <div className="sheet-panel"><Sidebar compact /></div>
        </div>
      )}

      {!environment && <OnboardingDialog />}
      <AddProjectsDialog />
      <QuickOpenDialog />
      <ConflictDialog />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" closeButton toastOptions={{ className: 'app-toast' }} />
    </div>
  )
}
