import { FilePlus2, FileText, FolderOpen, ShieldCheck, Sparkles } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

export function Welcome(): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const addProject = useAppStore((state) => state.addProject)
  const openFile = useAppStore((state) => state.openFile)
  const createFile = useAppStore((state) => state.createFile)

  return (
    <main className="welcome-screen">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-symbol"><FileText size={31} strokeWidth={1.6} /><Sparkles className="welcome-spark" size={15} /></div>
        <p className="eyebrow">{environment?.environment.name.toLocaleUpperCase() ?? 'FLUIDMD'}</p>
        <h1>Your Markdown, one calm place.</h1>
        <p className="welcome-copy">Add a project folder or open any Markdown file. FluidMD remembers its location without moving or importing it.</p>
        <div className="welcome-actions">
          <button className="primary-button large" onClick={() => void addProject()}><FolderOpen size={16} /> Add folder</button>
          <button className="secondary-button large" onClick={() => void openFile()}><FileText size={16} /> Open file</button>
          <button className="ghost-button large" onClick={() => void createFile()}><FilePlus2 size={16} /> Create file</button>
        </div>
        <div className="privacy-note"><ShieldCheck size={14} /><span>No account. No cloud. No network required.</span></div>
      </div>
    </main>
  )
}
