import { Button, PrivacyStatement } from '@/ui'
import { useAppStore } from '@/state/store'
import styles from './app.module.css'

/**
 * First-run screen. Privacy statement placement #1 — set expectations before
 * anything else happens, because every competing tool silently uses a cloud.
 */
export function Onboarding() {
  const setActiveModal = useAppStore((s) => s.setActiveModal)

  function start(target: 'parse' | 'settings'): void {
    useAppStore.getState().completeOnboarding()
    setActiveModal(target)
  }

  return (
    <div className={styles.onboarding} role="dialog" aria-label="Welcome to RecBay">
      <div className={styles.card}>
        <h1 className={styles.cardTitle}>RecBay — script to set</h1>
        <p className={styles.cardLead}>
          Paste a screenplay. The AI (with <em>your</em> key) builds the 70% shot skeleton. You
          shape it on the spatial canvas, then carry the checklist on set.
        </p>

        <PrivacyStatement />

        <div className={styles.steps}>
          <span className={styles.step}>
            <span className={styles.stepNo}>1.</span> Add your BYOK API key (Google, OpenAI or
            Anthropic) — it stays on this device.
          </span>
          <span className={styles.step}>
            <span className={styles.stepNo}>2.</span> Paste your script and parse it into shots.
          </span>
          <span className={styles.step}>
            <span className={styles.stepNo}>3.</span> Drag cards on desktop; tick them off in the
            mobile checklist — both read and write the same data on this device.
          </span>
        </div>

        <div className={styles.cardActions}>
          <Button variant="primary" onClick={() => start('settings')}>
            Add my API key
          </Button>
          <Button onClick={() => start('parse')}>Paste a script first</Button>
        </div>
      </div>
    </div>
  )
}
