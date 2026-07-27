import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Command,
  FileSearch2,
  Folder,
  FolderKanban,
  HardDrive,
  ListTree,
  LockKeyhole,
  Search,
  ShieldCheck,
  WifiOff,
  X
} from 'lucide-react'
import type { DocumentKind } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { buttonClasses } from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'
import { DocumentKindIcon } from './DocumentKindIcon'

export type OnboardingMode = 'first-run' | 'setup' | 'replay'
type OnboardingPalette = 'lavender' | 'sage' | 'amber' | 'rose' | 'neutral'

interface OnboardingExperienceProps {
  mode: OnboardingMode
  onClose?(): void
}

interface OnboardingStep {
  id: string
  title: string
  description: string
  palette: OnboardingPalette
  Illustration(): React.JSX.Element
}

const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'local',
    title: 'Research stays on your Mac',
    description: 'Aladdeen reads and edits documents where they already live. No account, cloud, conversion, or network connection is required.',
    palette: 'lavender',
    Illustration: LocalResearchIllustration
  },
  {
    id: 'organization',
    title: 'Organize without moving anything',
    description: 'Environments bring project folders and individual files together. You choose which document types each project discovers.',
    palette: 'sage',
    Illustration: OrganizationIllustration
  },
  {
    id: 'formats',
    title: 'A workspace for every format',
    description: 'Write Markdown and HTML, work with Word documents, and read or annotate PDFs using tools designed for each format.',
    palette: 'amber',
    Illustration: FormatIllustration
  },
  {
    id: 'search',
    title: 'Find the passage, not just the file',
    description: 'Quick Open finds documents by name. Global Search, outlines, and source navigation take you directly to the passage you need.',
    palette: 'rose',
    Illustration: SearchIllustration
  }
]

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function OnboardingExperience({ mode, onClose }: OnboardingExperienceProps): React.JSX.Element {
  const createEnvironment = useAppStore((state) => state.createEnvironment)
  const pending = useAppStore((state) => state.pendingOpenRequest)
  const [stepIndex, setStepIndex] = useState(0)
  const [showSetup, setShowSetup] = useState(mode === 'setup')
  const [name, setName] = useState('Personal')
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const environmentInputRef = useRef<HTMLInputElement>(null)
  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0]!
  const palette: OnboardingPalette = showSetup ? 'neutral' : step.palette
  const isReplay = mode === 'replay'
  const canReturnToTutorial = mode === 'first-run' && showSetup

  const progressText = useMemo(
    () => showSetup ? 'Environment setup' : `Step ${stepIndex + 1} of ${ONBOARDING_STEPS.length}`,
    [showSetup, stepIndex]
  )

  useEffect(() => {
    const target = showSetup ? environmentInputRef.current : headingRef.current
    requestAnimationFrame(() => target?.focus())
  }, [showSetup, stepIndex])

  const goBack = (): void => {
    if (creating) return
    if (showSetup && canReturnToTutorial) {
      setShowSetup(false)
      setStepIndex(ONBOARDING_STEPS.length - 1)
      return
    }
    setStepIndex((current) => Math.max(0, current - 1))
  }

  const goForward = (): void => {
    if (stepIndex < ONBOARDING_STEPS.length - 1) {
      setStepIndex((current) => current + 1)
      return
    }
    if (isReplay) onClose?.()
    else setShowSetup(true)
  }

  const submit = async (): Promise<void> => {
    const environmentName = name.trim()
    if (!environmentName || creating) return
    setCreating(true)
    const created = await createEnvironment(environmentName)
    if (!created) setCreating(false)
  }

  const trapReplayFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!isReplay || event.key !== 'Tab') return
    const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0)
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    trapReplayFocus(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && isReplay) {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
      return
    }
    if (showSetup || event.target instanceof HTMLInputElement) return
    if (event.key === 'ArrowLeft' && stepIndex > 0) {
      event.preventDefault()
      goBack()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      goForward()
    }
  }

  return (
    <div
      ref={rootRef}
      className="onboarding-experience fixed inset-0 z-[400] grid min-h-0 grid-rows-[58px_minmax(0,1fr)_68px] overflow-hidden text-foreground max-[640px]:grid-rows-[50px_minmax(0,1fr)_60px]"
      data-palette={palette}
      role={isReplay ? 'dialog' : undefined}
      aria-modal={isReplay ? true : undefined}
      aria-labelledby="onboarding-page-title"
      onKeyDownCapture={handleKeyDown}
    >
      <header className="relative z-[2] grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 max-[640px]:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="h-8 w-8 shrink-0" title="Aladdeen" />
          <span className="truncate text-[12px] font-[680] tracking-[-.01em] max-[520px]:hidden">Aladdeen Research</span>
        </div>

        <div className="flex min-w-[118px] justify-center" aria-label={progressText}>
          {showSetup ? (
            <span className="text-[12px] font-[620] text-foreground-soft">Environment setup</span>
          ) : (
            <ol className="flex list-none items-center gap-[7px] p-0" aria-hidden="true">
              {ONBOARDING_STEPS.map((candidate, index) => (
                <li
                  key={candidate.id}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full bg-[color-mix(in_oklab,var(--text)_20%,transparent)] transition-[width,background-color] duration-180',
                    index === stepIndex && 'w-5 bg-foreground',
                    index < stepIndex && 'bg-[color-mix(in_oklab,var(--text)_48%,transparent)]'
                  )}
                />
              ))}
            </ol>
          )}
        </div>

        <div className="flex justify-end">
          {!showSetup && mode === 'first-run' && (
            <button
              type="button"
              className="h-8 rounded-md border-0 bg-transparent px-2.5 text-[12px] font-[570] text-foreground-soft transition-colors hover:bg-[color-mix(in_oklab,var(--onboarding-panel)_70%,transparent)] hover:text-foreground"
              onClick={() => setShowSetup(true)}
            >
              Skip tutorial
            </button>
          )}
          {isReplay && (
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent p-0 text-foreground-soft transition-colors hover:bg-[color-mix(in_oklab,var(--onboarding-panel)_70%,transparent)] hover:text-foreground"
              aria-label="Close tutorial"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          )}
        </div>
      </header>

      <main className="onboarding-scroll relative z-[1] min-h-0 overflow-y-auto px-5 [scrollbar-gutter:stable] max-[640px]:px-3">
        <p className="sr-only" role="status" aria-live="polite">{progressText}</p>
        {showSetup ? (
          <section className="onboarding-step mx-auto flex min-h-full w-full max-w-[560px] flex-col items-center justify-center py-5 text-center max-[640px]:py-3">
            <BrandMark className="mb-4 h-12 w-12" title="Aladdeen" />
            <h1
              id="onboarding-page-title"
              ref={headingRef}
              className="m-0 text-[clamp(25px,4vw,38px)] leading-[1.08] font-[700] tracking-[-.04em] outline-none"
              tabIndex={-1}
            >
              Create your first environment
            </h1>
            <p className="mt-3 mb-5 max-w-[470px] text-[13px] leading-[1.6] text-foreground-soft max-[640px]:mb-3">
              An Environment brings project folders and independent documents together without moving anything on disk.
            </p>
            <div className="onboarding-setup-card w-full max-w-[430px] rounded-[14px] border border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] p-5 text-left shadow-[0_18px_55px_rgb(25_24_38/.08)] backdrop-blur-[16px] max-[640px]:p-4">
              {pending && (
                <div className="mb-4 rounded-lg border border-accent-muted bg-accent-soft px-3 py-2.5 text-[12px] leading-[1.45] text-foreground-soft">
                  After setup, we’ll open <strong className="text-foreground">{pending.name}</strong>.
                </div>
              )}
              <label htmlFor="onboarding-environment-name" className="mb-1.5 block text-[12px] font-[650] text-foreground-soft">
                Environment name
              </label>
              <input
                ref={environmentInputRef}
                id="onboarding-environment-name"
                className="h-10 w-full select-text rounded-lg border border-border-strong bg-surface-elevated px-3 text-[13px] text-foreground outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                value={name}
                maxLength={60}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void submit()}
              />
              <button
                type="button"
                className={buttonClasses({ size: 'large', className: 'mt-3 w-full justify-center text-[12px]' })}
                disabled={!name.trim() || creating}
                onClick={() => void submit()}
              >
                {creating ? 'Creating…' : 'Create environment'}
              </button>
              <div className="mt-4 flex items-start justify-center gap-1.5 text-center text-[12px] leading-[1.45] text-foreground-muted">
                <ShieldCheck className="mt-px shrink-0" size={15} />
                <span>Only file locations are remembered. Your content stays on disk.</span>
              </div>
            </div>
          </section>
        ) : (
          <section
            key={step.id}
            className="onboarding-step mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center py-5 text-center max-[640px]:py-3"
          >
            <h1
              id="onboarding-page-title"
              ref={headingRef}
              className="m-0 max-w-[680px] text-[clamp(27px,4.2vw,43px)] leading-[1.05] font-[700] tracking-[-.045em] outline-none max-[640px]:text-[26px]"
              tabIndex={-1}
            >
              {step.title}
            </h1>
            <p className="mt-3 mb-5 max-w-[610px] text-[13px] leading-[1.6] text-foreground-soft max-[640px]:mt-2 max-[640px]:mb-3">
              {step.description}
            </p>
            <div className="onboarding-illustration w-full" aria-hidden="true">
              <step.Illustration />
            </div>
          </section>
        )}
      </main>

      <footer className="relative z-[2] grid grid-cols-[1fr_auto_1fr] items-center border-t border-[color-mix(in_oklab,var(--onboarding-border)_72%,transparent)] px-5 max-[640px]:px-3">
        <div>
          {(stepIndex > 0 || canReturnToTutorial) && (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-md border-0 bg-transparent px-2.5 text-[12px] font-[570] text-foreground-soft transition-colors hover:bg-[color-mix(in_oklab,var(--onboarding-panel)_70%,transparent)] hover:text-foreground"
              onClick={goBack}
            >
              <ChevronLeft size={15} /> Back
            </button>
          )}
        </div>
        <span className="text-[12px] text-foreground-muted max-[520px]:hidden">
          {showSetup ? 'Files remain in place' : progressText}
        </span>
        <div className="flex justify-end">
          {!showSetup && (
            <button
              type="button"
              className={buttonClasses({ className: 'min-w-[94px] justify-center text-[12px]' })}
              onClick={goForward}
            >
              {isReplay && stepIndex === ONBOARDING_STEPS.length - 1 ? 'Done' : 'Continue'}
              {!(isReplay && stepIndex === ONBOARDING_STEPS.length - 1) && <ChevronRight size={15} />}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

function LocalResearchIllustration(): React.JSX.Element {
  return (
    <div className="onboarding-visual-card mx-auto grid max-w-[610px] grid-cols-[1fr_auto_1fr] items-center gap-5 rounded-[16px] border border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] p-6 shadow-[0_20px_65px_rgb(25_24_38/.08)] backdrop-blur-[16px] max-[640px]:gap-3 max-[640px]:p-4">
      <div className="grid gap-2 text-left">
        {['field-notes.md', 'interviews.docx', 'sources.pdf'].map((file, index) => (
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--onboarding-border)] bg-[color-mix(in_oklab,var(--onboarding-panel)_78%,var(--surface-elevated))] px-3" key={file}>
            <DocumentKindIcon kind={(['markdown', 'docx', 'pdf'] as DocumentKind[])[index]} size={15} className="text-foreground-muted" />
            <span className="truncate text-[12px] font-[580]">{file}</span>
          </div>
        ))}
      </div>
      <div className="grid h-14 w-14 place-items-center rounded-[15px] bg-foreground text-[var(--onboarding-bg)] shadow-[0_8px_22px_rgb(25_24_38/.14)]">
        <HardDrive size={25} />
      </div>
      <div className="grid gap-2 text-left">
        <StatusRow icon={LockKeyhole} label="Original locations" />
        <StatusRow icon={WifiOff} label="Works offline" />
        <StatusRow icon={ShieldCheck} label="No account" />
      </div>
    </div>
  )
}

