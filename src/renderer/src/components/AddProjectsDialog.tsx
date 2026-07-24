import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FolderOpen, LoaderCircle, Pin, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectImportPreview, ProjectImportSelection, ProjectScopeMode } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  buttonClasses,
  dialogActionsClasses,
  dialogCloseClasses,
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'
import { ProjectScopeTree } from './ProjectScopeTree'

interface DraftScope {
  mode: ProjectScopeMode
  selected: Set<string>
  excludePatterns: string
  groupName: string
  pinned: boolean
}

export function AddProjectsDialog(): React.JSX.Element {
  const open = useAppStore((state) => state.projectImportOpen)
  const setOpen = useAppStore((state) => state.setProjectImportOpen)
  const commitImport = useAppStore((state) => state.commitProjectImport)
  const [previews, setPreviews] = useState<ProjectImportPreview[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftScope>>({})
  const [activeToken, setActiveToken] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const active = previews.find((preview) => preview.token === activeToken) ?? previews[0]
  const draft = active ? drafts[active.token] : undefined

  useEffect(() => {
    if (open) return
    setPreviews([])
    setDrafts({})
    setActiveToken(null)
    setChoosing(false)
    setSaving(false)
  }, [open])

  const valid = useMemo(() => previews.length > 0 && previews.every((preview) => {
    const value = drafts[preview.token]
    return value && (value.mode === 'all' || value.selected.size > 0)
  }), [drafts, previews])

  const chooseFolders = async (): Promise<void> => {
    if (choosing) return
    setChoosing(true)
    const result = await window.aladdeen.projects.chooseExisting()
    setChoosing(false)
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') toast.error(result.error.message)
      return
    }
    setPreviews(result.value)
    setDrafts(Object.fromEntries(result.value.map((preview) => [preview.token, {
      mode: 'all' as const,
      selected: new Set<string>(),
      excludePatterns: '',
      groupName: '',
      pinned: false
    }])))
    setActiveToken(result.value[0]?.token ?? null)
  }

  const updateDraft = (token: string, update: Partial<DraftScope>): void => {
    setDrafts((current) => ({ ...current, [token]: { ...current[token]!, ...update } }))
  }

  const addProjects = async (): Promise<void> => {
    if (!valid || saving) return
    const selections: ProjectImportSelection[] = previews.map((preview) => {
      const value = drafts[preview.token]!
      return {
        token: preview.token,
        scopeMode: value.mode,
        includePaths: [...value.selected],
        excludePatterns: value.excludePatterns.split('\n').map((line) => line.trim()).filter(Boolean),
        groupName: value.groupName.trim() || undefined,
        pinned: value.pinned
      }
    })
    setSaving(true)
    const completed = await commitImport(selections)
    setSaving(false)
    if (completed) toast.success(`${selections.length} project${selections.length === 1 ? '' : 's'} added.`)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content className={cn(dialogContentClasses, 'project-import-dialog')}>
          <div className="project-dialog-header">
            <div>
              <Dialog.Title className={dialogTitleClasses}>Add project folders</Dialog.Title>
              <Dialog.Description className={dialogDescriptionClasses}>
                Link folders in place, then choose whether Aladdeen indexes every Markdown file or only selected areas.
              </Dialog.Description>
            </div>
            <Dialog.Close className={dialogCloseClasses} aria-label="Close"><X size={16} /></Dialog.Close>
          </div>

          {previews.length === 0 ? (
            <button className="m-[22px] flex min-h-[310px] flex-col items-center justify-center gap-[9px] rounded-xl border border-dashed border-border-strong bg-surface text-foreground-soft" type="button" onClick={() => void chooseFolders()} disabled={choosing}>
              {choosing ? <LoaderCircle className="spinner text-accent" size={20} /> : <FolderOpen className="text-accent" size={22} />}
              <strong className="text-[14px] text-foreground">{choosing ? 'Scanning selected folders…' : 'Choose one or more folders'}</strong>
              <span className="max-w-[420px] text-center text-[11px] leading-[1.5] text-foreground-muted">Aladdeen stores references and metadata only. Files stay in their original locations.</span>
            </button>
          ) : (
            <div className="project-import-layout">
              <nav className="project-candidate-list" aria-label="Selected project folders">
                {previews.map((preview) => (
                  <button
                    key={preview.token}
                    type="button"
                    className={preview.token === active?.token ? 'is-active' : ''}
                    onClick={() => setActiveToken(preview.token)}
                    aria-label={`${preview.name}, ${preview.fileCount.toLocaleString()} Markdown files`}
                  >
                    <FolderOpen size={15} />
                    <span><strong>{preview.name}</strong><small>{preview.fileCount.toLocaleString()} Markdown files</small></span>
                  </button>
                ))}
                <button className="add-more-projects" type="button" onClick={() => void chooseFolders()} disabled={choosing}>
                  <Plus size={14} /> Choose folders again
                </button>
              </nav>

              {active && draft && (
                <div className="project-scope-editor">
                  <div className="project-scope-title">
                    <div><strong>{active.name}</strong><span aria-label={`Project location: ${active.displayPath}`}>{active.displayPath}</span></div>
                    {active.truncated && <span className="scope-warning">Preview limited to 50,000 files</span>}
                  </div>

                  <div className="scope-mode-grid">
                    <label className={draft.mode === 'all' ? 'is-selected' : ''}>
                      <input type="radio" name={`scope-${active.token}`} checked={draft.mode === 'all'} onChange={() => updateDraft(active.token, { mode: 'all' })} />
                      <span><strong>All Markdown files</strong><small>Best when the whole folder belongs in Aladdeen.</small></span>
                    </label>
                    <label className={draft.mode === 'selected' ? 'is-selected' : ''}>
                      <input type="radio" name={`scope-${active.token}`} checked={draft.mode === 'selected'} onChange={() => updateDraft(active.token, { mode: 'selected' })} />
                      <span><strong>Selected folders and files</strong><small>Index only the parts you choose below.</small></span>
                    </label>
                  </div>

                  {draft.mode === 'selected' && (
                    <ProjectScopeTree
                      nodes={active.tree}
                      selected={draft.selected}
                      excludePatterns={parsePatterns(draft.excludePatterns)}
                      onChange={(selected) => updateDraft(active.token, { selected })}
                      onExcludePatternsChange={(patterns) => updateDraft(active.token, {
                        excludePatterns: patterns.join('\n')
                      })}
                    />
                  )}

                  <details className="scope-advanced">
                    <summary>Organization and exclusions</summary>
                    <div className="scope-advanced-grid">
                      <label><span>Project group</span><input value={draft.groupName} onChange={(event) => updateDraft(active.token, { groupName: event.target.value })} placeholder="e.g. Work, Clients, Personal" /></label>
                      <label className="scope-pin"><input type="checkbox" checked={draft.pinned} onChange={(event) => updateDraft(active.token, { pinned: event.target.checked })} /><Pin size={13} /> Add to favorites</label>
                      <label className="scope-patterns"><span>Exclude patterns, one per line</span><textarea value={draft.excludePatterns} onChange={(event) => updateDraft(active.token, { excludePatterns: event.target.value })} placeholder={'archive/**\n**/generated/**'} /></label>
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}

          <div className={cn(dialogActionsClasses, 'project-dialog-actions')}>
            <Dialog.Close className={buttonClasses({ variant: 'secondary' })}>Cancel</Dialog.Close>
            {previews.length > 0 && (
              <button className={buttonClasses()} disabled={!valid || saving} onClick={() => void addProjects()}>
                {saving ? 'Adding…' : `Add ${previews.length} project${previews.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function parsePatterns(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}
