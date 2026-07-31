import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AtSign, Bot, BookOpen, Check, Command, ExternalLink, Github, Info, KeyRound, LoaderCircle, LogOut, Mail, Minus, Palette, Plus, RotateCcw, Search, ShieldAlert, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import packageMetadata from '../../../../package.json'
import {
  AGENT_PROVIDER_DEFINITIONS,
  defaultModelForProvider,
  providerDisplayName
} from '@shared/agent-providers'
import type {
  AgentAuthEvent,
  AgentAuthType,
  AgentCredentialStatus,
  AgentLegacyProviderProfile,
  AgentModel,
  AgentProviderDescriptor,
  AgentProviderId,
  AgentThinkingLevel,
  AppSettings
} from '@shared/contracts'
import {
  DEFAULT_READING_SETTINGS,
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN,
  READING_LINE_HEIGHT_VALUES
} from '@shared/reading'
import { cn } from '@renderer/lib/cn'
import { COMPACT_SETTINGS_QUERY } from '@renderer/lib/breakpoints'
import {
  dialogActionsClasses,
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogIconClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'
import { accentOptions, themeOptions, useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'
import {
  AgentModelPicker,
  type AgentModelPickerStatus
} from './agent/AgentModelPicker'

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onShowTutorial?(): void
}

type SettingsCategory = 'appearance' | 'reading' | 'shortcuts' | 'agent' | 'about'

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
    id: 'reading',
    label: 'Reading',
    description: 'Tune Markdown previews for comfortable, focused reading.',
    icon: BookOpen
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Move through your workspace without leaving the keyboard.',
    icon: Command
  },
  {
    id: 'agent',
    label: 'Coding agent',
    description: 'Connect an optional AI provider for project-aware assistance.',
    icon: Bot
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
              {activeCategory === 'reading' && (
                <ReadingSettings
                  settings={settings}
                  onUpdate={(next) => void updateSettings(next)}
                />
              )}
              {activeCategory === 'shortcuts' && (
                <ShortcutSettings />
              )}
              {activeCategory === 'agent' && (
                <AgentSettings
                  settings={settings}
                  onUpdate={(next) => void updateSettings(next)}
                />
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

const READING_FONT_OPTIONS = [
  { value: 'system', label: 'System', sample: 'Clear and familiar', className: 'font-sans' },
  { value: 'avenir', label: 'Avenir', sample: 'Calm and modern', className: 'font-["Avenir_Next",system-ui,sans-serif]' },
  { value: 'iowan', label: 'Iowan', sample: 'Made for long reading', className: 'font-["Iowan_Old_Style",Charter,serif]' },
  { value: 'georgia', label: 'Georgia', sample: 'Classic and sturdy', className: 'font-[Georgia,serif]' }
] as const

const READING_LINE_HEIGHT_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'relaxed', label: 'Relaxed' }
] as const

const READING_COLUMN_WIDTH_OPTIONS = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'wide', label: 'Wide' }
] as const

const READING_SURFACE_OPTIONS = [
  { value: 'default', label: 'Default', swatch: 'linear-gradient(135deg, #ffffff 0 50%, #18181b 50%)' },
  { value: 'paper', label: 'Paper', swatch: 'linear-gradient(135deg, #FBF8F1 0 50%, #1C1915 50%)' },
  { value: 'sage', label: 'Sage', swatch: 'linear-gradient(135deg, #F3F7F2 0 50%, #171B18 50%)' },
  { value: 'slate', label: 'Slate', swatch: 'linear-gradient(135deg, #F3F5F7 0 50%, #181B20 50%)' }
] as const

