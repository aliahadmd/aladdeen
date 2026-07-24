import * as Dialog from '@radix-ui/react-dialog'
import { Check, Command, Palette, Settings2, X } from 'lucide-react'
import packageMetadata from '../../../../package.json'
import { accentOptions, themeOptions, useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content settings-dialog">
          <header className="settings-dialog-header">
            <div className="dialog-icon settings-dialog-icon"><Settings2 size={18} /></div>
            <div>
              <Dialog.Title className="dialog-title">Settings</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Personalize Aladdeen without changing your Markdown files.
              </Dialog.Description>
            </div>
            <Dialog.Close className="settings-close" aria-label="Close settings"><X size={16} /></Dialog.Close>
          </header>

          <div className="settings-sections">
            <section className="settings-section" aria-labelledby="appearance-settings-heading">
              <div className="settings-section-heading">
                <Palette size={15} />
                <h3 id="appearance-settings-heading">Appearance</h3>
              </div>
              <div className="settings-field">
                <span className="settings-label">Theme</span>
                <div className="settings-segmented" role="group" aria-label="Theme">
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={settings.theme === option.value ? 'is-selected' : ''}
                      onClick={() => void updateSettings({ theme: option.value })}
                      aria-pressed={settings.theme === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field">
                <span className="settings-label">Accent</span>
                <div className="settings-accent-grid" role="group" aria-label="Accent color">
                  {accentOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`settings-accent-option ${settings.accent === option.value ? 'is-selected' : ''}`}
                      onClick={() => void updateSettings({ accent: option.value })}
                      aria-pressed={settings.accent === option.value}
                    >
                      <span className={`settings-accent-dot accent-${option.value}`}>
                        {settings.accent === option.value && <Check size={11} />}
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="settings-section" aria-labelledby="shortcut-settings-heading">
              <div className="settings-section-heading">
                <Command size={15} />
                <h3 id="shortcut-settings-heading">Keyboard shortcuts</h3>
              </div>
              <dl className="settings-shortcuts">
                <div><dt>Quick open</dt><dd>⌘/Ctrl P</dd></div>
                <div><dt>Search contents</dt><dd>⌘/Ctrl ⇧ F</dd></div>
                <div><dt>Open file</dt><dd>⌘/Ctrl O</dd></div>
                <div><dt>Add project</dt><dd>⌘/Ctrl ⇧ O</dd></div>
                <div><dt>Edit or preview</dt><dd>⌘/Ctrl E</dd></div>
                <div><dt>Save now</dt><dd>⌘/Ctrl S</dd></div>
              </dl>
            </section>

            <section className="settings-about" aria-label="About Aladdeen">
              <BrandMark className="settings-about-logo" />
              <div>
                <strong>Aladdeen {packageMetadata.version}</strong>
                <span>Offline-first Markdown workspace. Your documents stay at their original disk locations.</span>
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