function OrganizationIllustration(): React.JSX.Element {
  return (
    <div className="onboarding-visual-card mx-auto grid max-w-[630px] grid-cols-[210px_minmax(0,1fr)] overflow-hidden rounded-[16px] border border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] text-left shadow-[0_20px_65px_rgb(25_24_38/.08)] backdrop-blur-[16px] max-[640px]:grid-cols-[155px_minmax(0,1fr)]">
      <div className="border-r border-[var(--onboarding-border)] p-4 max-[640px]:p-3">
        <div className="mb-4 text-[12px] font-[680]">Personal</div>
        <p className="mb-2 text-[12px] font-[620] text-foreground-muted">Projects</p>
        <div className="grid gap-1.5">
          <MiniTreeRow icon={FolderKanban} label="Field research" active />
          <MiniTreeRow icon={Folder} label="Interviews" inset />
          <MiniTreeRow icon={Folder} label="Sources" inset />
        </div>
        <p className="mt-4 mb-2 text-[12px] font-[620] text-foreground-muted">Individual files</p>
        <MiniTreeRow icon={FileSearch2} label="Reading list" />
      </div>
      <div className="p-5 max-[640px]:p-3">
        <span className="text-[12px] font-[650] text-foreground-soft">Document types</span>
        <div className="mt-3 grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
          <TypePolicy kind="markdown" label="Markdown" enabled />
          <TypePolicy kind="docx" label="Word" enabled />
          <TypePolicy kind="pdf" label="PDF" />
          <TypePolicy kind="html" label="HTML" />
        </div>
        <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-foreground-muted max-[520px]:hidden">
          Project filters change discovery, never the files on disk.
        </p>
      </div>
    </div>
  )
}

