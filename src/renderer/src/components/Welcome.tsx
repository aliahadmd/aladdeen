import { FilePlus2, FileText, FolderOpen, ShieldCheck } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { buttonClasses, eyebrowClasses, privacyNoteClasses } from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'

export function Welcome(): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const addProject = useAppStore((state) => state.addProject)
  const openFile = useAppStore((state) => state.openFile)
  const createFile = useAppStore((state) => state.createFile)

  return (
    <main className="welcome-screen relative grid h-full place-items-center overflow-hidden">
      <div className="pointer-events-none absolute top-[18%] left-1/2 h-[230px] w-[430px] -translate-x-1/2 rounded-[50%] bg-accent-soft opacity-[.38] blur-[80px]" />
      <div className="z-[1] w-[min(90%,600px)] px-5 py-11 text-center">
        <BrandMark
          className="mx-auto mb-6 h-[66px] w-[66px] drop-shadow-[0_16px_28px_rgb(0_0_0/.18)]"
          title="Aladdeen"
        />
        <p className={eyebrowClasses}>
          {environment?.environment.name.toLocaleUpperCase() ?? 'ALADDEEN'}
        </p>
        <h1 className="m-0 text-[clamp(34px,5vw,51px)] leading-[1.05] font-[680] tracking-[-.045em]">
          Your Markdown, one calm place.
        </h1>
        <p className="mx-auto mt-[19px] mb-[27px] max-w-[480px] text-[15px] leading-[1.6] text-foreground-soft">
          Add a project folder or open any Markdown file. Aladdeen remembers its location without moving or importing it.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className={buttonClasses({ size: 'large' })} onClick={() => void addProject()}><FolderOpen size={16} /> Add folder</button>
          <button className={buttonClasses({ variant: 'secondary', size: 'large' })} onClick={() => void openFile()}><FileText size={16} /> Open file</button>
          <button className={buttonClasses({ variant: 'ghost', size: 'large' })} onClick={() => void createFile()}><FilePlus2 size={16} /> Create file</button>
        </div>
        <div className={cn(privacyNoteClasses, 'mt-[27px]')}>
          <ShieldCheck size={14} />
          <span>No account. No cloud. No network required.</span>
        </div>
      </div>
    </main>
  )
}
