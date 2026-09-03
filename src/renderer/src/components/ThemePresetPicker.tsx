import { Check } from 'lucide-react'
import type { ThemePreset } from '@shared/contracts'
import { cn } from '@renderer/lib/cn'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { themePresetOptions } from '@renderer/store/app-store'

interface ThemePresetPickerProps {
  value: ThemePreset
  onSelect(preset: ThemePreset): void
}

export function ThemePresetPicker({ value, onSelect }: ThemePresetPickerProps): React.JSX.Element {
  const dark = useEffectiveDarkMode()

  return (
    <div className="grid grid-cols-1 gap-2 min-[620px]:grid-cols-2" role="group" aria-label="Theme preset">
      {themePresetOptions.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={`${option.label} theme`}
            onClick={() => onSelect(option.value)}
            className={cn(
              'grid gap-[6px] rounded-xl border p-[6px] pb-[10px] text-left transition-colors',
              active
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-surface hover:border-border-strong hover:bg-surface-hover'
            )}
          >
            <div aria-hidden className={cn('theme-preset-preview', dark && 'dark')} data-theme-preset={option.value}>
              <div className="theme-preset-preview-sidebar" />
              <div className="theme-preset-preview-body">
                <span className="theme-preset-preview-bar theme-preset-preview-bar-strong" />
                <span className="theme-preset-preview-bar" />
                <span className="theme-preset-preview-pill" />
              </div>
            </div>
            <span className="grid gap-[2px] px-1">
              <span className="flex items-center gap-[6px] text-[13px] font-[620] text-foreground">
                {option.label}
                {active && <Check size={13} className="text-accent" aria-hidden />}
              </span>
              <span className="text-[12px] leading-[1.4] text-foreground-muted">{option.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
