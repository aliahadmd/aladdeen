import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Check,
  ChevronDown,
  Download,
  Edit3,
  FileDown,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  SwatchBook
} from 'lucide-react'
import { accentOptions, themeOptions, useAppStore } from '@renderer/store/app-store'

interface TopBarProps {
  sidebarVisible: boolean
  onToggleSidebar(): void
}

export function TopBar({ sidebarVisible, onToggleSidebar }: TopBarProps): React.JSX.Element {
  const activeFileId = useAppStore((state) => state.activeFileId)
  const documents = useAppStore((state) => state.documents)
  const settings = useAppStore((state) => state.settings)
  const editing = useAppStore((state) => state.editing)
  const setEditing = useAppStore((state) => state.setEditing)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const exportActive = useAppStore((state) => state.exportActive)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const active = documents.find((document) => document.id === activeFileId)

  const toggleSidebar = (): void => {
    if (window.matchMedia('(max-width: 959px)').matches) setSidebarOpen(true)
    else onToggleSidebar()
  }

  const ThemeIcon = settings.theme === 'dark' ? Moon : settings.theme === 'light' ? Sun : SwatchBook

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={100}>
      <header className="topbar">
        <div className="topbar-leading">
          <ToolbarTip label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}>
            <button className="icon-button" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <Menu className="compact-menu-icon" size={17} />
              {sidebarVisible ? (
                <PanelLeftClose className="desktop-panel-icon" size={17} />
              ) : (
                <PanelLeftOpen className="desktop-panel-icon" size={17} />
              )}
            </button>
          </ToolbarTip>
          <div className="brand-mark" aria-label="FluidMD">
            <span>F</span>
          </div>
          <div className="title-block">
            <span className="app-name">FluidMD</span>
            <span className="document-title">{active?.name ?? 'Offline Markdown'}</span>
          </div>
        </div>

        <div className="topbar-actions">
          {active && (
            <>
              <button
                className={`mode-button ${editing ? 'is-active' : ''}`}
                onClick={() => setEditing(!editing)}
                aria-pressed={editing}
              >
                <Edit3 size={15} />
                <span>{editing ? 'Editing' : 'Edit'}</span>
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="toolbar-button">
                    <Download size={15} />
                    <span>Export</span>
                    <ChevronDown size={13} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="dropdown-content" sideOffset={7} align="end">
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => void exportActive('pdf')}>
                      <FileDown size={15} />
                      Export as PDF
                      <span className="item-hint">A4</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => void exportActive('docx')}>
                      <FileDown size={15} />
                      Export as DOCX
                      <span className="item-hint">Word</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="icon-button" aria-label="Appearance">
                <ThemeIcon size={17} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="dropdown-content appearance-menu" sideOffset={7} align="end">
                <DropdownMenu.Label className="dropdown-label">Appearance</DropdownMenu.Label>
                {themeOptions.map((option) => (
                  <DropdownMenu.Item
                    key={option.value}
                    className="dropdown-item"
                    onSelect={() => void updateSettings({ theme: option.value })}
                  >
                    <span className="menu-check">{settings.theme === option.value && <Check size={14} />}</span>
                    {option.label}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className="dropdown-separator" />
                <DropdownMenu.Label className="dropdown-label">Accent</DropdownMenu.Label>
                <div className="accent-grid" aria-label="Accent color">
                  {accentOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`accent-swatch accent-${option.value} ${settings.accent === option.value ? 'is-selected' : ''}`}
                      onClick={() => void updateSettings({ accent: option.value })}
                      aria-label={option.label}
                      title={option.label}
                    >
                      {settings.accent === option.value && <Check size={13} />}
                    </button>
                  ))}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
    </Tooltip.Provider>
  )
}

function ToolbarTip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
