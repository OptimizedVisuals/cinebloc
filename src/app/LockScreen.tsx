import { useState } from 'react'
import { hydrate } from '@/state/persistence'
import { getServices } from '@/state/services'
import { resetAppState, useAppStore } from '@/state/store'
import { Button, Input } from '@/ui'
import { seedDemoIfRequested } from '../dev/seed'
import styles from './app.module.css'

/**
 * Shown whenever the vault is locked (app open, or re-opened after close).
 * The decryption key lives only in memory after a successful unlock; nothing
 * in the store is hydrated until then.
 */
export function LockScreen() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [eraseArmed, setEraseArmed] = useState(false)

  async function unlock(): Promise<void> {
    if (!password) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ok = await getServices().vault.unlock(password)
      if (!ok) {
        setError('Wrong password.')
        setBusy(false)
        return
      }
      useAppStore.getState().setVaultState('unlocked')
      await hydrate()
      seedDemoIfRequested()
    } catch (cause) {
      console.error('unlock failed', cause)
      setError('Unlock failed — the local database may be corrupted.')
      setBusy(false)
    }
  }

  async function erase(): Promise<void> {
    setBusy(true)
    try {
      await getServices().vault.eraseLocalData()
      resetAppState()
      window.location.reload()
    } catch (cause) {
      console.error('erase failed', cause)
      setError('Erase failed — try again.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.lockScreen} role="dialog" aria-label="RecBay is locked">
      <div className={styles.lockCard}>
        <h1 className={styles.splashTitle}>RecBay is locked</h1>
        <p className={styles.cardLead}>
          Your scripts, shots, references and API key are encrypted on this device with your
          password. Enter it to unlock this session.
        </p>

        <form
          className={styles.lockForm}
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Vault password"
            data-testid="unlock-password"
            autoFocus
          />
          {error ? (
            <p className={styles.lockError} role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="primary" type="submit" disabled={busy} data-testid="unlock-button">
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>

        <div className={styles.lockReset}>
          {eraseArmed ? (
            <div className={styles.lockResetRow}>
              <span>This permanently erases every local script, shot and image.</span>
              <div className={styles.lockResetRow}>
                <Button variant="danger" onClick={() => void erase()} disabled={busy}>
                  Confirm erase
                </Button>
                <Button onClick={() => setEraseArmed(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.lockLink}
              onClick={() => setEraseArmed(true)}
              data-testid="erase-armed"
            >
              Forgot password? Erase local data and start over
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
