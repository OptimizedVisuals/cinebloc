/**
 * Local password vault (data-at-rest encryption). Implemented by
 * adapters/vault; injected into state/services by the composition root.
 *
 * 'off'      → no password configured; storage is plaintext passthrough
 * 'locked'   → password set, app closed or manually locked; data inaccessible
 * 'unlocked' → key derived and held in memory for this session only
 */
export type VaultStatus = 'off' | 'locked' | 'unlocked'

export interface VaultPort {
  /** Synchronous after the adapter factory initializes. */
  status(): VaultStatus
  /** Enable encryption: derives the key, writes salt/verifier, migrates existing plaintext in place. */
  setup(password: string): Promise<void>
  /** Returns false for a wrong password without touching any data. */
  unlock(password: string): Promise<boolean>
  /** Drop the in-memory key. Callers should flush pending writes first. */
  lock(): void
  /** Destructive reset for forgotten passwords: erases the entire local database. */
  eraseLocalData(): Promise<void>
}
