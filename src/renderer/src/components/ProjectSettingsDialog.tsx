import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, LoaderCircle, Pin, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectScopeMode, ProjectScopePreview, ProjectSummary } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  buttonClasses,
  centeredEmptyClasses,
  dialogActionsClasses,
  dialogCloseClasses,
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'
import { ProjectScopeTree } from './ProjectScopeTree'

interface ProjectSettingsDialogProps {
  project: ProjectSummary | null
  onOpenChange(open: boolean): void
}

export function ProjectSettingsDialog({ project, onOpenChange }: ProjectSettingsDialogProps): React.JSX.Element {
  const updateProject = useAppStore((state) => state.updateProject)
  const [preview, setPreview] = useState<ProjectScopePreview | null>(null)
  const [mode, setMode] = useState<ProjectScopeMode>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [excludePatterns, setExcludePatterns] = useState('')
  const [groupName, setGroupName] = useState('')
  const [pinned, setPinned] = useState(false)
  const [archived, setArchived] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!project) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreview(null)
    setMode(project.scopeMode)
    setSelected(new Set(project.includePaths))
    setExcludePatterns(project.excludePatterns.join('\n'))
    setGroupName(project.groupName ?? '')
    setPinned(project.pinned)
    setArchived(project.archived)
    void window.aladdeen.projects.inspectScope(project.id).then((result) => {
      if (cancelled) return
      if (result.ok) setPreview(result.value)
      else {
        toast.error(result.error.message)
        onOpenChange(false)
      }
    })
    return () => { cancelled = true }
  }, [onOpenChange, project])

  const save = async (): Promise<void> => {
    if (!project || saving || (mode === 'selected' && selected.size === 0)) return
    setSaving(true)
    const completed = await updateProject({
      projectId: project.id,
      scopeMode: mode,
      includePaths: [...selected],
      excludePatterns: excludePatterns.split('\n').map((line) => line.trim()).filter(Boolean),
      groupName: groupName.trim() || undefined,
      pinned,
      archived
    })
    setSaving(false)
    if (completed) {
      toast.success(archived ? 'Project archived and indexing paused.' : 'Project settings updated.')
      onOpenChange(false)
    }
  }

  return (
    <Dialog.Root open={Boolean(project)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content className={cn(dialogContentClasses, 'project-settings-dialog')}>
          <div className="project-dialog-header">
            <div>
              <Dialog.Title className={dialogTitleClasses}>Manage {project?.name ?? 'project'}</Dialog.Title>
              <Dialog.Description className={dialogDescriptionClasses}>
                Change what Aladdeen indexes. Existing files stay untouched on disk.
              </Dialog.Description>
            </div>
            <Dialog.Close className={dialogCloseClasses} aria-label="Close"><X size={16} /></Dialog.Close>
          </div>

          {!preview ? (
            <div className={cn(centeredEmptyClasses, 'min-h-[330px]')}><LoaderCircle className="spinner" size={20} /> Scanning Markdown files…</div>
          ) : (
            <div className="project-settings-body">
              <div className="scope-mode-grid">
                <label className={mode === 'all' ? 'is-selected' : ''}>
                  <input type="radio" name="project-scope" checked={mode === 'all'} onChange={() => setMode('all')} />
                  <span><strong>All Markdown files</strong><small>{preview.totalMarkdownFiles.toLocaleString()} currently found</small></span>
                </label>
                <label className={mode === 'selected' ? 'is-selected' : ''}>
                  <input type="radio" name="project-scope" checked={mode === 'selected'} onChange={() => setMode('selected')} />
                  <span><strong>Selected folders and files</strong><small>Keep the project focused.</small></span>
                </label>
              </div>

              {mode === 'selected' && (
                <ProjectScopeTree
                  nodes={preview.tree}
                  selected={selected}
                  excludePatterns={excludePatterns.split('\n').map((line) => line.trim()).filter(Boolean)}
                  onChange={setSelected}
                  onExcludePatternsChange={(patterns) => setExcludePatterns(patterns.join('\n'))}
                />
              )}

              <div className="scope-advanced-grid project-organization">
                <label><span>Project group</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Work, Clients, Personal" /></label>
                <label className="scope-pin"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><Pin size={13} /> Favorite project</label>
                <label className="scope-pin"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /><Archive size={13} /> Archive and pause indexing</label>
                <label className="scope-patterns"><span>Exclude patterns, one per line</span><textarea value={excludePatterns} onChange={(event) => setExcludePatterns(event.target.value)} placeholder={'archive/**\n**/generated/**'} /></label>
              </div>
            </div>
          )}

          <div className={cn(dialogActionsClasses, 'project-dialog-actions')}>
            <Dialog.Close className={buttonClasses({ variant: 'secondary' })}>Cancel</Dialog.Close>
            <button className={buttonClasses()} disabled={!preview || saving || (mode === 'selected' && selected.size === 0)} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
