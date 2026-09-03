import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import {
  Check,
  Archive,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileQuestion,
  FileSearch2,
  FileText,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  LocateFixed,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  SwatchBook,
  Trash2,
  Unlink,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  DocumentKind,
  IndexedFileSummary,
  ProjectSummary,
  ProjectTreePage,
  TrackedFileSummary,
  WorkspaceTreeNode
} from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { markdownDisplayName, trackedFileDisplayLocation } from '@renderer/lib/display'
import {
  buttonClasses,
  dialogActionsClasses,
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogIconClasses,
  dialogInputClasses,
  dialogOverlayClasses,
  dialogTitleClasses,
  dropdownContentClasses,
  dropdownItemClasses,
  dropdownLabelClasses,
  dropdownSeparatorClasses,
  environmentTreeRowClasses,
  menuCheckClasses,
  projectRowClasses,
  rowMoreClasses,
  sectionAddClasses,
  sidebarClasses,
  sidebarFooterButtonClasses,
  sidebarIconButtonClasses,
  sidebarQuickActionClasses,
  trackedFileRowClasses,
  treeLoadMoreClasses
} from '@renderer/lib/ui-styles'
import { themeOptions, useAppStore } from '@renderer/store/app-store'
import { SettingsDialog } from './SettingsDialog'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import { BrandMark } from './BrandMark'
import { DocumentKindIcon } from './DocumentKindIcon'

interface SidebarProps {
  compact?: boolean
  onShowTutorial?(): void
}
type FormKind = 'environment' | 'rename-environment' | 'project' | 'file' | 'folder' | null
type NewDocumentKind = Exclude<DocumentKind, 'pdf'>

