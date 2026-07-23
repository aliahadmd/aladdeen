import { useState } from 'react'
import { FolderKanban, ShieldCheck } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

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
    <div className="onboarding-layer" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-backdrop" />
      <section className="onboarding-card">
        <div className="onboarding-symbol"><FolderKanban size={25} /></div>
        <p className="eyebrow">WELCOME TO FLUIDMD</p>
        <h1 id="onboarding-title">Create your first environment</h1>
        <p className="onboarding-copy">
          Keep project folders and independent Markdown files together without moving anything on disk.
        </p>
        {pending && <div className="pending-file-note">After setup, we’ll open <strong>{pending.name}</strong>.</div>}
        <label className="onboarding-field">
          <span>Environment name</span>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void submit()}
          />
        </label>
        <button className="primary-button onboarding-submit" disabled={!name.trim() || creating} onClick={() => void submit()}>
          {creating ? 'Creating…' : 'Create environment'}
        </button>
        <div className="privacy-note"><ShieldCheck size={14} /><span>Only file locations are remembered. Your content stays on disk.</span></div>
      </section>
    </div>
  )
}
