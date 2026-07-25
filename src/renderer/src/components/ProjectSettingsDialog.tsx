import { useEffect, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, ChevronDown, LoaderCircle, Pin, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  DocumentKind,
  ProjectScopeMode,
  ProjectScopePreview,
  ProjectSummary
} from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  enabledDocumentCount,
  filterProjectScopeTree
} from '@renderer/lib/project-document-types'
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
import { ProjectDocumentTypes } from './ProjectDocumentTypes'

interface ProjectSettingsDialogProps {
  project: ProjectSummary | null
  onOpenChange(open: boolean): void
}

export function ProjectSettingsDialog({ project, onOpenChange }: ProjectSettingsDialogProps): React.JSX.Element {
  const updateProject = useAppStore((state) => state.updateProject)
  const removeProject = useAppStore((state) => state.removeProject)
  const [preview, setPreview] = useState<ProjectScopePreview | null>(null)
  const [mode, setMode] = useState<ProjectScopeMode>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [excludePatterns, setExcludePatterns] = useState<string[]>([])
  const [enabledDocumentKinds, setEnabledDocumentKinds] = useState<Set<DocumentKind>>(new Set())
  const [groupName, setGroupName] = useState('')
  const [pinned, setPinned] = useState(false)
  const [archived, setArchived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)

  useEffect(() => {
    if (!project) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreview(null)
    setMode(project.scopeMode)
    setSelected(new Set(project.includePaths))
    setExcludePatterns([...project.excludePatterns])
    setEnabledDocumentKinds(new Set(project.enabledDocumentKinds))
    setGroupName(project.groupName ?? '')
    setPinned(project.pinned)
    setArchived(project.archived)
    setRemoveConfirmOpen(false)
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
    if (!project || saving || enabledDocumentKinds.size === 0 || (mode === 'selected' && selected.size === 0)) return
    setSaving(true)
    const completed = await updateProject({
      projectId: project.id,
      scopeMode: mode,
      includePaths: [...selected],
      excludePatterns,
      enabledDocumentKinds: [...enabledDocumentKinds],
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

  const remove = async (): Promise<void> => {
    if (!project) return
    await removeProject(project.id)
    setRemoveConfirmOpen(false)
    onOpenChange(false)
  }

  const organizationSummary = [
    groupName.trim() || undefined,
    pinned ? 'Favorited' : undefined
  ].filter(Boolean).join(' · ') || 'Not organized'

  return (
    <>
      <Dialog.Root open={Boolean(project)} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlayClasses} />
          <Dialog.Content className={cn(dialogContentClasses, 'project-settings-dialog')}>
            <div className="project-dialog-header">
              <div className="min-w-0">
                <Dialog.Title className={dialogTitleClasses}>Project settings</Dialog.Title>
                <Dialog.Description className={cn(dialogDescriptionClasses, 'project-settings-context')}>
                  <strong>{project?.name ?? 'Project'}</strong>
                  {project && <span title={project.displayPath}>{project.displayPath}</span>}
                </Dialog.Description>
              </div>
              <Dialog.Close className={dialogCloseClasses} aria-label="Close"><X size={16} /></Dialog.Close>
            </div>

            {!preview ? (
              <div className={cn(centeredEmptyClasses, 'min-h-[330px]')}><LoaderCircle className="spinner" size={20} /> Scanning documents…</div>
            ) : (
              <div className="project-settings-body">
                <ProjectDocumentTypes
                  enabled={enabledDocumentKinds}
                  counts={preview.kindCounts}
                  onChange={setEnabledDocumentKinds}
                />

                <section className="project-settings-scope" aria-labelledby="project-indexing-scope">
                  <h3 id="project-indexing-scope">Indexing scope</h3>
                  <p>Choose whether Aladdeen discovers every enabled format or only selected locations.</p>
                  <div className="scope-mode-grid">
                    <label className={mode === 'all' ? 'is-selected' : ''}>
                      <input type="radio" name="project-scope" checked={mode === 'all'} onChange={() => setMode('all')} />
                      <span>
                        <strong>All enabled documents</strong>
                        <small>{enabledDocumentCount(preview.kindCounts, enabledDocumentKinds).toLocaleString()} found in enabled formats</small>
                      </span>
                    </label>
                    <label className={mode === 'selected' ? 'is-selected' : ''}>
                      <input type="radio" name="project-scope" checked={mode === 'selected'} onChange={() => setMode('selected')} />
                      <span><strong>Selected folders and files</strong><small>Keep the project focused.</small></span>
                    </label>
                  </div>
                </section>

                {mode === 'selected' && (
                  <ProjectScopeTree
                    nodes={filterProjectScopeTree(preview.tree, enabledDocumentKinds)}
                    selected={selected}
                    excludePatterns={excludePatterns}
                    onChange={setSelected}
                    onExcludePatternsChange={setExcludePatterns}
                  />
                )}

                <div className="project-settings-disclosures">
                  <ProjectSettingsSection title="Organization" summary={organizationSummary}>
                    <div className="project-organization-fields">
                      <label>
                        <span>Project group</span>
                        <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Work, Clients, Personal" />
                      </label>
                      <label className="project-settings-toggle">
                        <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                        <Pin size={14} />
                        <span><strong>Favorite project</strong><small>Keep this project near the top of the sidebar.</small></span>
                      </label>
                    </div>
                  </ProjectSettingsSection>

                  <ProjectSettingsSection
                    title="Advanced indexing"
                    summary={excludePatterns.length === 0
                      ? 'No custom exclusions'
                      : `${excludePatterns.length} exclusion${excludePatterns.length === 1 ? '' : 's'}`}
                  >
                    <p className="project-settings-section-description">
                      Excluded paths stay on disk but do not appear in project discovery or search.
                    </p>
                    <ExclusionList patterns={excludePatterns} onChange={setExcludePatterns} />
                  </ProjectSettingsSection>

                  <ProjectSettingsSection title="Project management" summary={archived ? 'Archived' : 'Active'}>
                    <div className="project-management-list">
                      <label className={cn('project-management-row', archived && 'is-warning')}>
                        <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
                        <Archive size={15} />
                        <span>
                          <strong>{archived ? 'Restore project' : 'Archive project'}</strong>
                          <small>{archived ? 'Resume indexing when changes are saved.' : 'Pause indexing and hide the project from active lists.'}</small>
                        </span>
                      </label>
                      <div className="project-management-row is-danger">
                        <Trash2 size={15} />
                        <span>
                          <strong>Remove from Environment</strong>
                          <small>Remove Aladdeen’s reference only. Files remain untouched on disk.</small>
                        </span>
                        <button type="button" className={buttonClasses({ variant: 'secondary' })} onClick={() => setRemoveConfirmOpen(true)}>
                          Remove…
                        </button>
                      </div>
                    </div>
                  </ProjectSettingsSection>
                </div>
              </div>
            )}

            <div className={cn(dialogActionsClasses, 'project-dialog-actions')}>
              <Dialog.Close className={buttonClasses({ variant: 'secondary' })}>Cancel</Dialog.Close>
              <button className={buttonClasses()} disabled={!preview || saving || enabledDocumentKinds.size === 0 || (mode === 'selected' && selected.size === 0)} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={dialogOverlayClasses} />
          <AlertDialog.Content className={dialogContentClasses}>
            <AlertDialog.Title className={dialogTitleClasses}>Remove “{project?.name ?? 'project'}”?</AlertDialog.Title>
            <AlertDialog.Description className={dialogDescriptionClasses}>
              The project and all documents stay on disk. Only its reference and project settings are removed from this Environment.
            </AlertDialog.Description>
            <div className={dialogActionsClasses}>
              <AlertDialog.Cancel className={buttonClasses({ variant: 'secondary' })}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action className={buttonClasses({ variant: 'danger' })} onClick={() => void remove()}>
                Remove project
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}

function ProjectSettingsSection({
  title,
  summary,
  children
}: {
  title: string
  summary: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details className="project-settings-section">
      <summary>
        <span><strong>{title}</strong><small>{summary}</small></span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="project-settings-section-content">{children}</div>
    </details>
  )
}

function ExclusionList({
  patterns,
  onChange
}: {
  patterns: string[]
  onChange(patterns: string[]): void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const normalized = draft.trim()
  const duplicate = normalized.length > 0 && patterns.includes(normalized)

  const add = (): void => {
    if (!normalized || duplicate) return
    onChange([...patterns, normalized])
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="project-exclusions">
      {patterns.length === 0 ? (
        <p className="project-exclusions-empty">No custom exclusions.</p>
      ) : (
        <ul>
          {patterns.map((pattern) => (
            <li key={pattern}>
              <code>{pattern}</code>
              <button
                type="button"
                onClick={() => onChange(patterns.filter((candidate) => candidate !== pattern))}
                aria-label={`Remove exclusion ${pattern}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="project-exclusion-form">
          <label>
            <span>Exclusion pattern</span>
            <input
              autoFocus
              value={draft}
              placeholder="e.g. archive/**"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && add()}
            />
          </label>
          {duplicate && <small role="alert">That exclusion already exists.</small>}
          <div>
            <button type="button" className={buttonClasses({ variant: 'secondary' })} onClick={() => { setAdding(false); setDraft('') }}>Cancel</button>
            <button type="button" className={buttonClasses()} disabled={!normalized || duplicate} onClick={add}>Add</button>
          </div>
        </div>
      ) : (
        <button type="button" className="project-add-exclusion" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add exclusion…
        </button>
      )}
    </div>
  )
}
