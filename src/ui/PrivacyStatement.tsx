import styles from './ui.module.css'

/**
 * The whole product promise in one line. Wording lives ONLY here so the trust
 * badge stays consistent everywhere it appears.
 */
export function PrivacyStatement() {
  return (
    <p className={styles.trustBadge}>
      <span aria-hidden="true">🔒</span>
      <span>100% Private &amp; Local. No servers or accounts.</span>
    </p>
  )
}
