import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Toaster } from 'sonner'
import { ConflictDialog } from './components/ConflictDialog'
import { DocumentView } from './components/DocumentView'
import { OnboardingDialog } from './components/OnboardingDialog'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { useEffectiveDarkMode } from './hooks/use-effective-dark-mode'
import { useAppStore } from './store/app-store'

export default function App(): React.JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const initialize = useAppStore((state) => state.initialize)
  const environment = useAppStore((state) => state.environment)
  const acceptSystemOpenFile = useAppStore((state) => state.acceptSystemOpenFile)
  const handleEnvironmentEvent = useAppStore((state) => state.handleEnvironmentEvent)
  const openDroppedFile = useAppStore((state) => state.openDroppedFile)
  const settings = useAppStore((state) => state.settings)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const editing = useAppStore((state) => state.editing)
  const setEditing = useAppStore((state) => state.setEditing)
  const saveDocument = useAppStore((state) => state.saveDocument)
  const addProject = useAppStore((state) => state.addProject)
  const openFile = useAppStore((state) => state.openFile)
  const dark = useEffectiveDarkMode()
  const [sidebarVisible, setSidebarVisible] = useState(true)

  useEffect(() => {
    void initialize()
    const offEvent = window.fluidmd.document.onEvent((event) => void handleEnvironmentEvent(event))
    const offOpenFileRequest = window.fluidmd.document.onOpenFileRequest((request) => void acceptSystemOpenFile(request))
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
        <div className="brand-mark large-mark">F</div>
        <LoaderCircle className="spinner" size={18} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TopBar sidebarVisible={sidebarVisible} onToggleSidebar={() => setSidebarVisible((value) => !value)} />
      <div className={`workspace-grid ${sidebarVisible ? '' : 'sidebar-collapsed'}`}>
        <div className="desktop-sidebar"><Sidebar /></div>
        <main className="content-shell">
          <TabBar />
          <DocumentView />
        </main>
      </div>

      {sidebarOpen && (
        <div className="compact-sidebar-layer" role="dialog" aria-modal="true" aria-label="Environment files">
          <button className="sheet-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
          <div className="sheet-panel"><Sidebar compact /></div>
        </div>
      )}

      {!environment && <OnboardingDialog />}
      <ConflictDialog />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" closeButton toastOptions={{ className: 'fluid-toast' }} />
    </div>
  )
}
