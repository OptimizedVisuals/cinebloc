import { useCallback } from 'react'
import { flushPersistence } from '@/state/persistence'
import { goHome } from '@/state/projectActions'
import { useAppStore } from '@/state/store'
import styles from './sidebar.module.css'

/**
 * PC / big-screen navigation strip (spec 2): an ultra-slim fixed left rail
 * of icons so the infinite canvas keeps the whole viewport.
 *
 * - Icons only by default; hovering (or keyboard-focusing) an icon floats
 *   its full label out to the right as an absolutely positioned tooltip —
 *   the strip and the canvas never reflow.
 * - Lock sits alone at the bottom of the rail, out of the working area.
 * - Mobile never mounts this component; the bottom nav owns that layout.
 */
export function Sidebar() {
  const activeModal = useAppStore((s) => s.active_modal)
  const vaultState = useAppStore((s) => s.vault_state)
  const setVaultState = useAppStore((s) => s.setVaultState)
  const pushToast = useAppStore((s) => s.pushToast)

  const openParse = useCallback(() => useAppStore.getState().setActiveModal('parse'), [])
  const openHistory = useCallback(() => useAppStore.getState().setActiveModal('history'), [])
  const openSettings = useCallback(() => useAppStore.getState().setActiveModal('settings'), [])
  const openSync = useCallback(() => useAppStore.getState().setActiveModal('sync'), [])

  async function lockNow(): Promise<void> {
    await flushPersistence()
    setVaultState('locked')
    pushToast('Locked.', 'info')
  }

  return (
    <nav className={styles.strip} aria-label="Main">
      <div className={styles.group}>
        <button
          type="button"
          className={[styles.item, styles.brand].join(' ')}
          onClick={() => void goHome()}
          data-testid="strip-home"
          aria-label="Home"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
            <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" />
            <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" />
            <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
          </svg>
          <span className={styles.label} aria-hidden="true">
            RecBay
          </span>
        </button>

        <StripItem
          active={activeModal === 'parse'}
          label="Parse"
          testId="strip-parse"
          onClick={openParse}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6" />
            <path d="M9 17h4" />
          </svg>
        </StripItem>

        <StripItem
          active={activeModal === 'history'}
          label="History"
          testId="strip-history"
          onClick={openHistory}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
          </svg>
        </StripItem>

        <StripItem
          active={activeModal === 'sync'}
          label="Sync"
          testId="strip-sync"
          onClick={openSync}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="4" width="13" height="10" rx="1.5" />
            <path d="M1 17.5h12" />
            <rect x="16.5" y="8" width="6" height="12" rx="1.5" />
          </svg>
        </StripItem>

        <StripItem
          active={activeModal === 'settings'}
          label="Settings"
          testId="strip-settings"
          onClick={openSettings}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </StripItem>
      </div>

      <div className={styles.group}>
        {vaultState === 'unlocked' ? (
          <StripItem label="Lock now" testId="strip-lock" onClick={() => void lockNow()}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </StripItem>
        ) : (
          <span className={styles.lockedBadge} title="Locked" aria-label="Locked">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
        )}
      </div>
    </nav>
  )
}

function StripItem({
  active,
  label,
  testId,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  testId: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={[styles.item, active ? styles.itemOn : ''].filter(Boolean).join(' ')}
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {children}
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
    </button>
  )
}
