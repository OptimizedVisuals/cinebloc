import { useEffect } from 'react'
import { flushPersistence } from '@/state/persistence'
import { HistoryPanel } from '@/features/history'
import { AiConfigPanel, ScriptInputPanel } from '@/features/parser'
import { DataExport, DataImport, SettingsPanel } from '@/features/settings'
import { SyncPanel } from '@/features/sync'
import { ViewportController, useViewportMode } from '@/layout'
import { getServices } from '@/state/services'
import { goHome } from '@/state/projectActions'
import { resetAppState, useAppStore } from '@/state/store'
import { undo, redo } from '@/state/history'
import { Button, Modal, ToastStack, GridIcon, LockIcon } from '@/ui'
import { LockScreen } from './LockScreen'
import { Onboarding } from './Onboarding'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { Home } from './Home'
import { consumePairingUrl, resumePendingPairing } from './pairingRoute'
import styles from './app.module.css'

/**
 * App shell.
 *
 * - Mobile: compact header (brand + lock indicator) and a thumb-zone
 *   BottomNav (Parse / History / Settings) — single-column, full-width
 *   touch targets.
 * - Desktop (>= breakpoint): the header and bottom bar disappear entirely;
 *   navigation lives in the fixed ultra-slim left strip (Sidebar) so the
 *   infinite canvas keeps the whole viewport. Labels only appear on hover.
 * - The workspace renders only when a project is open; otherwise the
 *   Home screen takes the full screen.
 * - Onboarding / LockScreen / Privacy / parse / settings live in modals
 *   whose backgrounds are dark and neutral.
 */
export default function App() {
  const hydrated = useAppStore((s) => s.hydrated)
  const onboardingDone = useAppStore((s) => s.onboarding_done)
  const activeModal = useAppStore((s) => s.active_modal)
  const toasts = useAppStore((s) => s.toasts)
  const vaultState = useAppStore((s) => s.vault_state)
  const project = useAppStore((s) => s.project)
  const hasProject = project !== null
  const setActiveModal = useAppStore((s) => s.setActiveModal)
  const setVaultState = useAppStore((s) => s.setVaultState)
  const pushToast = useAppStore((s) => s.pushToast)
  const syncReady = useAppStore((s) => s.sync_device !== null)
  const flush = flushPersistence
  const mode = useViewportMode()

  // Keyboard undo/redo (skips typing contexts; history.ts guards the lock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A pairing link opened by the phone's own camera app lands here (spec §3).
  // `hashchange` matters: iOS reuses the loaded document when only the fragment
  // changes, so the link would otherwise never be read.
  useEffect(() => {
    const onUrl = () => {
      consumePairingUrl()
    }
    onUrl()
    window.addEventListener('hashchange', onUrl)
    return () => window.removeEventListener('hashchange', onUrl)
  }, [])

  // A held pairing link is only consumed once the app can perform the join —
  // never while the lock screen is up, and never before the sync runtime booted.
  useEffect(() => {
    void resumePendingPairing()
  }, [hydrated, vaultState, syncReady])

  if (vaultState === 'locked') {
    return <LockScreen />
  }

  if (!hydrated) {
    return (
      <div className={styles.splash}>
        <div className={styles.splashTitle}>RecBay</div>
        <div>Loading local workspace…</div>
      </div>
    )
  }

  const close = () => setActiveModal(null)

  async function lockNow(): Promise<void> {
    // Flush pending edits while still unlocked, then drop the key and data.
    await flush()
    getServices().vault.lock()
    resetAppState()
    setVaultState('locked')
    pushToast('Locked.', 'ok')
  }

  return (
    <div className={[styles.shell, mode === 'desktop' ? styles.shellWide : ''].filter(Boolean).join(' ')}>
      {mode === 'desktop' ? <Sidebar /> : null}

      {mode === 'mobile' ? (
      <header className={styles.appbar}>
        <div className={styles.appbarLefts}>
          <button
            type="button"
            className={styles.brand}
            onClick={() => void goHome()}
            data-testid="go-home"
            title="Home"
            aria-label="Back to home"
          >
            <span className={styles.brandMark} aria-hidden="true">
              <GridIcon size={20} />
            </span>
            <span className={styles.brandText}>RecBay</span>
          </button>

          {hasProject ? (
            <span className={styles.pageTitle}>{project.title}</span>
          ) : (
            <span className={styles.pageTitle}>Start</span>
          )}
        </div>

        <div className={styles.appbarRights}>
          <Button
            variant="ghost"
            onClick={() => setActiveModal('sync')}
            data-testid="open-sync"
            aria-current={activeModal === 'sync' ? 'page' : undefined}
          >
            <span>Sync</span>
          </Button>
          {vaultState === 'unlocked' ? (
            <Button variant="ghost" onClick={() => void lockNow()} data-testid="lock-button">
              <LockIcon size={16} />
              <span>Lock</span>
            </Button>
          ) : (
            <span className={styles.lockBadge}>
              <LockIcon size={14} />
              Locked
            </span>
          )}
        </div>
      </header>
      ) : null}

      {/* No open project → the script-first landing page; otherwise the
          responsive workspace (canvas on desktop, checklist on mobile). */}
      {project === null ? <Home /> : <ViewportController />}

      {mode === 'mobile' ? <BottomNav /> : null}

      {!onboardingDone ? <Onboarding /> : null}

      {activeModal === 'parse' ? (
        <Modal title="Parse screenplay" onClose={close}>
          <ScriptInputPanel />
        </Modal>
      ) : null}

      {activeModal === 'aiconfig' ? (
        <Modal
          title="AI Configuration"
          onClose={() => {
            useAppStore.getState().setPendingScript(null)
            close()
          }}
        >
          <AiConfigPanel />
        </Modal>
      ) : null}

      {activeModal === 'settings' ? (
        <Modal title="Settings" onClose={close} wide>
          <SettingsPanel />
        </Modal>
      ) : null}

      {activeModal === 'history' ? (
        <Modal title="Project history" onClose={close} wide>
          <HistoryPanel />
        </Modal>
      ) : null}

      {activeModal === 'dataexport' ? (
        <Modal title="Data export" onClose={close} wide>
          <DataExport />
        </Modal>
      ) : null}

      {activeModal === 'dataimport' ? (
        <Modal title="Restore snapshot" onClose={close} wide>
          <DataImport />
        </Modal>
      ) : null}

      {activeModal === 'sync' ? (
        <Modal title="Devices &amp; Sync" onClose={close}>
          <SyncPanel />
        </Modal>
      ) : null}

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => useAppStore.getState().dismissToast(id)}
      />
    </div>
  )
}