export function Sidebar({ compact = false, onShowTutorial }: SidebarProps): React.JSX.Element {
  const environment = useAppStore((state) => state.environment)
  const activeFileId = useAppStore((state) => state.activeFileId)
  const activeDocument = useAppStore(useShallow((state) => {
    const document = state.documents.find((candidate) => candidate.id === state.activeFileId)
    return document
      ? { id: document.id, name: document.name, location: document.location, fullPath: document.fullPath }
      : null
  }))
  const settings = useAppStore((state) => state.settings)
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
  const openFile = useAppStore((state) => state.openFile)
  const createFile = useAppStore((state) => state.createFile)
  const createFolder = useAppStore((state) => state.createFolder)
  const applyTrackedUpdates = useAppStore((state) => state.applyTrackedUpdates)
  const refreshEnvironment = useAppStore((state) => state.refreshEnvironment)
  const removeTrackedFile = useAppStore((state) => state.removeTrackedFile)
  const trashTrackedFile = useAppStore((state) => state.trashTrackedFile)
  const locateTrackedFile = useAppStore((state) => state.locateTrackedFile)
  const setSelectedLocation = useAppStore((state) => state.setSelectedLocation)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const setGlobalSearchOpen = useAppStore((state) => state.setGlobalSearchOpen)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Record<string, Set<string>>>({})
  const [treePages, setTreePages] = useState<Record<string, ProjectTreePage>>({})
  const [loadingTreeKeys, setLoadingTreeKeys] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<IndexedFileSummary[]>([])
  const [formKind, setFormKind] = useState<FormKind>(null)
  const [newDocumentKind, setNewDocumentKind] = useState<NewDocumentKind>('markdown')
  const [renameNode, setRenameNode] = useState<{ projectId: string; node: WorkspaceTreeNode } | null>(null)
  const [trashNode, setTrashNode] = useState<{ projectId: string; node: WorkspaceTreeNode } | null>(null)
  const [removeProjectTarget, setRemoveProjectTarget] = useState<ProjectSummary | null>(null)
  const [manageProjectTarget, setManageProjectTarget] = useState<ProjectSummary | null>(null)
  const [trashTrackedTarget, setTrashTrackedTarget] = useState<TrackedFileSummary | null>(null)
  const [deleteEnvironmentOpen, setDeleteEnvironmentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const ThemeIcon = settings.theme === 'dark' ? Moon : settings.theme === 'light' ? Sun : SwatchBook
  const environmentId = environment?.environment.id
  const expansionSignature = environment?.projects
    .map((project) => [
      project.id,
      project.expandedPaths.join(','),
      project.indexedAt ?? 0,
      project.scopeMode,
      project.includePaths.join(','),
      project.excludePatterns.join(','),
      project.enabledDocumentKinds.join(',')
    ].join(':'))
    .join('|') ?? ''
  const environmentRef = useRef(environment)
  const projectCacheSignaturesRef = useRef<Map<string, string>>(new Map())
  environmentRef.current = environment

  useEffect(() => {
    setExpandedProjects(new Set())
    setExpandedFolders({})
    setTreePages({})
    setLoadingTreeKeys(new Set())
    projectCacheSignaturesRef.current.clear()
  }, [environmentId])

  useEffect(() => {
    const currentEnvironment = environmentRef.current
    if (!currentEnvironment) return
    let cancelled = false
    const nextCacheSignatures = new Map(currentEnvironment.projects.map((project) => [
      project.id,
      [
        project.indexedAt ?? 0,
        project.scopeMode,
        project.includePaths.join(','),
        project.excludePatterns.join(','),
        project.enabledDocumentKinds.join(',')
      ].join(':')
    ]))
    const staleProjectIds = new Set(currentEnvironment.projects.flatMap((project) =>
      projectCacheSignaturesRef.current.get(project.id) === nextCacheSignatures.get(project.id)
        ? []
        : [project.id]
    ))
    projectCacheSignaturesRef.current = nextCacheSignatures
    if (staleProjectIds.size > 0) {
      setTreePages((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) =>
          ![...staleProjectIds].some((projectId) => key.startsWith(`${projectId}:`))
        )
      ))
    }
    const openProjects = currentEnvironment.projects.filter((project) => project.expandedPaths.includes('') && !project.archived)
    setExpandedProjects(new Set(openProjects.map((project) => project.id)))
    setExpandedFolders(Object.fromEntries(currentEnvironment.projects.map((project) => [project.id, new Set(project.expandedPaths.filter(Boolean))])))
    const requests = openProjects.flatMap((project) =>
      project.expandedPaths.map((path) => window.aladdeen.projects.listChildren(project.id, path))
    )
    void Promise.all(requests).then((results) => {
      if (cancelled) return
      setTreePages((current) => ({
        ...current,
        ...Object.fromEntries(results.flatMap((result) =>
          result.ok ? [[treeKey(result.value.projectId, result.value.parentPath), result.value]] : []
        ))
      }))
    })
    return () => { cancelled = true }
  }, [environmentId, expansionSignature])

  useEffect(() => {
    if (!environment || !query.trim()) {
      setSearchResults([])
      return
    }
    setSearchResults([])
    let cancelled = false
    const timer = setTimeout(() => {
      void window.aladdeen.projects.search(query, 80).then((result) => {
        if (!cancelled && result.ok) setSearchResults(result.value)
      })
    }, 140)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [environment, query])

  const groupedProjects = useMemo(() => {
    if (!environment) return []
    const needle = query.toLocaleLowerCase()
    const active = environment.projects.filter((project) =>
      !project.archived && (!query || `${project.name} ${project.groupName ?? ''} ${project.displayPath}`.toLocaleLowerCase().includes(needle))
    )
    const groups = new Map<string, ProjectSummary[]>()
    for (const project of active) {
      const group = project.groupName ?? 'Ungrouped'
      const projects = groups.get(group) ?? []
      projects.push(project)
      groups.set(group, projects)
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .map(([name, projects]) => ({
        name,
        projects: projects.sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name))
      }))
  }, [environment, query])

  const archivedProjects = useMemo(
    () => environment?.projects.filter((project) => project.archived).sort((left, right) => left.name.localeCompare(right.name)) ?? [],
    [environment?.projects]
  )

  const visibleFiles = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    const files = (environment?.files ?? []).filter((file) => !query || `${file.name} ${file.location} ${file.fullPath}`.toLocaleLowerCase().includes(needle))
    return showAll || query ? files : files.slice(0, 8)
  }, [environment?.files, query, showAll])
  const trackedFilesByProjectPath = useMemo(
    () => new Map((environment?.files ?? []).flatMap((file) =>
      file.projectId && file.relativePath ? [[`${file.projectId}\0${file.relativePath}`, file] as const] : []
    )),
    [environment?.files]
  )
  const selectedProject = environment?.projects.find((project) => project.id === selectedProjectId)

  const toggleProject = (projectId: string): void => {
    const opening = !expandedProjects.has(projectId)
    setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      const paths = [...(expandedFolders[projectId] ?? [])]
      if (next.has(projectId)) paths.unshift('')
      void window.aladdeen.projects.persistExpandedPaths(projectId, paths)
      return next
    })
    if (opening) void loadChildren(projectId, '')
    setSelectedLocation(projectId, '')
  }

  const toggleFolder = (projectId: string, path: string): void => {
    const opening = !(expandedFolders[projectId] ?? new Set()).has(path)
    setExpandedFolders((current) => {
      const nextSet = new Set(current[projectId] ?? [])
      if (nextSet.has(path)) nextSet.delete(path)
      else nextSet.add(path)
      const paths = [...nextSet]
      if (expandedProjects.has(projectId)) paths.unshift('')
      void window.aladdeen.projects.persistExpandedPaths(projectId, paths)
      return { ...current, [projectId]: nextSet }
    })
    if (opening) void loadChildren(projectId, path)
    setSelectedLocation(projectId, path)
  }

  const loadChildren = async (projectId: string, parentPath: string, cursor?: number): Promise<void> => {
    const key = treeKey(projectId, parentPath)
    if (cursor === undefined && treePages[key] && treePages[key]!.total === treePages[key]!.entries.length) return
    setLoadingTreeKeys((current) => new Set(current).add(key))
    const result = await window.aladdeen.projects.listChildren(projectId, parentPath, cursor)
    setLoadingTreeKeys((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setTreePages((current) => ({
      ...current,
      [key]: cursor
        ? { ...result.value, entries: [...(current[key]?.entries ?? []), ...result.value.entries] }
        : result.value
    }))
  }

  const renameEntry = async (projectId: string, node: WorkspaceTreeNode, name: string): Promise<boolean> => {
    const result = await window.aladdeen.files.rename({ projectId, path: node.path, newName: name })
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
    const result = await window.aladdeen.files.trash(trashNode.projectId, trashNode.node.path)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`${trashNode.node.name} moved to Trash.`)
    setTrashNode(null)
    await refreshEnvironment()
  }

  const beginNewDocument = (
    documentKind: NewDocumentKind,
    projectId?: string,
    folderPath = ''
  ): void => {
    setNewDocumentKind(documentKind)
    if (!projectId) {
      void createFile(undefined, documentKind)
      return
    }
    setSelectedLocation(projectId, folderPath)
    setFormKind('file')
  }

  const renderProject = (project: ProjectSummary): React.JSX.Element => {
    const projectOpen = !project.archived && !query && expandedProjects.has(project.id)
    const rootPage = treePages[treeKey(project.id, '')]
    return (
      <div className={cn('project-group [&+.project-group]:mt-px', project.archived && 'opacity-70')} key={project.id}>
        <div
          className={projectRowClasses(selectedProjectId === project.id && selectedFolderPath === '')}
        >
          <button
            className="flex h-[29px] min-w-0 flex-1 items-center gap-[6px] border-0 bg-transparent px-1 text-left text-[12px] text-inherit [&>svg:nth-child(2)]:text-[color-mix(in_oklab,var(--accent)_55%,var(--text-soft))] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"
            onClick={() => project.archived ? setManageProjectTarget(project) : toggleProject(project.id)}
            title={`${project.displayPath}\n${project.fileCount.toLocaleString()} indexed files`}
          >
            {project.archived ? <Archive size={13} /> : projectOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {projectOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
            <span>{project.name}</span>
            {project.pinned && <Pin className="shrink-0 fill-[color-mix(in_oklab,var(--accent)_28%,transparent)] text-accent" size={10} aria-label="Favorite" />}
            <small className="shrink-0 text-[9px] font-medium text-foreground-muted">{project.indexStatus === 'indexing' ? '…' : project.fileCount.toLocaleString()}</small>
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button className={rowMoreClasses} aria-label={`Actions for ${project.name}`}><MoreHorizontal size={14} /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={dropdownContentClasses} sideOffset={4} align="start">
                {!project.archived && <>
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className={dropdownItemClasses()}>
                      <FilePlus2 size={14} /> New file <ChevronRight className="ml-auto" size={13} />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent className={dropdownContentClasses} sideOffset={4}>
                        <DocumentKindItems
                          enabledKinds={project.enabledDocumentKinds}
                          onSelect={(kind) => beginNewDocument(kind, project.id)}
                          onManage={() => setManageProjectTarget(project)}
                        />
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                  <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => { setSelectedLocation(project.id, ''); setFormKind('folder') }}><FolderPlus size={14} /> New subfolder</DropdownMenu.Item>
                </>}
                <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => setManageProjectTarget(project)}><SlidersHorizontal size={14} /> Project settings</DropdownMenu.Item>
                <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => void window.aladdeen.files.revealProjectEntry(project.id, '')}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
                <DropdownMenu.Separator className={dropdownSeparatorClasses} />
                <DropdownMenu.Item className={dropdownItemClasses(true)} onSelect={() => setRemoveProjectTarget(project)}><Unlink size={14} /> Remove from environment</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {projectOpen && (
          <div className="min-w-0" role="tree">
            {loadingTreeKeys.has(treeKey(project.id, '')) && !rootPage ? (
              <div className="pt-[6px] pr-[10px] pb-2 pl-9 text-[10px] text-foreground-muted"><LoaderCircle className="spinner" size={12} /> Indexing…</div>
            ) : !rootPage || rootPage.entries.length === 0 ? (
              <div className="pt-[6px] pr-[10px] pb-2 pl-9 text-[10px] text-foreground-muted">{project.indexStatus === 'indexing' ? 'Indexing documents…' : 'No supported documents in this scope'}</div>
            ) : rootPage.entries.map((node) => (
              <ProjectTreeItem
                key={node.path}
                projectId={project.id}
                node={node}
                depth={0}
                activeFileId={activeFileId}
                trackedFilesByProjectPath={trackedFilesByProjectPath}
                expanded={expandedFolders[project.id] ?? new Set()}
                pages={treePages}
                loadingKeys={loadingTreeKeys}
                enabledDocumentKinds={project.enabledDocumentKinds}
                onToggle={toggleFolder}
                onOpen={(path) => void openDocument({ kind: 'project', projectId: project.id, relativePath: path })}
                onSelectFolder={(path) => setSelectedLocation(project.id, path)}
                onRename={(item) => setRenameNode({ projectId: project.id, node: item })}
                onTrash={(item) => setTrashNode({ projectId: project.id, node: item })}
                onCreate={(path, kind, documentKind) => {
                  if (kind === 'file') beginNewDocument(documentKind ?? 'markdown', project.id, path)
                  else {
                    setSelectedLocation(project.id, path)
                    setFormKind('folder')
                  }
                }}
                onLoadMore={(path, cursor) => void loadChildren(project.id, path, cursor)}
                onManageDocumentKinds={() => setManageProjectTarget(project)}
              />
            ))}
            {rootPage?.nextCursor !== undefined && (
              <button className={treeLoadMoreClasses()} onClick={() => void loadChildren(project.id, '', rootPage.nextCursor)}>Show more</button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!environment) return <aside className={cn(sidebarClasses, compact && 'is-compact w-full shadow-[12px_0_38px_rgb(0_0_0/.18)]')} aria-label="Environment files" />

  return (
    <aside className={cn(sidebarClasses, compact && 'is-compact w-full shadow-[12px_0_38px_rgb(0_0_0/.18)]')} aria-label="Environment files">
      <div className="flex min-h-11 shrink-0 items-center justify-between pt-2 pr-[9px] pb-1 pl-[11px]">
        <div className="flex min-w-0 items-center gap-2" aria-label="Aladdeen Research">
          <BrandMark className="block h-[25px] w-[25px] shrink-0 drop-shadow-[0_3px_7px_rgb(0_0_0/.16)]" />
          <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
            <strong className="shrink-0 text-[13px] font-[720] tracking-[-.015em] text-foreground">Aladdeen</strong>
            <span className="sidebar-brand-signature truncate text-foreground-soft" aria-hidden="true">Research</span>
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className={sidebarIconButtonClasses}
            onClick={() => {
              if (compact) setSidebarOpen(false)
              setGlobalSearchOpen(true)
            }}
            aria-label="Search document contents"
            title="Search document contents (⌘ Shift F)"
          >
            <FileSearch2 size={15} />
          </button>
          <button
            className={sidebarIconButtonClasses}
            onClick={() => setSearchOpen((value) => !value)}
            aria-label={searchOpen ? 'Close file filter' : 'Filter projects and files'}
            title={searchOpen ? 'Close file filter' : 'Filter projects and files'}
          >
            {searchOpen ? <X size={15} /> : <Search size={15} />}
          </button>
          <button
            className={sidebarIconButtonClasses}
            onClick={() => compact ? setSidebarOpen(false) : void updateSettings({ sidebarCollapsed: true })}
            aria-label={compact ? 'Close sidebar' : 'Collapse sidebar'}
            title={compact ? 'Close sidebar' : 'Collapse sidebar'}
          >
            {compact ? <X size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>

      <div className="mx-[10px] mt-0.5 mb-[5px] grid min-w-0 shrink-0 gap-0.5 rounded-lg border border-border bg-[color-mix(in_oklab,var(--surface-elevated)_72%,transparent)] px-[9px] py-2" title={activeDocument?.fullPath}>
        <strong className={cn('overflow-hidden text-[12px] font-[630] leading-4 text-ellipsis whitespace-nowrap text-foreground', !activeDocument && 'text-foreground-soft')}>{activeDocument?.name ?? 'No file selected'}</strong>
        <span className="active-document-location overflow-hidden text-[9px] leading-[13px] text-ellipsis whitespace-nowrap text-foreground-muted">{activeDocument?.location ?? 'Open or create a document'}</span>
      </div>

      <div className="flex min-h-[35px] shrink-0 items-center justify-between pt-0 pr-[9px] pb-0.5 pl-[11px]">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex h-[29px] min-w-0 max-w-full items-center gap-[5px] rounded-[7px] border-0 bg-transparent px-[5px] text-[12px] font-[650] tracking-[-.015em] text-foreground transition-transform duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover" aria-label="Switch environment">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{environment.environment.name}</span><ChevronDown size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={cn(dropdownContentClasses, 'w-56')} sideOffset={6} align="start">
              <DropdownMenu.Label className={dropdownLabelClasses}>Environments</DropdownMenu.Label>
              {environment.environments.map((item) => (
                <DropdownMenu.Item key={item.id} className={dropdownItemClasses()} onSelect={() => void switchEnvironment(item.id)}>
                  <span className={menuCheckClasses}>{item.id === environment.environment.id && <Check size={14} />}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className={dropdownSeparatorClasses} />
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => setFormKind('environment')}><Plus size={14} /> New environment</DropdownMenu.Item>
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => setFormKind('rename-environment')}><Pencil size={14} /> Rename environment</DropdownMenu.Item>
              <DropdownMenu.Item className={dropdownItemClasses(true)} onSelect={() => setDeleteEnvironmentOpen(true)}><Trash2 size={14} /> Delete environment</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {searchOpen && (
        <label className="mx-[9px] mt-0.5 mb-[5px] flex h-8 shrink-0 items-center gap-[7px] rounded-[7px] border border-border bg-surface-elevated px-2 text-foreground-muted focus-within:border-accent-muted focus-within:shadow-[0_0_0_2px_var(--accent-soft)]">
          <Search size={14} />
          <input className="min-w-0 flex-1 select-text border-0 bg-transparent text-[11px] text-foreground outline-0" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and projects" />
          {query && <button className="grid h-[18px] w-[18px] place-items-center rounded border-0 bg-transparent p-0 text-foreground-muted" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
        </label>
      )}

      <div className="flex shrink-0 flex-col items-stretch gap-px px-[9px] pt-[3px] pb-[10px]">
        <button className={sidebarQuickActionClasses} onClick={() => void addProject()}><FolderOpen size={15} /> Add folder</button>
        <button className={sidebarQuickActionClasses} onClick={() => void openFile()}><FileText size={15} /> Open file</button>
        <div aria-hidden="true" className="mx-[3px] my-[5px] border-t border-border" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={sidebarQuickActionClasses}>
              <FilePlus2 size={15} /> New file <ChevronDown className="ml-auto" size={13} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={dropdownContentClasses} sideOffset={4} align="start">
              <DocumentKindItems
                enabledKinds={selectedProject?.enabledDocumentKinds}
                onSelect={(kind) => beginNewDocument(
                  kind,
                  selectedProjectId ?? undefined,
                  selectedFolderPath
                )}
                onManage={selectedProject ? () => setManageProjectTarget(selectedProject) : undefined}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button className={sidebarQuickActionClasses} onClick={() => setFormKind('project')}><FolderPlus size={15} /> New folder</button>
      </div>

      <ScrollArea.Root className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea.Viewport className="h-full w-full px-[10px] pb-[22px]">
          <section className="sidebar-section" aria-labelledby="projects-heading">
            <div className="flex min-h-7 items-center justify-between pr-1 pl-[3px]">
              <h2 className="m-0 text-[11px] font-[560] tracking-[.01em] text-foreground-muted" id="projects-heading">Projects</h2>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button className={sectionAddClasses} aria-label="Add project"><Plus size={14} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className={dropdownContentClasses} sideOffset={4} align="end">
                    <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => setFormKind('project')}><FolderPlus size={14} /> Create new folder</DropdownMenu.Item>
                    <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => void addProject()}><FolderOpen size={14} /> Add existing folder</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>

            {query && searchResults.length > 0 && (
              <div className="mb-[9px] grid gap-px border-b border-border pb-2">
                <span className="px-[5px] pt-0.5 pb-1 text-[9px] font-[650] text-foreground-muted uppercase">Indexed files</span>
                {searchResults.map((file) => (
                  <button className="flex min-h-[39px] min-w-0 items-center gap-[7px] rounded-[7px] border-0 bg-transparent px-[6px] py-1 text-left text-foreground-soft hover:bg-surface-hover hover:text-foreground" key={`${file.projectId}:${file.relativePath}`} onClick={() => void openDocument({ kind: 'project', projectId: file.projectId, relativePath: file.relativePath })}>
                    <FileText className="shrink-0 text-foreground-muted" size={13} />
                    <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"><strong className="block min-w-0 overflow-hidden text-[11px] font-[590] text-ellipsis whitespace-nowrap text-foreground">{file.name}</strong><small className="block min-w-0 overflow-hidden text-[9px] text-ellipsis whitespace-nowrap text-foreground-muted">{file.location}</small></span>
                  </button>
                ))}
              </div>
            )}

            {groupedProjects.length === 0 && (!query || searchResults.length === 0) ? (
              <div className="flex items-center gap-[7px] pt-[9px] pr-[6px] pb-3 pl-[6px] text-[10px] text-foreground-muted"><FolderKanban size={16} /><span>{query ? 'No indexed files or projects match' : 'Create or add a folder project'}</span></div>
            ) : groupedProjects.map((group) => (
              <div className="project-library-group [&+.project-library-group]:mt-2" key={group.name}>
                {(groupedProjects.length > 1 || group.name !== 'Ungrouped') && <div className="px-[5px] pt-[5px] pb-[3px] pl-5 text-[9px] font-[650] tracking-[.025em] text-foreground-muted uppercase">{group.name}</div>}
                {group.projects.map(renderProject)}
              </div>
            ))}

            {!query && archivedProjects.length > 0 && (
              <details className="mt-2 border-t border-border pt-[6px] [&>summary::-webkit-details-marker]:hidden">
                <summary className="flex h-[27px] cursor-default list-none items-center gap-[6px] rounded-md px-[5px] text-[10px] text-foreground-muted hover:bg-surface-hover hover:text-foreground"><Archive size={12} /> Archived <span className="ml-auto">{archivedProjects.length}</span></summary>
                {archivedProjects.map(renderProject)}
              </details>
            )}
          </section>

          <section className="sidebar-section mt-5" aria-labelledby="files-heading">
            <div className="flex min-h-7 items-center justify-between pr-1 pl-[3px]"><h2 className="m-0 text-[11px] font-[560] tracking-[.01em] text-foreground-muted" id="files-heading">Individual files</h2><span className="h-[18px] min-w-[19px] rounded-[9px] bg-surface-muted px-[5px] text-center text-[9px] leading-[18px] text-foreground-muted">{environment.files.length}</span></div>
            {visibleFiles.length === 0 ? (
              <div className="flex items-center gap-[7px] pt-[9px] pr-[6px] pb-3 pl-[6px] text-[10px] text-foreground-muted"><FileText size={16} /><span>{query ? 'No matching files' : 'Opened files stay here'}</span></div>
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
              <button className="h-7 rounded-md border-0 bg-transparent px-[6px] text-[10px] text-foreground-muted transition-transform duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show less' : `Show all ${environment.files.length}`}</button>
            )}
          </section>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="flex w-2 touch-none select-none p-0.5" orientation="vertical"><ScrollArea.Thumb className="flex-1 rounded-full bg-border-strong" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <footer className="flex min-h-[46px] shrink-0 items-center justify-between gap-[5px] border-t border-border bg-[color-mix(in_oklab,var(--surface)_96%,transparent)] px-[9px] py-[7px]">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={sidebarFooterButtonClasses} aria-label="Appearance">
              <ThemeIcon size={15} />
              <span>{themeOptions.find((option) => option.value === settings.theme)?.label ?? 'Appearance'}</span>
              <ChevronDown size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={cn(dropdownContentClasses, 'min-w-[178px]')} side="top" sideOffset={7} align="start">
              <DropdownMenu.Label className={dropdownLabelClasses}>Appearance</DropdownMenu.Label>
              {themeOptions.map((option) => (
                <DropdownMenu.Item
                  key={option.value}
                  className={dropdownItemClasses()}
                  onSelect={() => void updateSettings({ theme: option.value })}
                >
                  <span className={menuCheckClasses}>{settings.theme === option.value && <Check size={14} />}</span>
                  {option.label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className={dropdownSeparatorClasses} />
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => setSettingsOpen(true)}>
                <Settings2 size={14} />
                More appearance settings
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button
          className={cn(sidebarFooterButtonClasses, 'ml-auto')}
          data-aladdeen-settings-trigger
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={15} />
          <span>Settings</span>
        </button>
      </footer>

      <SidebarForm
        kind={formKind}
        title={formKind === 'file'
          ? `New ${newDocumentKind === 'markdown'
            ? 'Markdown'
            : newDocumentKind === 'html'
              ? 'HTML'
              : newDocumentKind === 'docx'
                ? 'Word'
                : newDocumentKind === 'xlsx'
                  ? 'Excel'
                  : 'PowerPoint'} document`
          : undefined}
        initialValue={formKind === 'rename-environment' ? environment.environment.name : ''}
        locationLabel={selectedProjectId ? environment.projects.find((project) => project.id === selectedProjectId)?.name : undefined}
        onClose={() => setFormKind(null)}
        onSubmit={async (value) => {
          if (formKind === 'environment') return createEnvironment(value)
          if (formKind === 'rename-environment') return renameEnvironment(value)
          if (formKind === 'project') { await createProject(value); return true }
          if (formKind === 'file') { await createFile(value, newDocumentKind); return true }
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
        description={trashNode?.node.kind === 'directory' ? 'The folder and everything inside it will be moved to your system Trash.' : 'You can recover this document later from your system Trash.'}
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
        description="Only Aladdeen’s saved environment metadata is removed. No folders or documents will be deleted."
        confirmLabel="Delete environment"
        destructive
        onCancel={() => setDeleteEnvironmentOpen(false)}
        onConfirm={async () => { await removeEnvironment(); setDeleteEnvironmentOpen(false) }}
      />
      <ProjectSettingsDialog project={manageProjectTarget} onOpenChange={(open) => !open && setManageProjectTarget(null)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onShowTutorial={onShowTutorial} />
    </aside>
  )
}

function DocumentKindItems({
  enabledKinds,
  onSelect,
  onManage
}: {
  enabledKinds?: readonly DocumentKind[]
  onSelect(documentKind: NewDocumentKind): void
  onManage?(): void
}): React.JSX.Element {
  const enabled = new Set<DocumentKind>(enabledKinds ?? ['markdown', 'html', 'docx', 'xlsx', 'pptx'])
  const hasCreatableDocument = enabled.has('markdown') || enabled.has('html') || enabled.has('docx') || enabled.has('xlsx') || enabled.has('pptx')
  return (
    <>
      {enabled.has('markdown') && (
        <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onSelect('markdown')}>
          <FileText size={14} /> Markdown
        </DropdownMenu.Item>
      )}
      {enabled.has('html') && (
        <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onSelect('html')}>
          <FileCode2 size={14} /> HTML
        </DropdownMenu.Item>
      )}
      {enabled.has('docx') && (
        <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onSelect('docx')}>
          <FileText size={14} /> Word document
        </DropdownMenu.Item>
      )}
      {enabled.has('xlsx') && (
        <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onSelect('xlsx')}>
          <DocumentKindIcon kind="xlsx" size={14} /> Excel workbook
        </DropdownMenu.Item>
      )}
      {enabled.has('pptx') && (
        <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onSelect('pptx')}>
          <DocumentKindIcon kind="pptx" size={14} /> PowerPoint presentation
        </DropdownMenu.Item>
      )}
      {onManage && (
        <>
          {hasCreatableDocument && <DropdownMenu.Separator className={dropdownSeparatorClasses} />}
          <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onManage}>
            <SlidersHorizontal size={14} /> Manage file types…
          </DropdownMenu.Item>
        </>
      )}
    </>
  )
}

function ProjectTreeItem({
  projectId, node, depth, activeFileId, trackedFilesByProjectPath, expanded, pages, loadingKeys, enabledDocumentKinds,
  onToggle, onOpen, onSelectFolder, onRename, onTrash, onCreate, onLoadMore, onManageDocumentKinds
}: {
  projectId: string
  node: WorkspaceTreeNode
  depth: number
  activeFileId: string | null
  trackedFilesByProjectPath: ReadonlyMap<string, TrackedFileSummary>
  expanded: Set<string>
  pages: Record<string, ProjectTreePage>
  loadingKeys: Set<string>
  enabledDocumentKinds: readonly DocumentKind[]
  onToggle(projectId: string, path: string): void
  onOpen(path: string): void
  onSelectFolder(path: string): void
  onRename(node: WorkspaceTreeNode): void
  onTrash(node: WorkspaceTreeNode): void
  onCreate(path: string, kind: 'file' | 'folder', documentKind?: NewDocumentKind): void
  onLoadMore(path: string, cursor: number): void
  onManageDocumentKinds(): void
}): React.JSX.Element {
  const isExpanded = expanded.has(node.path)
  const page = pages[treeKey(projectId, node.path)]
  const loading = loadingKeys.has(treeKey(projectId, node.path))
  const tracked = node.kind === 'file' ? trackedFilesByProjectPath.get(`${projectId}\0${node.path}`) : undefined
  return (
    <div role="treeitem" aria-expanded={node.kind === 'directory' ? isExpanded : undefined}>
      <div
        className={environmentTreeRowClasses(tracked?.id === activeFileId)}
        style={{ '--tree-depth': depth } as React.CSSProperties}
      >
        <button className="flex h-7 min-w-0 flex-1 items-center gap-[6px] border-0 bg-transparent px-[3px] text-left text-inherit [&>svg]:shrink-0 [&>svg]:text-foreground-muted [&>span:last-child]:overflow-hidden [&>span:last-child]:text-ellipsis [&>span:last-child]:whitespace-nowrap" onClick={() => {
          if (node.kind === 'directory') { onSelectFolder(node.path); onToggle(projectId, node.path) }
          else onOpen(node.path)
        }}>
          <span className="grid w-3 shrink-0 basis-3 place-items-center text-foreground-muted">{node.kind === 'directory' && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}</span>
          {node.kind === 'directory'
            ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />)
            : <DocumentKindIcon kind={node.documentKind} size={14} />}
          <span>{node.name}</span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button className={rowMoreClasses} aria-label={`Actions for ${node.name}`}><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={dropdownContentClasses} sideOffset={4} align="start">
              {node.kind === 'directory' && <>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={dropdownItemClasses()}>
                    <FilePlus2 size={14} /> New file <ChevronRight className="ml-auto" size={13} />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={dropdownContentClasses} sideOffset={4}>
                      <DocumentKindItems
                        enabledKinds={enabledDocumentKinds}
                        onSelect={(kind) => onCreate(node.path, 'file', kind)}
                        onManage={onManageDocumentKinds}
                      />
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onCreate(node.path, 'folder')}><FolderPlus size={14} /> New subfolder</DropdownMenu.Item>
              </>}
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => onRename(node)}><Pencil size={14} /> Rename</DropdownMenu.Item>
              <DropdownMenu.Item className={dropdownItemClasses()} onSelect={() => void window.aladdeen.files.revealProjectEntry(projectId, node.path)}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
              <DropdownMenu.Separator className={dropdownSeparatorClasses} />
              <DropdownMenu.Item className={dropdownItemClasses(true)} onSelect={() => onTrash(node)}><Trash2 size={14} /> Move to Trash</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {node.kind === 'directory' && isExpanded && (
        <>
          {loading && !page && <div className="flex min-h-[25px] items-center gap-[5px] pl-[calc(35px+var(--tree-depth,0)*14px)] text-[9px] text-foreground-muted" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}><LoaderCircle className="spinner" size={11} /> Loading…</div>}
          {page?.entries.map((child) => (
            <ProjectTreeItem
              key={child.path}
              projectId={projectId}
              node={child}
              depth={depth + 1}
              activeFileId={activeFileId}
              trackedFilesByProjectPath={trackedFilesByProjectPath}
              expanded={expanded}
              pages={pages}
              loadingKeys={loadingKeys}
              enabledDocumentKinds={enabledDocumentKinds}
              onToggle={onToggle}
              onOpen={onOpen}
              onSelectFolder={onSelectFolder}
              onRename={onRename}
              onTrash={onTrash}
              onCreate={onCreate}
              onLoadMore={onLoadMore}
              onManageDocumentKinds={onManageDocumentKinds}
            />
          ))}
          {page?.nextCursor !== undefined && <button className={treeLoadMoreClasses(true)} onClick={() => onLoadMore(node.path, page.nextCursor!)}>Show more</button>}
          {page && page.entries.length === 0 && <div className="flex min-h-[25px] items-center gap-[5px] pl-[calc(35px+var(--tree-depth,0)*14px)] text-[9px] text-foreground-muted" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}>No supported documents</div>}
        </>
      )}
    </div>
  )
}

