import { useState } from 'react'
import { BOARD_MODES } from '@/kernel'
import {
  ChipIcon,
  DatabaseIcon,
  ExportIcon,
  ImportIcon,
  PaletteIcon,
  ShieldIcon,
  Toggle,
} from '@/ui'
import { useAppStore } from '@/state/store'
import { ApiKeyForm } from './ApiKeyForm'
import { VaultPanel } from './VaultPanel'
import styles from './settings.module.css'

/**
 * Settings — sleek card layout: four sections with icon mini-headings,
 * concise helper lines, an app pill switch for App Security, and
 * equal-width export/restore grid buttons. No long-form copy.
 *
 * Always the real panel: a fresh account must be able to reach AI
 * Configuration to add its BYOK key. Onboarding owns the welcome copy.
 */
export function SettingsPanel() {
  const [showVault, setShowVault] = useState(false)
  const [lockWarn, setLockWarn] = useState(false)
  const vaultState = useAppStore((s) => s.vault_state)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)

  const vaultOn = vaultState !== 'off'

  function onLockToggle() {
    setLockWarn(false)
    if (vaultOn) {
      // No silent disable: encryption without a key is meaningless.
      setLockWarn(true)
      return
    }
    setShowVault((v) => !v)
  }

  return (
    <div className={styles.panel}>
      {/* ── Security & lock ─────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <ShieldIcon size={14} />
          <span>Security &amp; Lock</span>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span className={styles.settingLabel}>App Security</span>
            <span className={styles.helper}>
              Requires password every time RecBay opens.
            </span>
          </div>
          <Toggle
            checked={vaultOn || showVault}
            onChange={onLockToggle}
            label="Enable password lock"
          />
        </div>

        {lockWarn ? (
          <p className={styles.lockWarn} role="status">
            Password lock is on. Disabling it requires erasing local data from the lock screen —
            encryption is useless if a bypass exists.
          </p>
        ) : null}

        {showVault && !vaultOn ? <VaultPanel /> : null}

        {vaultOn && !showVault ? (
          <p className={styles.helper}>
            On — API key, scripts, shots and images are encrypted on this device.
          </p>
        ) : null}

        {vaultOn ? (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setShowVault((v) => !v)}
            data-testid="settings-open-vault"
          >
            {showVault ? 'Hide vault' : 'Open vault'}
          </button>
        ) : null}
      </section>

      {/* ── AI configuration ────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <ChipIcon size={14} />
          <span>AI Configuration</span>
        </div>
        <ApiKeyForm />
        <p className={styles.helper}>
          Key stays on this device; sent only to your provider when you parse.
        </p>
      </section>

      {/* ── Board display mode ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <PaletteIcon size={14} />
          <span>Board Display Mode</span>
        </div>
        <div className={styles.modePill} role="group" aria-label="Board display mode">
          {BOARD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={[
                styles.modePillBtn,
                settings.board_mode === m.id ? styles.modePillBtnOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={settings.board_mode === m.id}
              data-testid={`board-mode-${m.id}`}
              onClick={() => setSettings({ board_mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className={styles.helper}>Applies to canvas, planner and checklists.</p>
      </section>

      {/* ── Data & backups ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <DatabaseIcon size={14} />
          <span>Data &amp; Backups</span>
        </div>
        <div className={styles.grid2}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => useAppStore.getState().setActiveModal('dataexport')}
            data-testid="settings-export"
            aria-label="Export all data"
          >
            <ExportIcon size={18} />
            <span>Export All (JSON)</span>
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => useAppStore.getState().setActiveModal('dataimport')}
            data-testid="settings-restore"
            aria-label="Restore / Import snapshot"
          >
            <ImportIcon size={18} />
            <span>Restore</span>
          </button>
        </div>
        <p className={styles.helper}>
          All data stays local in browser IndexedDB.
        </p>
      </section>
    </div>
  )
}
