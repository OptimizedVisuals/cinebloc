import { useState } from 'react'
import { Button, Field, Input } from '@/ui'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import styles from './settings.module.css'

/**
 * Password setup form shown inside the Security card when the App Security
 * switch is flipped on. Copy is one concise helper line — no long-form
 * encryption explanations (settings spec).
 */
export function VaultPanel() {
  const vaultState = useAppStore((s) => s.vault_state)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (vaultState !== 'off') {
    return (
      <div className={styles.helper}>
        <p className={styles.helper} style={{ margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>On.</strong> Everything on this device is
          encrypted. Use Lock in the header to lock now.
        </p>
        <p className={styles.helper} style={{ margin: 0, color: 'var(--text-faint)' }}>
          Forgotten password? Erasing local data from the lock screen is the only way back.
        </p>
      </div>
    )
  }

  async function enable(): Promise<void> {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await getServices().vault.setup(password)
      useAppStore.getState().setVaultState('unlocked')
      useAppStore.getState().pushToast('Password lock enabled.', 'ok')
      setPassword('')
      setConfirm('')
    } catch (cause) {
      console.error('vault setup failed', cause)
      setError(cause instanceof Error ? cause.message : 'Could not enable the password lock.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.vaultForm}>
      <div className={styles.grid}>
        <Field label="Password (min 8 chars)">
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            data-testid="vault-password"
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat it"
            data-testid="vault-confirm"
          />
        </Field>
      </div>
      {error ? (
        <p className={styles.helper} role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <div className={styles.row}>
        <Button
          variant="primary"
          onClick={() => void enable()}
          disabled={busy}
          data-testid="vault-enable"
        >
          {busy ? 'Encrypting…' : 'Enable password lock'}
        </Button>
      </div>
    </div>
  )
}