function TrackedFileRow({ file, active, onOpen, onLocate, onRemove, onTrash }: { file: TrackedFileSummary; active: boolean; onOpen(): void; onLocate(): void; onRemove(): void; onTrash(): void }): React.JSX.Element {
  const displayName = markdownDisplayName(file.name)
  const displayLocation = trackedFileDisplayLocation(file)
  return (
    <div className={trackedFileRowClasses(active, file.missing)} title={file.fullPath}>
      <button className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-[6px] pr-[7px] pl-2 text-left text-inherit" onClick={onOpen} aria-label={`Open ${file.name}`}>
        {file.missing
          ? <FileQuestion className="shrink-0 text-foreground-muted" size={15} />
          : <DocumentKindIcon className="shrink-0 text-foreground-muted" kind={file.documentKind} size={15} />}
        <span className="tracked-file-copy block min-w-0 flex-1"><strong className="block overflow-hidden text-[12px] font-[580] leading-[17px] text-ellipsis whitespace-nowrap text-inherit">{displayName}</strong><small className="block overflow-hidden text-[10px] leading-[15px] text-ellipsis whitespace-nowrap text-foreground-muted">{displayLocation}</small></span>
        {file.missing && <span className="shrink-0 rounded-[5px] bg-danger-soft px-[5px] py-0.5 text-[8px] font-bold text-danger">Missing</span>}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button className={rowMoreClasses} aria-label={`Actions for ${file.name}`}><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={dropdownContentClasses} sideOffset={4} align="start">
            {file.missing && <DropdownMenu.Item className={dropdownItemClasses()} onSelect={onLocate}><LocateFixed size={14} /> Locate file</DropdownMenu.Item>}
            <DropdownMenu.Item className={dropdownItemClasses()} disabled={file.missing} onSelect={() => void window.aladdeen.files.revealTracked(file.id)}><FolderOpen size={14} /> Reveal in folder</DropdownMenu.Item>
            <DropdownMenu.Separator className={dropdownSeparatorClasses} />
            <DropdownMenu.Item className={dropdownItemClasses(true)} disabled={file.missing} onSelect={onTrash}><Trash2 size={14} /> Move to Trash</DropdownMenu.Item>
            <DropdownMenu.Item className={dropdownItemClasses(true)} onSelect={onRemove}><Unlink size={14} /> Remove from environment</DropdownMenu.Item>
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
    file: 'New file',
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
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content className={cn(dialogContentClasses, 'compact-dialog')}>
          <div className={dialogIconClasses()}>{kind === 'file' ? <FilePlus2 size={18} /> : kind?.includes('environment') ? <FolderKanban size={18} /> : <FolderPlus size={18} />}</div>
          <Dialog.Title className={dialogTitleClasses}>{title ?? (kind ? labels[kind] : '')}</Dialog.Title>
          <Dialog.Description className={dialogDescriptionClasses}>
            {kind === 'project' ? 'You’ll choose where to create it next.' : locationLabel && (kind === 'file' || kind === 'folder') ? `Create inside ${locationLabel}` : kind?.includes('environment') ? 'Environment names are unique in Aladdeen.' : 'Choose a clear, portable name.'}
          </Dialog.Description>
          <input className={dialogInputClasses} value={value} autoFocus onFocus={(event) => kind?.includes('rename') && event.currentTarget.select()} placeholder={kind === 'file' ? 'Document name' : kind === 'project' || kind === 'folder' ? 'Folder name' : 'Environment name'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void submit()} />
          <div className={dialogActionsClasses}><Dialog.Close className={buttonClasses({ variant: 'secondary' })}>Cancel</Dialog.Close><button className={buttonClasses()} disabled={!value.trim() || busy} onClick={() => void submit()}>{busy ? 'Working…' : submitLabel ?? (kind?.includes('rename') ? 'Rename' : 'Create')}</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmDialog({ open, title, description, confirmLabel, destructive = false, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; onCancel(): void; onConfirm(): Promise<void> }): React.JSX.Element {
  return (
    <AlertDialog.Root open={open} onOpenChange={(value) => !value && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClasses} />
        <AlertDialog.Content className={dialogContentClasses}>
          <div className={dialogIconClasses(destructive ? 'destructive' : 'default')}>{destructive ? <Trash2 size={18} /> : <Unlink size={18} />}</div>
          <AlertDialog.Title className={dialogTitleClasses}>{title}</AlertDialog.Title>
          <AlertDialog.Description className={dialogDescriptionClasses}>{description}</AlertDialog.Description>
          <div className={dialogActionsClasses}><AlertDialog.Cancel className={buttonClasses({ variant: 'secondary' })}>Cancel</AlertDialog.Cancel><AlertDialog.Action className={buttonClasses({ variant: destructive ? 'danger' : 'primary' })} onClick={() => void onConfirm()}>{confirmLabel}</AlertDialog.Action></div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

function treeKey(projectId: string, parentPath: string): string {
  return `${projectId}:${parentPath}`
}
