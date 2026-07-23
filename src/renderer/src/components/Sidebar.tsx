import { useEffect, useMemo, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileQuestion,
  FileText,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  LocateFixed,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unlink,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectSummary, TrackedFileSummary, WorkspaceTreeNode } from '@shared/contracts'
import { useAppStore } from '@renderer/store/app-store'

interface SidebarProps { compact?: boolean }
type FormKind = 'environment' | 'rename-environment' | 'project' | 'file' | 'folder' | null

function filterTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  if (!query) return nodes
  const needle = query.toLocaleLowerCase()
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return node.name.toLocaleLowerCase().includes(needle) ? [node] : []
    const children = filterTree(node.children ?? [], query)
    return node.name.toLocaleLowerCase().includes(needle) || children.length > 0 ? [{ ...node, children }] : []
  })
}

export function Sidebar({ compact = false }: SidebarProps): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const selectedProjectId = useAppStore((state) => state.selectedProjectId)
  const selectedFolderPath = useAppStore((state) => state.selectedFolderPath)
  const switchEnvironment = useAppStore((state) => state.switchEnvironment)
  const createEnvironment = useAppStore((state) => state.createEnvironment)
  const renameEnvironment = useAppStore((state) => state.renameEnvironment)
  const removeEnvironment = useAppStore((state) => state.removeEnvironment)
  const createProject = useAppStore((state) => state.createProject)
  const addProject = useAppStore((state) => state.addProject)
  const removeProject = useAppStore((state) => state.removeProject)
  const openDocument = useAppStore((state) => state.openDocument)
  const createFile = useAppStore((state) => state.createFile)
  const createFolder = useAppStore((state) => state.createFolder)
  const applyTrackedUpdates = useAppStore((state) => state.applyTrackedUpdates)
  const refreshEnvironment = useAppStore((state) => state.refreshEnvironment)
  const removeTrackedFile = useAppStore((state) => state.removeTrackedFile)
  const trashTrackedFile = useAppStore((state) => state.trashTrackedFile)
  const locateTrackedFile = useAppStore((state) => state.locateTrackedFile)
  const setSelectedLocation = useAppStore((state) => state.setSelectedLocation)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Record<string, Set<string>>>({})
  const [formKind, setFormKind] = useState<FormKind>(null)
  const [renameNode, setRenameNode] = useState<{ projectId: string; node: WorkspaceTreeNode } | null>(null)
  const [trashNode, setTrashNode] = useState<{ projectId: string; node: WorkspaceTreeNode } | null>(null)
  const [removeProjectTarget, setRemoveProjectTarget] = useState<ProjectSummary | null>(null)
  const [trashTrackedTarget, setTrashTrackedTarget] = useState<TrackedFileSummary | null>(null)
  const [deleteEnvironmentOpen, setDeleteEnvironmentOpen] = useState(false)

  useEffect(() => {
    if (!environment) return
    setExpandedProjects(new Set(environment.projects.filter((project) => project.expandedPaths.includes('')).map((project) => project.id)))
    setExpandedFolders(Object.fromEntries(environment.projects.map((project) => [project.id, new Set(project.expandedPaths.filter(Boolean))])))
  }, [environment])

  const visibleProjects = useMemo(() => {
    if (!environment) return []
    return environment.projects
      .map((project) => ({ ...project, tree: filterTree(project.tree, query) }))
      .filter((project) => !query || project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || project.tree.length > 0)
  }, [environment, query])

  const visibleFiles = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    const files = (environment?.files ?? []).filter((file) => !query || `${file.name} ${file.location} ${file.fullPath}`.toLocaleLowerCase().includes(needle))
    return showAll || query ? files : files.slice(0, 8)
  }, [environment?.files, query, showAll])

  const toggleProject = (projectId: string): void => {
    setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      const paths = [...(expandedFolders[projectId] ?? [])]
      if (next.has(projectId)) paths.unshift('')
      void window.fluidmd.projects.persistExpandedPaths(projectId, paths)
      return next
    })
    setSelectedLocation(projectId, '')
  }

  const toggleFolder = (projectId: string, path: string): void => {
    setExpandedFolders((current) => {
      const nextSet = new Set(current[projectId] ?? [])
      if (nextSet.has(path)) nextSet.delete(path)
      else nextSet.add(path)
      const paths = [...nextSet]
      if (expandedProjects.has(projectId)) paths.unshift('')
      void window.fluidmd.projects.persistExpandedPaths(projectId, paths)
      return { ...current, [projectId]: nextSet }
    })
    setSelectedLocation(projectId, path)
  }

  const renameEntry = async (projectId: string, node: WorkspaceTreeNode, name: string): Promise<boolean> => {
    const result = await window.fluidmd.files.rename({ projectId, path: node.path, newName: name })
    if (!result.ok) {
      toast.error(result.error.message)
      return false
    }
    applyTrackedUpdates(result.value.affectedFiles)
    await refreshEnvironment()
    setRenameNode(null)
    return true
  }

  const trashEntry = async (): Promise<void> => {
    if (!trashNode) return
    const result = await window.fluidmd.files.trash(trashNode.projectId, trashNode.node.path)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`${trashNode.node.name} moved to Trash.`)
    setTrashNode(null)
    await refreshEnvironment()
  }

  if (!environment) return <aside className={`sidebar environment-sidebar ${compact ? 'is-compact' : ''}`} aria-label="Environment files" />

  return (
    <aside className={`sidebar environment-sidebar ${compact ? 'is-compact' : ''}`} aria-label="Environment files">
      <div className="environment-header">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="environment-trigger" aria-label="Switch environment">
              <span>{environment.environment.name}</span><ChevronDown size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content environment-menu" sideOffset={6} align="start">
              <DropdownMenu.Label className="dropdown-label">Environments</DropdownMenu.Label>
              {environment.environments.map((item) => (
                <DropdownMenu.Item key={item.id} className="dropdown-item" onSelect={() => void switchEnvironment(item.id)}>
                  <span className="menu-check">{item.id === environment.environment.id && <Check size={14} />}</span>
                  <span className="environment-menu-name">{item.name}</span>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="dropdown-separator" />
              <DropdownMenu.Item className="dropdown-item" onSelect={() => setFormKind('environment')}><Plus size={14} /> New environment</DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item" onSelect={() => setFormKind('rename-environment')}><Pencil size={14} /> Rename environment</DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item destructive-item" onSelect={() => setDeleteEnvironmentOpen(true)}><Trash2 size={14} /> Delete environment</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="environment-header-actions">
          <button className="sidebar-icon-button" onClick={() => setSearchOpen((value) => !value)} aria-label="Search environment"><Search size={15} /></button>
          {compact && <button className="sidebar-icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={16} /></button>}
        </div>
      </div>

      {searchOpen && (
        <label className="environment-search">
          <Search size={14} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and projects" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
        </label>
      )}

      <div className="environment-quick-actions">
        <button onClick={() => selectedProjectId ? setFormKind('file') : void createFile()}><FilePlus2 size={15} /> New file</button>
        <button onClick={() => setFormKind('project')}><FolderPlus size={15} /> New folder</button>
      </div>

      <ScrollArea.Root className="environment-scroll">
        <ScrollArea.Viewport className="environment-viewport">
          <section className="sidebar-section" aria-labelledby="projects-heading">
            <div className="section-heading-row">
              <h2 id="projects-heading">Projects</h2>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button className="section-add" aria-label="Add project"><Plus size={14} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="end">
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => setFormKind('project')}><FolderPlus size={14} /> Create new folder</DropdownMenu.Item>
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => void addProject()}><FolderOpen size={14} /> Add existing folder</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>

            {visibleProjects.length === 0 ? (
              <div className="section-empty"><FolderKanban size={16} /><span>{query ? 'No matching projects' : 'Create or add a folder project'}</span></div>
            ) : visibleProjects.map((project) => {
              const projectOpen = Boolean(query) || expandedProjects.has(project.id)
              return (
                <div className="project-group" key={project.id}>
                  <div className={`project-row ${selectedProjectId === project.id && selectedFolderPath === '' ? 'is-selected' : ''}`}>
                    <button className="project-main" onClick={() => toggleProject(project.id)} title={project.displayPath}>
                      {projectOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {projectOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
                      <span>{project.name}</span>
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild><button className="row-more" aria-label={`Actions for ${project.name}`}><MoreHorizontal size={14} /></button></DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="start">
                          <DropdownMenu.Item className="dropdown-item" onSelect={() => { setSelectedLocation(project.id, ''); setFormKind('file') }}><FilePlus2 size={14} /> New file</DropdownMenu.Item>
                          <DropdownMenu.Item className="dropdown-item" onSelect={() => { setSelectedLocation(project.id, ''); setFormKind('folder') }}><FolderPlus size={14} /> New subfolder</DropdownMenu.Item>
                          <DropdownMenu.Item className="dropdown-item" onSelect={() => void window.fluidmd.files.revealProjectEntry(project.id, '')}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
                          <DropdownMenu.Separator className="dropdown-separator" />
                          <DropdownMenu.Item className="dropdown-item destructive-item" onSelect={() => setRemoveProjectTarget(project)}><Unlink size={14} /> Remove from environment</DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                  {projectOpen && (
                    <div className="project-tree" role="tree">
                      {project.tree.length === 0 ? <div className="project-empty">No Markdown files</div> : project.tree.map((node) => (
                        <ProjectTreeItem
                          key={node.path}
                          projectId={project.id}
                          node={node}
                          depth={0}
                          activeFileId={activeFileId}
                          trackedFiles={environment.files}
                          expanded={expandedFolders[project.id] ?? new Set()}
                          queryActive={Boolean(query)}
                          onToggle={toggleFolder}
                          onOpen={(path) => void openDocument({ kind: 'project', projectId: project.id, relativePath: path })}
                          onSelectFolder={(path) => setSelectedLocation(project.id, path)}
                          onRename={(item) => setRenameNode({ projectId: project.id, node: item })}
                          onTrash={(item) => setTrashNode({ projectId: project.id, node: item })}
                          onCreate={(path, kind) => { setSelectedLocation(project.id, path); setFormKind(kind) }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          <section className="sidebar-section individual-files" aria-labelledby="files-heading">
            <div className="section-heading-row"><h2 id="files-heading">Individual files</h2><span className="section-count">{environment.files.length}</span></div>
            {visibleFiles.length === 0 ? (
              <div className="section-empty"><FileText size={16} /><span>{query ? 'No matching files' : 'Opened files stay here'}</span></div>
            ) : visibleFiles.map((file) => (
              <TrackedFileRow
                key={file.id}
                file={file}
                active={activeFileId === file.id}
                onOpen={() => file.missing ? void locateTrackedFile(file.id) : void openDocument({ kind: 'tracked', fileId: file.id })}
                onLocate={() => void locateTrackedFile(file.id)}
                onRemove={() => void removeTrackedFile(file.id)}
                onTrash={() => setTrashTrackedTarget(file)}
              />
            ))}
            {!query && environment.files.length > 8 && (
              <button className="show-all-button" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show less' : `Show all ${environment.files.length}`}</button>
            )}
          </section>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar" orientation="vertical"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <SidebarForm
        kind={formKind}
        initialValue={formKind === 'rename-environment' ? environment.environment.name : ''}
        locationLabel={selectedProjectId ? environment.projects.find((project) => project.id === selectedProjectId)?.name : undefined}
        onClose={() => setFormKind(null)}
        onSubmit={async (value) => {
          if (formKind === 'environment') return createEnvironment(value)
          if (formKind === 'rename-environment') return renameEnvironment(value)
          if (formKind === 'project') { await createProject(value); return true }
          if (formKind === 'file') { await createFile(value); return true }
          if (formKind === 'folder') { await createFolder(value); return true }
          return false
        }}
      />

      <SidebarForm
        kind={renameNode ? 'file' : null}
        title={`Rename ${renameNode?.node.kind ?? 'item'}`}
        initialValue={renameNode?.node.name ?? ''}
        submitLabel="Rename"
        onClose={() => setRenameNode(null)}
        onSubmit={(value) => renameNode ? renameEntry(renameNode.projectId, renameNode.node, value) : Promise.resolve(false)}
      />

      <ConfirmDialog
        open={Boolean(trashNode)}
        title={`Move “${trashNode?.node.name ?? ''}” to Trash?`}
        description={trashNode?.node.kind === 'directory' ? 'The folder and everything inside it will be moved to your system Trash.' : 'You can recover this Markdown file later from your system Trash.'}
        confirmLabel="Move to Trash"
        destructive
        onCancel={() => setTrashNode(null)}
        onConfirm={trashEntry}
      />
      <ConfirmDialog
        open={Boolean(trashTrackedTarget)}
        title={`Move “${trashTrackedTarget?.name ?? ''}” to Trash?`}
        description="The file will be moved to your system Trash and remain listed as Missing until you locate or remove it."
        confirmLabel="Move to Trash"
        destructive
        onCancel={() => setTrashTrackedTarget(null)}
        onConfirm={async () => { if (trashTrackedTarget) await trashTrackedFile(trashTrackedTarget.id); setTrashTrackedTarget(null) }}
      />
      <ConfirmDialog
        open={Boolean(removeProjectTarget)}
        title={`Remove “${removeProjectTarget?.name ?? ''}”?`}
        description="The folder and its files stay on disk. Previously opened files remain in Individual files."
        confirmLabel="Remove project"
        onCancel={() => setRemoveProjectTarget(null)}
        onConfirm={async () => { if (removeProjectTarget) await removeProject(removeProjectTarget.id); setRemoveProjectTarget(null) }}
      />
      <ConfirmDialog
        open={deleteEnvironmentOpen}
        title={`Delete “${environment.environment.name}”?`}
        description="Only FluidMD’s saved environment metadata is removed. No folders or Markdown files will be deleted."
        confirmLabel="Delete environment"
        destructive
        onCancel={() => setDeleteEnvironmentOpen(false)}
        onConfirm={async () => { await removeEnvironment(); setDeleteEnvironmentOpen(false) }}
      />
    </aside>
  )
}

function ProjectTreeItem({
  projectId, node, depth, activeFileId, trackedFiles, expanded, queryActive, onToggle, onOpen, onSelectFolder, onRename, onTrash, onCreate
}: {
  projectId: string
  node: WorkspaceTreeNode
  depth: number
  activeFileId: string | null
  trackedFiles: TrackedFileSummary[]
  expanded: Set<string>
  queryActive: boolean
  onToggle(projectId: string, path: string): void
  onOpen(path: string): void
  onSelectFolder(path: string): void
  onRename(node: WorkspaceTreeNode): void
  onTrash(node: WorkspaceTreeNode): void
  onCreate(path: string, kind: 'file' | 'folder'): void
}): React.JSX.Element {
  const isExpanded = queryActive || expanded.has(node.path)
  const tracked = node.kind === 'file' ? trackedFiles.find((file) => file.projectId === projectId && file.relativePath === node.path) : undefined
  return (
    <div role="treeitem" aria-expanded={node.kind === 'directory' ? isExpanded : undefined}>
      <div className={`environment-tree-row ${tracked?.id === activeFileId ? 'is-active' : ''}`} style={{ '--tree-depth': depth } as React.CSSProperties}>
        <button className="tree-main" onClick={() => {
          if (node.kind === 'directory') { onSelectFolder(node.path); onToggle(projectId, node.path) }
          else onOpen(node.path)
        }}>
          <span className="tree-chevron">{node.kind === 'directory' && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}</span>
          {node.kind === 'directory' ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileText size={14} />}
          <span>{node.name}</span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button className="row-more" aria-label={`Actions for ${node.name}`}><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="start">
              {node.kind === 'directory' && <>
                <DropdownMenu.Item className="dropdown-item" onSelect={() => onCreate(node.path, 'file')}><FilePlus2 size={14} /> New file</DropdownMenu.Item>
                <DropdownMenu.Item className="dropdown-item" onSelect={() => onCreate(node.path, 'folder')}><FolderPlus size={14} /> New subfolder</DropdownMenu.Item>
              </>}
              <DropdownMenu.Item className="dropdown-item" onSelect={() => onRename(node)}><Pencil size={14} /> Rename</DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item" onSelect={() => void window.fluidmd.files.revealProjectEntry(projectId, node.path)}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              <DropdownMenu.Item className="dropdown-item destructive-item" onSelect={() => onTrash(node)}><Trash2 size={14} /> Move to Trash</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {node.kind === 'directory' && isExpanded && node.children?.map((child) => (
        <ProjectTreeItem key={child.path} projectId={projectId} node={child} depth={depth + 1} activeFileId={activeFileId} trackedFiles={trackedFiles} expanded={expanded} queryActive={queryActive} onToggle={onToggle} onOpen={onOpen} onSelectFolder={onSelectFolder} onRename={onRename} onTrash={onTrash} onCreate={onCreate} />
      ))}
    </div>
  )
}

function TrackedFileRow({ file, active, onOpen, onLocate, onRemove, onTrash }: { file: TrackedFileSummary; active: boolean; onOpen(): void; onLocate(): void; onRemove(): void; onTrash(): void }): React.JSX.Element {
  return (
    <div className={`tracked-file-row ${active ? 'is-active' : ''} ${file.missing ? 'is-missing' : ''}`} title={file.fullPath}>
      <button className="tracked-file-main" onClick={onOpen}>
        {file.missing ? <FileQuestion size={15} /> : <FileText size={15} />}
        <span className="tracked-file-copy"><strong>{file.name}</strong><small>{file.location}</small></span>
        {file.missing && <span className="missing-badge">Missing</span>}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button className="row-more" aria-label={`Actions for ${file.name}`}><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="start">
            {file.missing && <DropdownMenu.Item className="dropdown-item" onSelect={onLocate}><LocateFixed size={14} /> Locate file</DropdownMenu.Item>}
            <DropdownMenu.Item className="dropdown-item" disabled={file.missing} onSelect={() => void window.fluidmd.files.revealTracked(file.id)}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item className="dropdown-item destructive-item" disabled={file.missing} onSelect={onTrash}><Trash2 size={14} /> Move to Trash</DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item destructive-item" onSelect={onRemove}><Unlink size={14} /> Remove from environment</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function SidebarForm({ kind, title, initialValue = '', locationLabel, submitLabel, onClose, onSubmit }: {
  kind: FormKind
  title?: string
  initialValue?: string
  locationLabel?: string
  submitLabel?: string
  onClose(): void
  onSubmit(value: string): Promise<boolean>
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(initialValue), [initialValue, kind])
  const labels: Record<Exclude<FormKind, null>, string> = {
    environment: 'New environment',
    'rename-environment': 'Rename environment',
    project: 'New folder project',
    file: 'New Markdown file',
    folder: 'New subfolder'
  }
  const submit = async (): Promise<void> => {
    if (!value.trim() || busy || !kind) return
    setBusy(true)
    if (await onSubmit(value.trim())) { setValue(''); onClose() }
    setBusy(false)
  }
  return (
    <Dialog.Root open={Boolean(kind)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog">
          <div className="dialog-icon">{kind === 'file' ? <FilePlus2 size={18} /> : kind?.includes('environment') ? <FolderKanban size={18} /> : <FolderPlus size={18} />}</div>
          <Dialog.Title className="dialog-title">{title ?? (kind ? labels[kind] : '')}</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {kind === 'project' ? 'You’ll choose where to create it next.' : locationLabel && (kind === 'file' || kind === 'folder') ? `Create inside ${locationLabel}` : kind?.includes('environment') ? 'Environment names are unique in FluidMD.' : 'Choose a clear, portable name.'}
          </Dialog.Description>
          <input className="dialog-input" value={value} autoFocus onFocus={(event) => kind?.includes('rename') && event.currentTarget.select()} placeholder={kind === 'file' ? 'Untitled.md' : kind === 'project' || kind === 'folder' ? 'Folder name' : 'Environment name'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void submit()} />
          <div className="dialog-actions"><Dialog.Close className="secondary-button">Cancel</Dialog.Close><button className="primary-button" disabled={!value.trim() || busy} onClick={() => void submit()}>{busy ? 'Working…' : submitLabel ?? (kind?.includes('rename') ? 'Rename' : 'Create')}</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmDialog({ open, title, description, confirmLabel, destructive = false, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; onCancel(): void; onConfirm(): Promise<void> }): React.JSX.Element {
  return (
    <AlertDialog.Root open={open} onOpenChange={(value) => !value && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content">
          <div className={`dialog-icon ${destructive ? 'destructive' : ''}`}>{destructive ? <Trash2 size={18} /> : <Unlink size={18} />}</div>
          <AlertDialog.Title className="dialog-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">{description}</AlertDialog.Description>
          <div className="dialog-actions"><AlertDialog.Cancel className="secondary-button">Cancel</AlertDialog.Cancel><AlertDialog.Action className={destructive ? 'danger-button' : 'primary-button'} onClick={() => void onConfirm()}>{confirmLabel}</AlertDialog.Action></div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
