import { Bot, FolderLock } from 'lucide-react'

export function AgentEmptyState({ projectName }: { projectName?: string }): React.JSX.Element {
  return (
    <div className="grid min-h-full place-items-center px-7 py-10 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface text-accent shadow-[0_7px_22px_rgb(0_0_0/.07)]">
          <Bot size={21} />
        </span>
        <h3 className="mt-3 mb-0 text-[13px] font-bold text-foreground">Work with your project</h3>
        <p className="mx-auto mt-1.5 mb-0 max-w-[250px] text-[10px] leading-[1.55] text-foreground-muted">
          Ask about {projectName ? `${projectName},` : 'the active project,'} inspect files, or request a change.
          Writes and commands always pause for your approval.
        </p>
        <p className="mt-3 mb-0 inline-flex items-center gap-1.5 text-[9px] text-foreground-muted">
          <FolderLock size={11} />
          Session scope: active project folder
        </p>
      </div>
    </div>
  )
}