function ReadingSettings({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate(next: Partial<AppSettings>): void
}): React.JSX.Element {
  const resetReading = (): void => onUpdate({ ...DEFAULT_READING_SETTINGS })

  return (
    <div className="space-y-6 py-3">
      <section aria-labelledby="reading-font-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="reading-font-label">Reading font</h3>
          <p className="mt-1 mb-3 text-[12px] leading-[1.45] text-foreground-muted">Choose a curated macOS typeface for Markdown prose.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 max-[500px]:grid-cols-1" role="group" aria-label="Reading font">
          {READING_FONT_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={cn(
                'relative min-h-[66px] rounded-lg border border-border bg-surface px-3 py-[10px] text-left transition-colors hover:border-border-strong hover:bg-surface-hover',
                settings.readingFont === option.value && 'border-accent bg-accent-soft hover:border-accent hover:bg-accent-soft'
              )}
              type="button"
              aria-pressed={settings.readingFont === option.value}
              onClick={() => onUpdate({ readingFont: option.value })}
            >
              <span className="flex items-center justify-between gap-2 text-[12px] font-[650] text-foreground">
                {option.label}
                {settings.readingFont === option.value && <Check size={14} className="text-accent" aria-hidden="true" />}
              </span>
              <span className={cn('mt-[7px] block text-[15px] text-foreground-soft', option.className)}>{option.sample}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-border pt-5" aria-labelledby="reading-size-label">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m-0 text-[13px] font-[620] text-foreground" id="reading-size-label">Text size</h3>
            <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">Applies consistently in preview and split layouts.</p>
          </div>
          <span className="min-w-[42px] text-right text-[12px] font-[650] tabular-nums text-foreground" aria-live="polite">{settings.readingFontSize} px</span>
        </div>
        <div className="mt-4 grid grid-cols-[32px_minmax(120px,1fr)_32px] items-center gap-3">
          <button
            className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-foreground-soft hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Decrease reading text size"
            disabled={settings.readingFontSize <= READING_FONT_SIZE_MIN}
            onClick={() => onUpdate({ readingFontSize: Math.max(READING_FONT_SIZE_MIN, settings.readingFontSize - 1) })}
          >
            <Minus size={14} />
          </button>
          <input
            className="reading-size-slider w-full accent-[var(--accent)]"
            type="range"
            min={READING_FONT_SIZE_MIN}
            max={READING_FONT_SIZE_MAX}
            step={1}
            value={settings.readingFontSize}
            aria-labelledby="reading-size-label"
            aria-valuetext={`${settings.readingFontSize} pixels`}
            onChange={(event) => onUpdate({ readingFontSize: Number(event.currentTarget.value) })}
          />
          <button
            className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-foreground-soft hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Increase reading text size"
            disabled={settings.readingFontSize >= READING_FONT_SIZE_MAX}
            onClick={() => onUpdate({ readingFontSize: Math.min(READING_FONT_SIZE_MAX, settings.readingFontSize + 1) })}
          >
            <Plus size={14} />
          </button>
        </div>
      </section>

      <ReadingSegmentedControl
        id="reading-spacing-label"
        label="Line spacing"
        description="Give dense notes more room or keep them compact."
        options={READING_LINE_HEIGHT_OPTIONS}
        value={settings.readingLineHeight}
        onChange={(readingLineHeight) => onUpdate({ readingLineHeight })}
      />

      <ReadingSegmentedControl
        id="reading-width-label"
        label="Reading column"
        description="Limit line length for easier scanning and sustained reading."
        options={READING_COLUMN_WIDTH_OPTIONS}
        value={settings.readingColumnWidth}
        onChange={(readingColumnWidth) => onUpdate({ readingColumnWidth })}
      />

      <section className="border-t border-border pt-5" aria-labelledby="reading-surface-label">
        <h3 className="m-0 text-[13px] font-[620] text-foreground" id="reading-surface-label">Reading surface</h3>
        <p className="mt-1 mb-3 text-[12px] leading-[1.45] text-foreground-muted">Adaptive light and dark palettes apply only to Markdown previews.</p>
        <div className="grid grid-cols-4 gap-2 max-[500px]:grid-cols-2" role="group" aria-label="Reading surface">
          {READING_SURFACE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={cn(
                'rounded-lg border border-border bg-surface p-2 text-[11px] font-[620] text-foreground-soft transition-colors hover:border-border-strong hover:bg-surface-hover',
                settings.readingSurface === option.value && 'border-accent bg-accent-soft text-foreground hover:border-accent hover:bg-accent-soft'
              )}
              type="button"
              aria-pressed={settings.readingSurface === option.value}
              onClick={() => onUpdate({ readingSurface: option.value })}
            >
              <span className="mb-2 block h-7 rounded-[5px] border border-black/10" style={{ background: option.swatch }} aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-border pt-5" aria-labelledby="reading-preview-label">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-[13px] font-[620] text-foreground" id="reading-preview-label">Preview</h3>
            <p className="mt-1 mb-0 text-[12px] text-foreground-muted">Your current reading appearance.</p>
          </div>
          <button
            className="inline-flex h-8 shrink-0 items-center gap-[6px] rounded-md border border-border bg-surface px-[10px] text-[11px] font-[620] text-foreground-soft hover:bg-surface-hover hover:text-foreground"
            type="button"
            onClick={resetReading}
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
        <div
          className="reading-settings-preview reading-surface rounded-xl border p-5"
          data-reading-font={settings.readingFont}
          data-reading-line-height={settings.readingLineHeight}
          data-reading-surface={settings.readingSurface}
          style={{
            '--reading-font-size': `${settings.readingFontSize}px`,
            '--reading-line-height': READING_LINE_HEIGHT_VALUES[settings.readingLineHeight]
          } as React.CSSProperties}
        >
          <h4>A place for careful reading</h4>
          <p>Good typography lets the document become the focus. Notes, evidence, and ideas stay clear without changing the source file.</p>
          <blockquote>Reading is part of the research process.</blockquote>
          <p>Inline <code>code</code> keeps its own specialized typeface.</p>
        </div>
      </section>
    </div>
  )
}

function ReadingSegmentedControl<T extends string>({
  id,
  label,
  description,
  options,
  value,
  onChange
}: {
  id: string
  label: string
  description: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange(value: T): void
}): React.JSX.Element {
  return (
    <section className="border-t border-border pt-5" aria-labelledby={id}>
      <h3 className="m-0 text-[13px] font-[620] text-foreground" id={id}>{label}</h3>
      <p className="mt-1 mb-3 text-[12px] leading-[1.45] text-foreground-muted">{description}</p>
      <div className="grid grid-cols-3 gap-[3px] rounded-lg border border-border bg-surface p-[3px]" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            className={cn(
              'min-h-8 rounded-md border-0 bg-transparent px-2 text-[11px] font-semibold text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground',
              value === option.value && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.1)] hover:bg-surface-elevated'
            )}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
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

const AGENT_THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function AgentSettings({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate(next: Partial<AppSettings>): void
}): React.JSX.Element {
  const [credentials, setCredentials] = useState<AgentCredentialStatus>()
  const [providerCatalog, setProviderCatalog] = useState<AgentProviderDescriptor[]>([])
  const [legacyProfiles, setLegacyProfiles] = useState<AgentLegacyProviderProfile[]>([])
  const [providerSearch, setProviderSearch] = useState('')
  const [modelCatalog, setModelCatalog] = useState<AgentModel[]>([])
  const [modelCatalogStatus, setModelCatalogStatus] = useState<AgentModelPickerStatus>(
    settings.agentEnabled ? 'loading' : 'disabled'
  )
  const [modelCatalogError, setModelCatalogError] = useState<string>()
  const [credentialError, setCredentialError] = useState<string>()
  const [providerOperation, setProviderOperation] = useState<string>()
  const [authEvent, setAuthEvent] = useState<AgentAuthEvent>()
  const [promptValue, setPromptValue] = useState('')
  const activeAttempt = useRef<string | undefined>(undefined)
  const activeSessionProvider = useAppStore((state) => state.agentSession
    ? state.agentCurrentModel?.provider ?? state.settings.agentProvider
    : undefined)
  const hasActiveSession = activeSessionProvider !== undefined

  const refreshCredentials = useCallback(async (): Promise<void> => {
    const result = await window.aladdeen.agent.credentialStatus()
    if (result.ok) {
      setCredentials(result.value)
      setCredentialError(undefined)
    } else {
      setCredentialError(result.error.message)
    }
  }, [])

  const refreshModelCatalog = useCallback(async (): Promise<void> => {
    if (!settings.agentEnabled) {
      setModelCatalog([])
      setModelCatalogStatus('disabled')
      setModelCatalogError(undefined)
      return
    }
    setModelCatalogStatus('loading')
    setModelCatalogError(undefined)
    const result = await window.aladdeen.agent.getModelCatalog()
    if (result.ok) {
      setModelCatalog(result.value)
      setModelCatalogStatus('ready')
    } else {
      setModelCatalogStatus('error')
      setModelCatalogError(result.error.message)
    }
  }, [settings.agentEnabled])

  const refreshProviderData = useCallback(async (): Promise<void> => {
    const legacyResult = await window.aladdeen.agent.getLegacyProviderProfiles()
    if (legacyResult.ok) setLegacyProfiles(legacyResult.value)
    if (!settings.agentEnabled) {
      setProviderCatalog([])
      return
    }
    const result = await window.aladdeen.agent.getProviderCatalog()
    if (result.ok) {
      setProviderCatalog(result.value)
      setCredentialError(undefined)
    } else {
      setCredentialError(result.error.message)
    }
  }, [settings.agentEnabled])

  useEffect(() => {
    void refreshCredentials()
    void refreshModelCatalog()
    void refreshProviderData()
  }, [refreshCredentials, refreshModelCatalog, refreshProviderData])

  useEffect(() => window.aladdeen.agent.onAuthEvent((event) => {
    if (event.type === 'started') activeAttempt.current = event.attemptId
    if (activeAttempt.current && event.attemptId !== activeAttempt.current) return
    setAuthEvent(event)
    if (event.type === 'prompt') setPromptValue('')
    if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
      activeAttempt.current = undefined
      void refreshCredentials()
      void refreshProviderData()
      void refreshModelCatalog()
      if (event.type === 'completed') {
        void window.aladdeen.settings.get().then((result) => {
          if (result.ok) {
            onUpdate({
              agentProvider: result.value.agentProvider,
              agentModelId: result.value.agentModelId
            })
            const appState = useAppStore.getState()
            const projectId = appState.selectedProjectId ??
              appState.documents.find((document) => document.id === appState.activeFileId)?.projectId ??
              appState.environment?.projects.find((project) => !project.archived)?.id
            if (projectId && !appState.agentSession) {
              void appState.startAgentSession(projectId)
            }
          }
        })
      }
    }
  }), [onUpdate, refreshCredentials, refreshModelCatalog, refreshProviderData])

  useEffect(() => () => {
    const attemptId = activeAttempt.current
    if (attemptId) void window.aladdeen.agent.cancelLogin(attemptId)
  }, [])

  const providerStatus = credentials?.providers.find(
    (status) => status.providerId === settings.agentProvider
  )
  const selectedDescriptor = providerCatalog.find(
    (provider) => provider.id === settings.agentProvider
  ) ?? {
    id: settings.agentProvider,
    name: providerDisplayName(settings.agentProvider),
    featured: true,
    oauthAvailable: providerStatus?.oauthAvailable ?? false,
    apiKeyAvailable: providerStatus?.apiKeyAvailable ?? false,
    modelCount: modelCatalog.filter((model) => model.provider === settings.agentProvider).length,
    catalogKind: 'bundled' as const
  }
  const connectedProviderIds = new Set(
    credentials?.providers
      .filter((status) => status.configured)
      .map((status) => status.providerId) ?? []
  )
  const connectedDescriptors = providerCatalog.filter(
    (provider) => provider.id !== settings.agentProvider && connectedProviderIds.has(provider.id)
  )
  const featuredDescriptors = providerCatalog.filter(
    (provider) => provider.featured &&
      provider.id !== settings.agentProvider &&
      !connectedProviderIds.has(provider.id)
  )
  const moreDescriptors = providerCatalog.filter((provider) => (
    !provider.featured &&
    provider.id !== settings.agentProvider &&
    !connectedProviderIds.has(provider.id) &&
    (!providerSearch.trim() ||
      provider.name.toLowerCase().includes(providerSearch.trim().toLowerCase()) ||
      provider.id.toLowerCase().includes(providerSearch.trim().toLowerCase()))
  ))
  const confirmSessionEnd = (action: string, affectedProvider?: AgentProviderId): boolean => {
    if (!hasActiveSession) return true
    if (affectedProvider && affectedProvider !== activeSessionProvider) return true
    return window.confirm(`${action} will end the active coding-agent session. Continue?`)
  }
  const cancelAuthentication = async (): Promise<void> => {
    const attemptId = activeAttempt.current
    if (attemptId) await window.aladdeen.agent.cancelLogin(attemptId)
    activeAttempt.current = undefined
    setAuthEvent(undefined)
    setPromptValue('')
  }
  const selectProvider = async (provider: AgentProviderId): Promise<void> => {
    if (provider === settings.agentProvider) return
    if (!confirmSessionEnd('Changing providers')) return
    if (activeAttempt.current) await cancelAuthentication()
    onUpdate({
      agentProvider: provider,
      agentModelId: defaultModelForProvider(provider)
    })
  }
  const beginLogin = async (provider: AgentProviderId, authType: AgentAuthType): Promise<void> => {
    if (!confirmSessionEnd(authType === 'oauth' ? 'Signing in' : 'Connecting an API key')) return
    setCredentialError(undefined)
    const result = await window.aladdeen.agent.beginLogin({ providerId: provider, authType })
    if (!result.ok) {
      setCredentialError(result.error.message)
      return
    }
    activeAttempt.current = result.value.attemptId
    setAuthEvent({ type: 'started', attemptId: result.value.attemptId, provider })
  }
  const disconnect = async (provider: AgentProviderId): Promise<void> => {
    if (!confirmSessionEnd('Disconnecting this provider', provider)) return
    const result = await window.aladdeen.agent.disconnectProvider(provider)
    if (!result.ok) {
      setCredentialError(result.error.message)
      return
    }
    await refreshCredentials()
  }
  const refreshNativeProviderModels = async (provider: AgentProviderId): Promise<void> => {
    if (!confirmSessionEnd('Refreshing this model catalog', provider)) return
    setProviderOperation(`refresh:${provider}`)
    const result = await window.aladdeen.agent.refreshModelCatalog(provider)
    setProviderOperation(undefined)
    if (!result.ok) {
      setCredentialError(result.error.message)
      return
    }
    await Promise.all([refreshProviderData(), refreshModelCatalog()])
  }
  const removeLegacyProfile = async (profile: AgentLegacyProviderProfile): Promise<void> => {
    if (!window.confirm(
      `Disconnect and remove the legacy custom endpoint “${profile.name}” and its local credential?`
    )) return
    if (!confirmSessionEnd('Removing this legacy connection', profile.id)) return
    const result = await window.aladdeen.agent.removeLegacyProviderProfile(profile.id)
    if (!result.ok) {
      setCredentialError(result.error.message)
      return
    }
    await Promise.all([refreshCredentials(), refreshProviderData()])
  }

  const renderProviderCard = (
    provider: AgentProviderDescriptor,
    compactCard = false
  ): React.JSX.Element => {
    const status = credentials?.providers.find((item) => item.providerId === provider.id)
    const selected = settings.agentProvider === provider.id
    const originalDefinition = AGENT_PROVIDER_DEFINITIONS.find(
      (definition) => definition.id === provider.id
    )
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-surface p-3',
          selected && 'border-accent bg-accent-soft',
          compactCard && 'py-2.5'
        )}
        key={provider.id}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            disabled={!settings.agentEnabled}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed"
            aria-pressed={selected}
            aria-label={`Use ${provider.name}`}
            onClick={() => void selectProvider(provider.id)}
          >
            <span className="flex items-center gap-2 text-[12px] font-[650] text-foreground">
              {provider.name}
              {selected && <Check size={13} className="text-accent" aria-hidden="true" />}
            </span>
            <span className={cn(
              'mt-1 block text-[10px] text-foreground-muted',
              status?.reauthRequired && 'text-warning'
            )}>
              {status?.reauthRequired
                ? 'Authentication expired · reconnect required'
                : status?.configured
                  ? `Connected · ${status.authType === 'oauth' ? 'account' : 'API key'}`
                  : `${provider.modelCount.toLocaleString()} model${provider.modelCount === 1 ? '' : 's'}`}
            </span>
          </button>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {provider.oauthAvailable && (
              <button
                type="button"
                disabled={!settings.agentEnabled || credentials?.encryptionAvailable === false}
                className="h-7 rounded-md border border-transparent bg-accent px-2.5 text-[10px] font-semibold text-accent-contrast disabled:opacity-40"
                onClick={() => void beginLogin(provider.id, 'oauth')}
              >
                {status?.reauthRequired || status?.authType === 'oauth'
                  ? 'Reconnect'
                  : originalDefinition?.accountLabel ?? `Continue with ${provider.name}`}
              </button>
            )}
            {provider.apiKeyAvailable && (
              <button
                type="button"
                disabled={!settings.agentEnabled || credentials?.encryptionAvailable === false}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[10px] font-semibold text-foreground-soft hover:bg-surface-hover disabled:opacity-40"
                onClick={() => void beginLogin(provider.id, 'api_key')}
              >
                <KeyRound size={11} />
                {status?.authType === 'api_key' ? 'Replace key' : 'API key'}
              </button>
            )}
            {provider.catalogKind === 'dynamic' && (
              <button
                type="button"
                disabled={!settings.agentEnabled || !status?.configured ||
                  providerOperation === `refresh:${provider.id}`}
                className="h-7 rounded-md border border-border bg-surface px-2 text-[10px] font-semibold text-foreground-soft hover:bg-surface-hover disabled:opacity-40"
                onClick={() => void refreshNativeProviderModels(provider.id)}
              >
                {providerOperation === `refresh:${provider.id}` ? 'Refreshing…' : 'Refresh models'}
              </button>
            )}
            {status?.configured && (
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md border border-border bg-transparent text-foreground-muted hover:bg-danger-soft hover:text-danger"
                aria-label={`Disconnect ${provider.name}`}
                title={`Disconnect ${provider.name}`}
                onClick={() => void disconnect(provider.id)}
              >
                <LogOut size={13} />
              </button>
            )}
          </div>
        </div>
        {provider.id === 'anthropic' && (
          <p className="mt-2 mb-0 text-[9px] leading-[1.45] text-foreground-muted">
            Claude subscription use through pi is billed through Anthropic extra usage, not Claude Pro/Max plan limits.
          </p>
        )}
        {provider.id === 'openrouter' && (
          <p className="mt-2 mb-0 text-[9px] leading-[1.45] text-foreground-muted">
            OpenRouter may route requests through downstream providers. Your account routing and privacy controls are not changed by Aladdeen.
            {' '}<button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void window.aladdeen.system.openExternal('https://openrouter.ai/docs/guides/features/zdr')}
            >Review controls</button>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      <section className="py-4" aria-labelledby="agent-enable-label">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h3 className="m-0 text-[13px] font-[620] text-foreground" id="agent-enable-label">Enable coding agent</h3>
            <p className="mt-1 mb-0 max-w-[470px] text-[12px] leading-[1.5] text-foreground-muted">
              Off by default. When enabled, the agent sends prompts and referenced project files to your chosen AI provider; nothing else in Aladdeen goes online.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.agentEnabled}
            className={cn(
              'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-border-strong bg-surface-muted transition-colors',
              settings.agentEnabled && 'border-accent bg-accent'
            )}
            onClick={() => onUpdate({
              agentEnabled: !settings.agentEnabled,
              ...(!settings.agentEnabled ? { agentPanelCollapsed: false } : {})
            })}
          >
            <span className={cn(
              'absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-foreground-muted shadow-sm transition-transform',
              settings.agentEnabled && 'translate-x-5 bg-accent-contrast'
            )} />
            <span className="sr-only">{settings.agentEnabled ? 'Disable' : 'Enable'} coding agent</span>
          </button>
        </div>
      </section>

      {credentials && !credentials.encryptionAvailable && (
        <section className="py-4">
          <div className="flex gap-2.5 rounded-lg border border-warning/35 bg-[color-mix(in_oklab,var(--warning)_8%,var(--surface))] p-3 text-warning">
            <ShieldAlert size={16} className="mt-px shrink-0" />
            <div>
              <p className="m-0 text-[11px] font-bold">Secure credential storage is unavailable</p>
              <p className="mt-1 mb-0 text-[10px] leading-[1.5]">
                Aladdeen will not save an API key in plaintext. Enable macOS secure storage before using the agent.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="py-4" aria-labelledby="agent-provider-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="agent-provider-label">Provider connections</h3>
          <p className="mt-1 mb-3 text-[12px] leading-[1.45] text-foreground-muted">Connect an account or API key without exposing the saved credential.</p>
        </div>
        <div className="grid gap-3">
          <div>
            <p className="mt-0 mb-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-foreground-muted">
              Selected provider
            </p>
            {renderProviderCard(selectedDescriptor)}
          </div>
          {settings.agentEnabled && connectedDescriptors.length > 0 && (
            <div>
              <p className="mt-0 mb-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-foreground-muted">
                Connected providers
              </p>
              <div className="grid gap-2">
                {connectedDescriptors.map((provider) => renderProviderCard(provider, true))}
              </div>
            </div>
          )}
          {settings.agentEnabled && featuredDescriptors.length > 0 && (
            <div>
              <p className="mt-0 mb-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-foreground-muted">
                Featured providers
              </p>
              <div className="grid gap-2">
                {featuredDescriptors.map((provider) => renderProviderCard(provider, true))}
              </div>
            </div>
          )}
          {settings.agentEnabled && (
            <div>
              <p className="mt-0 mb-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-foreground-muted">
                More providers
              </p>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-muted" />
                <input
                  type="search"
                  value={providerSearch}
                  className="h-8 w-full rounded-md border border-border bg-surface pr-2.5 pl-8 text-[10px] text-foreground outline-none focus:border-accent"
                  placeholder="Search pi providers"
                  aria-label="Search providers"
                  onChange={(event) => setProviderSearch(event.currentTarget.value)}
                />
              </div>
              {providerSearch.trim() && (
                <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto">
                  {moreDescriptors.map((provider) => renderProviderCard(provider, true))}
                  {moreDescriptors.length === 0 && (
                    <p className="m-0 rounded-md border border-dashed border-border p-3 text-center text-[10px] text-foreground-muted">
                      No matching pi providers.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {legacyProfiles.length > 0 && (
            <div>
              <p className="mt-0 mb-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-foreground-muted">
                Legacy connections
              </p>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="mt-0 mb-2.5 text-[10px] leading-[1.5] text-foreground-muted">
                  Custom endpoints are no longer supported. Aladdeen kept these local records so
                  you can remove them explicitly.
                </p>
                <div className="grid gap-2">
                  {legacyProfiles.map((profile) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-elevated px-2.5 py-2"
                      key={profile.id}
                    >
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[11px] font-semibold text-foreground">
                          {profile.name}
                        </p>
                        <p className="mt-0.5 mb-0 text-[9px] text-foreground-muted">
                          Legacy custom endpoint
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[9px] font-semibold text-foreground-soft hover:bg-danger-soft hover:text-danger"
                        onClick={() => void removeLegacyProfile(profile)}
                      >
                        <Trash2 size={11} />
                        Disconnect and remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {!settings.agentEnabled && (
          <p className="mt-2 mb-0 text-[10px] text-foreground-muted">
            Enable the coding agent before connecting a subscription account.
          </p>
        )}
      </section>

      <section className="grid grid-cols-[minmax(110px,1fr)_minmax(190px,260px)] items-start gap-5 py-4 max-[560px]:grid-cols-1" aria-labelledby="agent-model-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="agent-model-label">Default model</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">
            Used when a new coding-agent session starts.
          </p>
        </div>
        <AgentModelPicker
          models={modelCatalog}
          provider={settings.agentProvider}
          value={settings.agentModelId}
          status={settings.agentEnabled ? modelCatalogStatus : 'disabled'}
          variant="settings"
          disabled={!settings.agentEnabled}
          error={modelCatalogError}
          onRetry={() => void refreshModelCatalog()}
          ariaLabel="Default agent model"
          onChange={(model) => onUpdate({ agentModelId: model.id })}
        />
      </section>

      {credentialError && (
        <section className="py-3">
          <p className="m-0 rounded-lg border border-danger/30 bg-danger-soft p-3 text-[10px] text-danger">
            {credentialError}
          </p>
        </section>
      )}

      <section className="grid grid-cols-[minmax(110px,1fr)_minmax(190px,260px)] items-center gap-5 py-4 max-[560px]:grid-cols-1" aria-labelledby="agent-thinking-label">
        <div>
          <h3 className="m-0 text-[13px] font-[620] text-foreground" id="agent-thinking-label">Thinking level</h3>
          <p className="mt-1 mb-0 text-[12px] leading-[1.45] text-foreground-muted">Higher levels can take longer and use more provider tokens.</p>
        </div>
        <select
          value={settings.agentThinkingLevel}
          aria-label="Default agent thinking level"
          className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-[12px] capitalize text-foreground outline-none focus:border-accent"
          onChange={(event) => onUpdate({ agentThinkingLevel: event.currentTarget.value as AgentThinkingLevel })}
        >
          {AGENT_THINKING_LEVELS.map((level) => <option value={level} key={level}>{level}</option>)}
        </select>
      </section>
      <AgentAuthenticationDialog
        event={authEvent}
        promptValue={promptValue}
        onPromptValueChange={setPromptValue}
        onClose={() => void cancelAuthentication()}
        onReopen={() => {
          if (authEvent) void window.aladdeen.agent.reopenLoginUrl(authEvent.attemptId)
        }}
        onSubmit={(value) => {
          if (authEvent?.type !== 'prompt') return
          const submitted = value
          setPromptValue('')
          void window.aladdeen.agent.respondLoginPrompt(
            authEvent.attemptId,
            authEvent.promptId,
            submitted
          ).then((result) => {
            if (!result.ok) setCredentialError(result.error.message)
          })
        }}
      />
    </div>
  )
}

function AgentAuthenticationDialog({
  event,
  promptValue,
  onPromptValueChange,
  onClose,
  onReopen,
  onSubmit
}: {
  event?: AgentAuthEvent
  promptValue: string
  onPromptValueChange(value: string): void
  onClose(): void
  onReopen(): void
  onSubmit(value: string): void
}): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (event?.type !== 'device-code' || !event.expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [event])
  const terminal = event?.type === 'completed' || event?.type === 'failed' || event?.type === 'cancelled'
  const secondsRemaining = event?.type === 'device-code' && event.expiresAt
    ? Math.max(0, Math.ceil((event.expiresAt - now) / 1_000))
    : undefined

  return (
    <Dialog.Root open={event !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content className={cn(dialogContentClasses, 'w-[min(calc(100vw-32px),430px)]')}>
          <div className={dialogIconClasses(event?.type === 'failed' ? 'destructive' : 'default')}>
            {terminal ? event?.type === 'completed' ? <Check size={19} /> : <ShieldAlert size={19} /> : <LoaderCircle size={19} className="animate-spin" />}
          </div>
          <Dialog.Title className={dialogTitleClasses}>
            {event?.type === 'completed'
              ? 'Provider connected'
              : event?.type === 'failed'
                ? 'Could not connect provider'
                : event?.type === 'cancelled'
                  ? 'Connection cancelled'
                  : 'Connect provider'}
          </Dialog.Title>
          <Dialog.Description className={dialogDescriptionClasses}>
            {event?.type === 'failed'
              ? event.message
              : event?.type === 'cancelled'
                ? 'No account connection was changed.'
                : event?.type === 'completed'
                  ? 'The encrypted provider credential is ready to use.'
                  : event?.type === 'progress'
                    ? event.message
                    : event?.type === 'prompt'
                      ? event.message
                      : event?.type === 'device-code'
                        ? 'Enter this one-time code in the provider page opened in your browser.'
                  : event?.type === 'started'
                    ? 'Preparing a secure provider connection…'
                    : 'Complete the secure sign-in flow.'}
          </Dialog.Description>

          {event?.type === 'device-code' && (
            <div className="mt-4 rounded-lg border border-border bg-surface p-3 text-center">
              <code className="text-[20px] font-bold tracking-[.15em] text-foreground">{event.userCode}</code>
              {secondsRemaining !== undefined && (
                <p className="mt-1 mb-0 text-[10px] text-foreground-muted">
                  Expires in {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
                </p>
              )}
            </div>
          )}

          {event?.type === 'prompt' && event.promptType === 'select' && (
            <div className="mt-4 grid gap-2">
              {event.options?.map((option) => (
                <button
                  type="button"
                  className="rounded-lg border border-border bg-surface p-3 text-left hover:border-accent hover:bg-accent-soft"
                  key={option.id}
                  onClick={() => onSubmit(option.id)}
                >
                  <span className="block text-[12px] font-semibold text-foreground">{option.label}</span>
                  {option.description && <span className="mt-1 block text-[10px] text-foreground-muted">{option.description}</span>}
                </button>
              ))}
            </div>
          )}

          {event?.type === 'prompt' && event.promptType !== 'select' && (
            <form
              className="mt-4"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault()
                onSubmit(promptValue)
              }}
            >
              <input
                type={event.promptType === 'secret' ? 'password' : 'text'}
                value={promptValue}
                autoComplete="off"
                autoFocus
                aria-label="Login response"
                placeholder={event.placeholder}
                className="h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-[12px] text-foreground outline-none focus:border-accent"
                onChange={(changeEvent) => onPromptValueChange(changeEvent.currentTarget.value)}
              />
              <button
                type="submit"
                disabled={!promptValue.trim()}
                className="mt-2 h-8 w-full rounded-md border border-transparent bg-accent px-3 text-[11px] font-semibold text-accent-contrast disabled:opacity-40"
              >
                Continue
              </button>
            </form>
          )}

          <div className={dialogActionsClasses}>
            {!terminal && (event?.type === 'browser-opened' || event?.type === 'device-code') && (
              <button type="button" className="h-8 rounded-md border border-border bg-surface px-3 text-[11px] text-foreground-soft" onClick={onReopen}>
                Open browser again
              </button>
            )}
            <Dialog.Close
              className={cn(
                'h-8 rounded-md border px-3 text-[11px] font-semibold',
                terminal
                  ? 'border-transparent bg-accent text-accent-contrast'
                  : 'border-border bg-surface text-foreground-soft'
              )}
            >
              {terminal ? 'Done' : 'Cancel'}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
            Aladdeen Research brings Markdown, HTML, Word, PDF, Excel, and PowerPoint documents into one offline-first workspace for reading, organizing, searching, writing, and presenting on M-series Apple silicon.
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
