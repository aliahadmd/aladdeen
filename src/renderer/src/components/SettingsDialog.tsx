import * as Dialog from '@radix-ui/react-dialog'
import { Check, Command, Palette, Settings2, X } from 'lucide-react'
import packageMetadata from '../../../../package.json'
import type { Accent } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import {
  dialogContentClasses,
  dialogDescriptionClasses,
  dialogIconClasses,
  dialogOverlayClasses,
  dialogTitleClasses
} from '@renderer/lib/ui-styles'
import { accentOptions, themeOptions, useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

const ACCENT_DOT_CLASSES: Record<Accent, string> = {
  indigo: 'bg-[#5b55e7]',
  blue: 'bg-[#2878d4]',
  emerald: 'bg-[#198a64]',
  amber: 'bg-[#b46b0b]',
  rose: 'bg-[#c74268]'
}

const shortcutRowClasses =
  'flex min-h-[33px] items-center justify-between gap-4 bg-surface px-[10px]'
const shortcutNameClasses = 'text-[10px] text-foreground-soft'
const shortcutKeyClasses = 'm-0 font-mono text-[9px] text-foreground-muted'

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content className={cn(dialogContentClasses, 'w-[min(calc(100vw-32px),560px)] max-h-[min(720px,calc(100vh-32px))] overflow-auto p-0')}>
          <header className="sticky top-0 z-[1] grid grid-cols-[36px_minmax(0,1fr)_30px] items-start gap-[11px] border-b border-border bg-[color-mix(in_oklab,var(--surface-elevated)_96%,transparent)] px-5 pt-5 pb-[17px] backdrop-blur-[12px]">
            <div className={cn(dialogIconClasses(), 'm-0')}><Settings2 size={18} /></div>
            <div>
              <Dialog.Title className={dialogTitleClasses}>Settings</Dialog.Title>
              <Dialog.Description className={cn(dialogDescriptionClasses, 'mt-1')}>
                Personalize Aladdeen without changing your Markdown files.
              </Dialog.Description>
            </div>
            <Dialog.Close className="grid h-[30px] w-[30px] place-items-center rounded-[7px] border-0 bg-transparent p-0 text-foreground-muted transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground" aria-label="Close settings"><X size={16} /></Dialog.Close>
          </header>

          <div className="grid gap-[18px] px-5 pt-[19px] pb-5">
            <section className="grid gap-[13px]" aria-labelledby="appearance-settings-heading">
              <div className="flex items-center gap-[7px] text-foreground-soft">
                <Palette size={15} />
                <h3 className="m-0 text-[12px] font-[680] text-foreground" id="appearance-settings-heading">Appearance</h3>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-3 max-[700px]:grid-cols-1 max-[700px]:gap-[6px]">
                <span className="pt-[7px] text-[10px] font-[620] text-foreground-muted max-[700px]:pt-0">Theme</span>
                <div className="grid grid-cols-3 gap-[3px] rounded-lg border border-border bg-surface p-[3px]" role="group" aria-label="Theme">
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        'h-7 rounded-md border-0 bg-transparent text-[10px] font-semibold text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                        settings.theme === option.value && 'bg-surface-elevated text-foreground shadow-[0_1px_4px_rgb(0_0_0/.1)] hover:bg-surface-elevated'
                      )}
                      onClick={() => void updateSettings({ theme: option.value })}
                      aria-pressed={settings.theme === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-3 max-[700px]:grid-cols-1 max-[700px]:gap-[6px]">
                <span className="pt-[7px] text-[10px] font-[620] text-foreground-muted max-[700px]:pt-0">Accent</span>
                <div className="grid grid-cols-5 gap-[5px] max-[700px]:grid-cols-[repeat(5,minmax(44px,1fr))] max-[700px]:overflow-x-auto" role="group" aria-label="Accent color">
                  {accentOptions.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        'grid min-w-0 justify-items-center gap-[5px] rounded-lg border border-transparent bg-transparent px-[3px] pt-[7px] pb-[5px] text-[9px] text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                        settings.accent === option.value && 'border-accent-muted bg-accent-soft text-foreground hover:bg-accent-soft'
                      )}
                      onClick={() => void updateSettings({ accent: option.value })}
                      aria-pressed={settings.accent === option.value}
                    >
                      <span className={cn('grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-[rgb(255_255_255/.8)] text-white shadow-[0_0_0_1px_rgb(0_0_0/.12)]', ACCENT_DOT_CLASSES[option.value])}>
                        {settings.accent === option.value && <Check size={11} />}
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="grid gap-[13px] border-t border-border pt-[18px]" aria-labelledby="shortcut-settings-heading">
              <div className="flex items-center gap-[7px] text-foreground-soft">
                <Command size={15} />
                <h3 className="m-0 text-[12px] font-[680] text-foreground" id="shortcut-settings-heading">Keyboard shortcuts</h3>
              </div>
              <dl className="m-0 grid gap-px overflow-hidden rounded-lg border border-border bg-border">
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Quick open</dt><dd className={shortcutKeyClasses}>⌘/Ctrl P</dd></div>
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Search contents</dt><dd className={shortcutKeyClasses}>⌘/Ctrl ⇧ F</dd></div>
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Open file</dt><dd className={shortcutKeyClasses}>⌘/Ctrl O</dd></div>
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Add project</dt><dd className={shortcutKeyClasses}>⌘/Ctrl ⇧ O</dd></div>
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Edit or preview</dt><dd className={shortcutKeyClasses}>⌘/Ctrl E</dd></div>
                <div className={shortcutRowClasses}><dt className={shortcutNameClasses}>Save now</dt><dd className={shortcutKeyClasses}>⌘/Ctrl S</dd></div>
              </dl>
            </section>

            <section className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 rounded-lg bg-surface-muted p-[11px] text-foreground-muted" aria-label="About Aladdeen">
              <BrandMark className="h-[18px] w-[18px]" />
              <div>
                <strong className="mb-0.5 block text-[10px] text-foreground-soft">Aladdeen {packageMetadata.version}</strong>
                <span className="block text-[9px] leading-[1.45]">Offline-first Markdown workspace. Your documents stay at their original disk locations.</span>
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