function FormatIllustration(): React.JSX.Element {
  const formats: Array<{ kind: DocumentKind; label: string; detail: string }> = [
    { kind: 'markdown', label: 'Markdown', detail: 'Source + preview' },
    { kind: 'html', label: 'HTML', detail: 'Live sandbox' },
    { kind: 'docx', label: 'Word', detail: 'Rich document editor' },
    { kind: 'pdf', label: 'PDF', detail: 'Read + annotate' }
  ]
  return (
    <div className="mx-auto grid max-w-[660px] grid-cols-4 gap-2.5 max-[640px]:grid-cols-2">
      {formats.map((format) => (
        <div className="onboarding-format-card rounded-[14px] border border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] p-4 text-left shadow-[0_14px_38px_rgb(25_24_38/.06)] backdrop-blur-[16px] max-[640px]:p-3" key={format.kind}>
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[color-mix(in_oklab,var(--text)_10%,transparent)] text-foreground">
            <DocumentKindIcon kind={format.kind} size={18} />
          </span>
          <strong className="mt-4 block text-[13px] font-[680] max-[640px]:mt-2">{format.label}</strong>
          <span className="mt-1 block text-[12px] leading-[1.4] text-foreground-muted">{format.detail}</span>
        </div>
      ))}
    </div>
  )
}

