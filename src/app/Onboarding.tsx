import { ScriptFirstCard } from '@/features/parser'
import { PrivacyStatement } from '@/ui'
import { useAppStore } from '@/state/store'
import styles from './app.module.css'

/**
 * First-run landing card: the screenplay field is the hero. Privacy is a
 * one-line trust badge, and there is a single primary action — Parse Script.
 * Pressing it with no key hands off to the lightweight AI Configuration modal.
 */
export function Onboarding() {
  const completeOnboarding = useAppStore((s) => s.completeOnboarding)

  return (
    <div className={styles.onboarding} role="dialog" aria-label="Welcome to RecBay">
      <div className={styles.card}>
        <h1 className={styles.cardTitle}>RecBay</h1>
        <p className={styles.cardLead}>Turn screenplays into interactive shot lists.</p>

        <PrivacyStatement />

        <ScriptFirstCard onContinue={completeOnboarding} onParsed={completeOnboarding} />

        <button
          type="button"
          className={styles.skipLink}
          onClick={completeOnboarding}
          data-testid="onboarding-skip"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
