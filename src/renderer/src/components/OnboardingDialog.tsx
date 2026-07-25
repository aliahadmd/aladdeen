import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { buttonClasses, eyebrowClasses, privacyNoteClasses } from '@renderer/lib/ui-styles'
import { useAppStore } from '@renderer/store/app-store'
import { BrandMark } from './BrandMark'

export function OnboardingDialog(): React.JSX.Element {
  const createEnvironment = useAppStore((state) => state.createEnvironment)
  const pending = useAppStore((state) => state.pendingOpenRequest)
  const [name, setName] = useState('Personal')
  const [creating, setCreating] = useState(false)

  const submit = async (): Promise<void> => {
    if (!name.trim() || creating) return
    setCreating(true)
    const created = await createEnvironment(name.trim())
    if (!created) setCreating(false)
  }

  return (
    <div className="fixed inset-0 z-[300] grid place-items-center" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-backdrop fixed inset-0 z-[300]" />
      <section className="relative z-[301] w-[min(calc(100vw-32px),440px)] translate-y-0 scale-100 rounded-[17px] border border-border bg-surface-elevated p-[31px] opacity-100 shadow-[0_28px_90px_rgb(0_0_0/.22),0_4px_18px_rgb(0_0_0/.08)] [transition:transform_210ms_var(--ease-out),opacity_180ms_ease]">
        <BrandMark
          className="mb-[21px] h-12 w-12 drop-shadow-[0_10px_20px_rgb(0_0_0/.16)]"
          title="Aladdeen"
        />
        <p className={eyebrowClasses}>WELCOME TO ALADDEEN RESEARCH</p>
        <h1
          id="onboarding-title"
          className="m-0 text-[25px] leading-[1.12] font-[690] tracking-[-.035em]"
        >
          Create your first environment
        </h1>
        <p className="mt-[11px] mb-5 text-[12px] leading-[1.55] text-foreground-soft">
          Bring project folders and independent research documents together without moving anything on disk.
        </p>
        {pending && (
          <div className="-mt-1 mb-[17px] rounded-[8px] border border-accent-muted bg-accent-soft px-[10px] py-[9px] text-[10px] text-foreground-soft">
            After setup, we’ll open <strong>{pending.name}</strong>.
          </div>
        )}
        <label>
          <span className="mb-[6px] block text-[10px] font-[650] text-foreground-soft">
            Environment name
          </span>
          <input
            className="h-[38px] w-full select-text rounded-[8px] border border-border-strong bg-surface px-[11px] text-foreground focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:!outline-none"
            autoFocus
            value={name}
            maxLength={60}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void submit()}
          />
        </label>
        <button
          className={buttonClasses({ className: 'mt-[11px] h-[38px] w-full' })}
          disabled={!name.trim() || creating}
          onClick={() => void submit()}
        >
          {creating ? 'Creating…' : 'Create environment'}
        </button>
        <div className={cn(privacyNoteClasses, 'mt-[18px] flex justify-center text-center')}>
          <ShieldCheck size={14} />
          <span>Only file locations are remembered. Your content stays on disk.</span>
        </div>
      </section>
    </div>
  )
}
