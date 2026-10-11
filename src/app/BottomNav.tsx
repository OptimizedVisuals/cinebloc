import { useCallback } from 'react'
import { ClockIcon, DocIcon, GearIcon } from '@/ui'
import { useAppStore } from '@/state/store'
import styles from './app.module.css'

/**
 * Bottom navigation (thumb zone): Parse • History • Settings — solid
 * line icons over labels, no footer lock (Lock lives in the header).
 *
 * - The parse entry opens the feedback modal straight into the screenplay
 *   (no summary step).
 * - History is a full panel: every parsed/imported script stays in
 *   IndexedDB under its own id.
 * - Settings is a panel: BYOK first, then data portability.
 */
export function BottomNav() {
  const activeModal = useAppStore((s) => s.active_modal)

  const openParse = useCallback(() => useAppStore.getState().setActiveModal('parse'), [])
  const openHistory = useCallback(() => useAppStore.getState().setActiveModal('history'), [])
  const openSettings = useCallback(() => useAppStore.getState().setActiveModal('settings'), [])

  return (
    <nav className={styles.nav} aria-label="Main">
      <button
        type="button"
        className={[styles.navBtn, activeModal === 'parse' ? styles.navBtnOn : ''].filter(Boolean).join(' ')}
        aria-current={activeModal === 'parse' ? 'page' : undefined}
        onClick={openParse}
        data-testid="nav-parse"
      >
        <DocIcon size={22} />
        <span>Parse</span>
      </button>

      <button
        type="button"
        className={[styles.navBtn, activeModal === 'history' ? styles.navBtnOn : ''].filter(Boolean).join(' ')}
        aria-current={activeModal === 'history' ? 'page' : undefined}
        onClick={openHistory}
        data-testid="nav-history"
      >
        <ClockIcon size={22} />
        <span>History</span>
      </button>

      <button
        type="button"
        className={[styles.navBtn, activeModal === 'settings' ? styles.navBtnOn : ''].filter(Boolean).join(' ')}
        aria-current={activeModal === 'settings' ? 'page' : undefined}
        onClick={openSettings}
        data-testid="nav-settings"
      >
        <GearIcon size={22} />
        <span>Settings</span>
      </button>
    </nav>
  )
}
