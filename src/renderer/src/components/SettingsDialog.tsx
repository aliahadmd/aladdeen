import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AtSign, BookOpen, Check, Command, ExternalLink, Github, Info, Mail, Palette, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import packageMetadata from '../../../../package.json'
import { cn } from '@renderer/lib/cn'
import { COMPACT_SETTINGS_QUERY } from '@renderer/lib/breakpoints'
import {
  dialogContentClasses,
  dialogOverlayClasses
} from '@renderer/lib/ui-styles'
import { accentOptions, themeOptions, useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onShowTutorial?(): void
}

type SettingsCategory = 'appearance' | 'shortcuts' | 'about'

interface SettingsCategoryDefinition {
  id: SettingsCategory
  label: string
  description: string
  icon: LucideIcon
}

interface ShortcutDefinition {
  name: string
  keys: string
  accessibleKeys: string
}

const SETTINGS_CATEGORIES: SettingsCategoryDefinition[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Choose how Aladdeen looks on this device.',
    icon: Palette
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Move through your workspace without leaving the keyboard.',
    icon: Command
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, storage, and privacy information.',
    icon: Info
  }
]

const SHORTCUTS: ShortcutDefinition[] = [
  { name: 'Quick open', keys: '⌘ P', accessibleKeys: 'Command P' },
  { name: 'Search contents', keys: '⌘ ⇧ F', accessibleKeys: 'Command Shift F' },
  { name: 'Open file', keys: '⌘ O', accessibleKeys: 'Command O' },
  { name: 'Add project', keys: '⌘ ⇧ O', accessibleKeys: 'Command Shift O' },
  { name: 'Edit or preview', keys: '⌘ E', accessibleKeys: 'Command E' },
  { name: 'Save now', keys: '⌘ S', accessibleKeys: 'Command S' }
]

const DEVELOPER_LINKS = [
  {
    label: 'X',
    value: 'x.com/aliahadmd1',
    target: 'https://x.com/aliahadmd1',
    icon: AtSign
  },
  {
    label: 'GitHub',
    value: 'github.com/aliahadmd',
    target: 'https://github.com/aliahadmd',
    icon: Github
  },
  {
    label: 'Email',
    value: 'ali@aliahad.com',
    target: 'mailto:ali@aliahad.com',
    icon: Mail
  }
] as const

let lastSettingsCategory: SettingsCategory = 'appearance'

