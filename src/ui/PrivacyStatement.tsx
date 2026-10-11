import styles from './ui.module.css'

interface PrivacyStatementProps {
  /** 'inline' renders the compact footnotes under parse results. */
  variant?: 'block' | 'inline'
}

/**
 * The product promise, shown in two places — onboarding (first open) and
 * Settings — so users never assume cloud storage:
 * "Your script and references are stored on your device."
 * Wording lives ONLY here — one file to change.
 */
export function PrivacyStatement({ variant = 'block' }: PrivacyStatementProps) {
  return (
    <p
      className={[styles.privacy, variant === 'inline' ? styles.privacyInline : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true">Lock</span>
      <span>
        <strong className={styles.privacyStrong}>
          Your script and references are stored on your device. No servers, no accounts, no access.
        </strong>
        RecBay has no backend. Your API key, script, and images never leave this browser except
        when your key's provider processes a parse request you trigger.
      </span>
    </p>
  )
}