function SearchIllustration(): React.JSX.Element {
  return (
    <div className="onboarding-visual-card mx-auto grid max-w-[650px] grid-cols-[minmax(0,1fr)_150px] overflow-hidden rounded-[16px] border border-[var(--onboarding-border)] bg-[var(--onboarding-panel)] text-left shadow-[0_20px_65px_rgb(25_24_38/.08)] backdrop-blur-[16px] max-[640px]:grid-cols-[minmax(0,1fr)_112px]">
      <div className="p-5 max-[640px]:p-3">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-[var(--onboarding-border)] bg-[color-mix(in_oklab,var(--onboarding-panel)_75%,var(--surface-elevated))] px-3">
          <Search size={16} className="text-foreground-muted" />
          <span className="flex-1 text-[12px] font-[580]">migration evidence</span>
          <kbd className="flex items-center gap-1 rounded border border-[var(--onboarding-border)] px-1.5 py-0.5 text-[11px] text-foreground-muted"><Command size={10} />⇧F</kbd>
        </div>
        <div className="mt-3 grid gap-2">
          <SearchResult title="Field notes.md" location="Interviews › Session 04" excerpt="…the migration evidence changed after the second review…" active />
          <SearchResult title="Research brief.docx" location="Reports" excerpt="…compare the migration evidence with the primary source…" />
        </div>
      </div>
      <div className="border-l border-[var(--onboarding-border)] p-4 max-[640px]:p-3">
        <div className="mb-3 flex items-center gap-1.5 text-[12px] font-[650]"><ListTree size={14} /> Outline</div>
        {['Question', 'Evidence', 'Findings', 'Next steps'].map((heading, index) => (
          <div className={cn('mb-2 truncate text-[12px] text-foreground-muted', index === 1 && 'font-[650] text-foreground')} key={heading}>{heading}</div>
        ))}
      </div>
    </div>
  )
}

function StatusRow({ icon: Icon, label }: { icon: typeof ShieldCheck; label: string }): React.JSX.Element {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-[12px] font-[580] text-foreground-soft">
      <Icon size={16} className="shrink-0 text-foreground-muted" />
      <span>{label}</span>
    </div>
  )
}

function MiniTreeRow({ icon: Icon, label, active, inset }: { icon: typeof Folder; label: string; active?: boolean; inset?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] text-foreground-soft', active && 'bg-[color-mix(in_oklab,var(--text)_9%,transparent)] font-[620] text-foreground', inset && 'ml-3')}>
      <Icon size={14} className="shrink-0 text-foreground-muted" />
      <span className="truncate">{label}</span>
    </div>
  )
}

function TypePolicy({ kind, label, enabled }: { kind: DocumentKind; label: string; enabled?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-12 items-center gap-2 rounded-lg border border-[var(--onboarding-border)] px-3', enabled && 'bg-[color-mix(in_oklab,var(--text)_8%,transparent)]')}>
      <DocumentKindIcon kind={kind} size={15} className="text-foreground-muted" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-[620]">{label}</span>
      <span className={cn('h-3.5 w-3.5 rounded-[4px] border border-[var(--onboarding-border)]', enabled && 'border-foreground bg-foreground shadow-[inset_0_0_0_3px_var(--onboarding-panel)]')} />
    </div>
  )
}

function SearchResult({ title, location, excerpt, active }: { title: string; location: string; excerpt: string; active?: boolean }): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border border-transparent px-3 py-2.5', active && 'border-[var(--onboarding-border)] bg-[color-mix(in_oklab,var(--text)_8%,transparent)]')}>
      <div className="flex items-baseline justify-between gap-3">
        <strong className="truncate text-[12px] font-[650]">{title}</strong>
        <span className="shrink-0 text-[11px] text-foreground-muted max-[520px]:hidden">{location}</span>
      </div>
      <p className="mt-1 mb-0 truncate text-[12px] text-foreground-soft">{excerpt}</p>
    </div>
  )
}