function useCompactSettingsLayout(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_SETTINGS_QUERY).matches
  )

  useEffect(() => {
    const media = window.matchMedia(COMPACT_SETTINGS_QUERY)
    const update = (): void => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return compact
}

export function SettingsDialog({ open, onOpenChange, onShowTutorial }: SettingsDialogProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(lastSettingsCategory)
  const tabRefs = useRef(new Map<SettingsCategory, HTMLButtonElement>())
  const panelHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const compact = useCompactSettingsLayout()
  const activeDefinition = SETTINGS_CATEGORIES.find((category) => category.id === activeCategory) ?? SETTINGS_CATEGORIES[0]!

  const selectCategory = (category: SettingsCategory, focusPanel = false): void => {
    lastSettingsCategory = category
    setActiveCategory(category)
    if (focusPanel) {
      requestAnimationFrame(() => panelHeadingRef.current?.focus())
    }
  }

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    category: SettingsCategory
  ): void => {
    const index = SETTINGS_CATEGORIES.findIndex((item) => item.id === category)
    let nextIndex: number | undefined

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % SETTINGS_CATEGORIES.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = SETTINGS_CATEGORIES.length - 1
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectCategory(category, true)
      return
    }

    if (nextIndex === undefined) return
    event.preventDefault()
    const nextCategory = SETTINGS_CATEGORIES[nextIndex]
    if (nextCategory) tabRefs.current.get(nextCategory.id)?.focus()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content
          className={cn(
            dialogContentClasses,
            'grid h-[min(580px,calc(100vh-32px))] w-[min(calc(100vw-32px),760px)] grid-cols-[176px_minmax(0,1fr)] overflow-hidden p-0 outline-none',
            'max-[720px]:h-[calc(100vh-24px)] max-[720px]:w-[calc(100vw-24px)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)] max-[720px]:rounded-[11px]'
          )}
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef.current?.isConnected) return
            event.preventDefault()
            returnFocusRef.current.focus()
          }}
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Description className="sr-only">
            Personalize Aladdeen without changing your documents.
          </Dialog.Description>

          <aside className="flex min-h-0 flex-col border-r border-border bg-surface max-[720px]:border-r-0 max-[720px]:border-b">
            <div className="flex h-[54px] shrink-0 items-center px-3 max-[720px]:h-11 max-[720px]:border-b max-[720px]:px-[10px]">
              <Dialog.Close
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border-0 bg-surface-muted p-0 text-foreground-soft transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Close settings"
              >
                <X size={17} />
              </Dialog.Close>
              <span className="ml-2 hidden text-[13px] font-[680] text-foreground max-[720px]:block" aria-hidden="true">
                Settings
              </span>
            </div>

            <nav
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-[720px]:flex-none max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden max-[720px]:px-2 max-[720px]:py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Settings categories"
            >
              <div
                className="grid gap-1 max-[720px]:flex max-[720px]:min-w-max"
                role="tablist"
                aria-label="Settings categories"
                aria-orientation={compact ? 'horizontal' : 'vertical'}
              >
                {SETTINGS_CATEGORIES.map((category) => {
                  const Icon = category.icon
                  const active = category.id === activeCategory
                  return (
                    <button
                      key={category.id}
                      ref={(element) => {
                        if (element) tabRefs.current.set(category.id, element)
                        else tabRefs.current.delete(category.id)
                      }}
                      id={`settings-tab-${category.id}`}
                      className={cn(
                        'relative flex h-9 min-w-0 items-center gap-[9px] rounded-[7px] border-0 bg-transparent px-[10px] text-left text-[12px] font-[560] text-foreground-soft transition-colors hover:bg-surface-hover hover:text-foreground',
                        'max-[720px]:h-8 max-[720px]:shrink-0 max-[720px]:px-3',
                        active && "bg-surface-hover text-foreground before:absolute before:top-[9px] before:bottom-[9px] before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:content-[''] max-[720px]:before:top-auto max-[720px]:before:right-3 max-[720px]:before:bottom-0 max-[720px]:before:left-3 max-[720px]:before:h-0.5 max-[720px]:before:w-auto"
                      )}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-current={active ? 'page' : undefined}
                      aria-controls={`settings-panel-${category.id}`}
                      tabIndex={active ? 0 : -1}
                      onClick={() => selectCategory(category.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, category.id)}
                    >
                      <Icon size={16} strokeWidth={1.9} />
                      <span className="whitespace-nowrap">{category.label}</span>
                    </button>
                  )
                })}
              </div>
            </nav>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col bg-surface-elevated">
            <header className="shrink-0 border-b border-border bg-surface-elevated px-6 py-[18px] max-[720px]:px-4 max-[720px]:py-[14px]">
              <h2
                ref={panelHeadingRef}
                className="m-0 text-[16px] font-[680] tracking-[-.01em] text-foreground outline-none focus-visible:rounded focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4"
                tabIndex={-1}
              >
                {activeDefinition.label}
              </h2>
              <p className="mt-1 mb-0 text-[12px] leading-[1.5] text-foreground-muted">
                {activeDefinition.description}
              </p>
            </header>

            <div
              id={`settings-panel-${activeCategory}`}
              className="min-h-0 flex-1 overflow-y-auto px-6 py-3 max-[720px]:px-4"
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeCategory}`}
              tabIndex={0}
            >
              {activeCategory === 'appearance' && (
                <AppearanceSettings
                  settings={settings}
                  onUpdate={(next) => void updateSettings(next)}
                />
              )}
              {activeCategory === 'shortcuts' && (
                <ShortcutSettings />
              )}
              {activeCategory === 'about' && (
                <AboutSettings onShowTutorial={onShowTutorial
                  ? () => {
                      onOpenChange(false)
                      requestAnimationFrame(onShowTutorial)
                    }
                  : undefined}
                />
              )}
            </div>
          </main>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AppearanceSettings({
  settings,
  onUpdate
}: {
  settings: ReturnType<typeof useAppStore.getState>['settings']
  onUpdate(next: Partial<ReturnType<typeof useAppStore.getState>['settings']>): void
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border">
      <section className="grid min-h-[78px] grid-cols-[minmax(110px,1fr)_auto] items-center gap-5 py-4 max-[520px]:grid-cols-1 max-[520px]:gap-3" aria-labelledby="theme-setting-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="theme-setting-label">Theme</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">Follow your system or choose a fixed appearance.</p>
        </div>
        <div className="grid w-[246px] grid-cols-3 gap-[3px] rounded-lg border border-border bg-surface p-[3px] max-[520px]:w-full" role="group" aria-label="Theme">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              className={cn(
                'h-8 rounded-md border-0 bg-transparent text-[12px] font-semibold text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground',
                settings.theme === option.value && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.1)] hover:bg-surface-elevated'
              )}
              type="button"
              onClick={() => onUpdate({ theme: option.value })}
              aria-pressed={settings.theme === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid min-h-[102px] grid-cols-[minmax(110px,1fr)_auto] items-center gap-5 py-4 max-[520px]:grid-cols-1 max-[520px]:gap-3" aria-labelledby="accent-setting-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="accent-setting-label">Accent color</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">Used for selection, focus, and active controls.</p>
        </div>
        <div className="grid w-[290px] grid-cols-5 gap-1 max-[520px]:w-full" role="group" aria-label="Accent color">
          {accentOptions.map((option) => (
            <button
              key={option.value}
              className={cn(
                'grid min-w-0 justify-items-center gap-[6px] rounded-lg border border-transparent bg-transparent px-1 pt-2 pb-[7px] text-[12px] text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground',
                settings.accent === option.value && 'border-accent-muted bg-accent-soft text-foreground hover:bg-accent-soft'
              )}
              type="button"
              onClick={() => onUpdate({ accent: option.value })}
              aria-label={`${option.label} accent`}
              aria-pressed={settings.accent === option.value}
            >
              <span
                className="grid h-6 w-6 place-items-center rounded-full border-2 border-[rgb(255_255_255/.8)] text-white shadow-[0_0_0_1px_rgb(0_0_0/.12)]"
                style={{ backgroundColor: `var(--accent-${option.value})` }}
              >
                {settings.accent === option.value && <Check size={12} />}
              </span>
              <span className="max-[430px]:sr-only">{option.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function ShortcutSettings(): React.JSX.Element {
  return (
    <dl className="m-0 divide-y divide-border">
      {SHORTCUTS.map((shortcut) => (
          <div className="flex min-h-[54px] items-center justify-between gap-5 py-3" key={shortcut.name}>
            <dt className="text-[13px] font-[560] text-foreground-soft">{shortcut.name}</dt>
            <dd className="m-0 shrink-0">
              <kbd
                className="inline-flex min-h-7 items-center rounded-md border border-border-strong bg-surface px-[9px] font-mono text-[11px] font-semibold text-foreground-soft shadow-[0_1px_0_rgb(0_0_0/.05)]"
                aria-label={shortcut.accessibleKeys}
                title={shortcut.accessibleKeys}
              >
                {shortcut.keys}
              </kbd>
            </dd>
          </div>
      ))}
    </dl>
  )
}

function AboutSettings({ onShowTutorial }: { onShowTutorial?(): void }): React.JSX.Element {
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <BrandMark className="h-10 w-10 shrink-0" title="Aladdeen" />
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-[680] text-foreground">Aladdeen Research</h3>
          <p className="mt-1 mb-0 text-[12px] text-foreground-muted">Version {packageMetadata.version}</p>
        </div>
      </div>

      <div className="divide-y divide-border">
        <section className="py-5">
          <h3 className="m-0 text-[13px] font-[620] text-foreground">A private research workspace</h3>
          <p className="mt-2 mb-0 max-w-[520px] text-[12px] leading-[1.65] text-foreground-soft">
            Aladdeen Research brings Markdown, HTML, Word, and PDF documents into one offline-first workspace for reading, organizing, searching, and writing on M-series Apple silicon.
          </p>
        </section>
        <section className="py-5">
          <h3 className="m-0 text-[13px] font-[620] text-foreground">Your files stay yours</h3>
          <p className="mt-2 mb-0 max-w-[520px] text-[12px] leading-[1.65] text-foreground-soft">
            Documents remain at their original disk locations. Aladdeen stores workspace references and preferences locally, without copying document contents into its settings database.
          </p>
        </section>
        {onShowTutorial && (
          <section className="py-5">
            <h3 className="m-0 text-[13px] font-[620] text-foreground">Getting started</h3>
            <p className="mt-2 mb-3 max-w-[520px] text-[12px] leading-[1.65] text-foreground-soft">
              Review how Aladdeen organizes local research and works with each document format.
            </p>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-[12px] font-[620] text-foreground transition-colors hover:bg-surface-hover"
              type="button"
              onClick={onShowTutorial}
            >
              <BookOpen size={15} />
              View tutorial
            </button>
          </section>
        )}
        <section className="py-5">
          <h3 className="m-0 text-[13px] font-[620] text-foreground">Developer</h3>
          <p className="mt-2 mb-0 max-w-[520px] text-[12px] leading-[1.65] text-foreground-soft">
            Contact the developer for product questions, feedback, or security concerns.
          </p>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {DEVELOPER_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <button
                  className="group flex min-h-12 w-full items-center gap-3 border-0 bg-transparent px-1 text-left transition-colors hover:bg-surface-hover"
                  key={link.label}
                  type="button"
                  onClick={() => void window.aladdeen.system.openExternal(link.target)}
                  aria-label={`${link.label}: ${link.value}. Opens externally`}
                >
                  <Icon className="shrink-0 text-foreground-muted" size={16} strokeWidth={1.9} />
                  <span className="w-[58px] shrink-0 text-[12px] font-[620] text-foreground">{link.label}</span>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground-soft">
                    {link.value}
                  </span>
                  <ExternalLink className="shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" size={13} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
