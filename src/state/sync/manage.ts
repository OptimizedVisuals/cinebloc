import { getServices } from '../services'
import { useAppStore } from '../store'
import { renameIdentity } from './identity'
import { cancelPairing } from './pairing'
import { getJournal, refreshPending } from './runtime'
import { flushSyncTap } from './tap'

/**
 * Device management actions (spec §7–§8) — the store-facing half of the
 * Devices & Sync surface.
 *
 * These are deliberately thin and honest about what a browser-only peer can
 * do. There is no background reconnection to expose, so "disconnect" ends the
 * live session and nothing more, and forgetting a device revokes trust without
 * touching a single project.
 */

/**
 * Revoke trust in a paired device.
 *
 * Three things happen and nothing else: the registry row goes, the journal's
 * per-peer cursors/acknowledgements/snapshot marker for it go, and pending
 * counts are recomputed. Local projects, shots, images and the op log stay
 * exactly where they are — a revoked device can pair again from scratch, and
 * if it does, the library is seeded again rather than silently trusted.
 */
export async function forgetDevice(deviceId: string): Promise<void> {
  const store = useAppStore.getState()
  const known = store.sync_devices.find((d) => d.deviceId === deviceId)
  store.removeSyncDevice(deviceId)
  const journal = getJournal()
  if (journal) await journal.forgetPeer(deviceId)
  await flushSyncTap()
  refreshPending()
  if (known) {
    store.pushToast(`${known.name} forgotten — it must pair again to sync.`, 'ok')
  }
}

/** Rename a paired device as this device lists it. */
export function renamePairedDevice(deviceId: string, name: string): void {
  useAppStore.getState().renameSyncDevice(deviceId, name)
}

/**
 * Rename THIS device. Only the display name changes: the `deviceId` is what
 * peers recognise, so a rename never re-pairs anything.
 */
export async function renameThisDevice(name: string): Promise<void> {
  const store = useAppStore.getState()
  const current = store.sync_device
  if (!current) throw new Error('Device sync is not ready on this device yet.')
  const next = await renameIdentity(getServices().storage, current, name)
  store.setSyncDevice(next)
  store.pushToast('Device renamed.', 'ok')
}

/**
 * End the live session but keep the pairing.
 *
 * `cancelPairing()` closes the data channel and any half-finished handshake, so
 * the status returns to a resting state. Automatic reconnection is not
 * implemented (ADR 0005), and the copy says so instead of implying otherwise.
 */
export function disconnectSync(): void {
  cancelPairing()
  const store = useAppStore.getState()
  if (store.sync_enabled) {
    store.setSyncStatus('idle', 'Disconnected — the next sync starts a fresh session.')
  }
}
