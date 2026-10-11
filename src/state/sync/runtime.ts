import type { LocalMutation } from '@/kernel'
import { getServices } from '../services'
import { useAppStore } from '../store'
import type { AppState } from '../types'
import { loadKnownDevices, saveKnownDevices, trustedDeviceIds } from './devices'
import { IdentityUnavailableError, loadOrCreateIdentity } from './identity'
import { SyncJournal } from './journal'
import { initSyncTap } from './tap'

/**
 * Sync runtime (ADR 0005): the local half of device sync.
 *
 * Boot order: identity → journal (persisted state + op log) → change-log tap →
 * known-device registry. It is deliberately independent of any transport: with
 * no peer connected the app records changes locally, which is what makes the
 * system eventually consistent instead of "connected or useless".
 *
 * Nothing here establishes a connection, so the status it publishes stays
 * 'idle'/'off'. Claiming automatic reconnection belongs to the increment that
 * actually implements and tests a signaling/discovery mechanism.
 */

let journal: SyncJournal | null = null
let stopTap: (() => void) | null = null
let stopDevices: (() => void) | null = null
let starting: Promise<void> | null = null

/**
 * Mutations observed before the journal is open (identity generation and the
 * log read are async, and a dev seed can land in that window). They are held
 * here and written the moment the journal is ready, so the tap never has to
 * block and no change is silently dropped.
 */
const preBootBuffer: LocalMutation[] = []
const PRE_BOOT_LIMIT = 500

/** Set when the runtime can never start (e.g. no secure context on this device). */
let unavailable = false

/**
 * Boot attempts. The runtime starts on store changes, so a permanently failing
 * boot must give up instead of retrying on every unrelated re-render — that
 * would spin forever and starve the page.
 */
let attempts = 0
const MAX_BOOT_ATTEMPTS = 3

export function getJournal(): SyncJournal | null {
  return journal
}

export async function startSyncRuntime(): Promise<void> {
  if (journal) return
  if (starting) return starting
  starting = boot().finally(() => {
    starting = null
  })
  return starting
}

async function boot(): Promise<void> {
  const { storage } = getServices()
  const store = useAppStore.getState()

  const identity = await loadOrCreateIdentity(storage)
  const opened = await SyncJournal.open(storage, identity)
  const devices = await loadKnownDevices(storage)

  journal = opened
  store.setSyncDevice(identity)

  const state = useAppStore.getState()
  state.setSyncStatus(
    state.sync_enabled ? 'idle' : 'off',
    state.sync_enabled
      ? devices.length > 0
        ? 'Waiting for a known device'
        : 'No devices paired yet'
      : 'Sync is off',
  )

  // Persist the known-device registry whenever the UI changes it.
  let lastDevices = state.sync_devices
  stopDevices = useAppStore.subscribe((next) => {
    if (next.sync_devices === lastDevices) return
    lastDevices = next.sync_devices
    void saveKnownDevices(storage, next.sync_devices).catch((cause: unknown) =>
      console.error('known devices save failed', cause),
    )
  })

  // Anything observed before boot drained into the log first.
  if (preBootBuffer.length > 0) {
    await opened.record(preBootBuffer.splice(0, preBootBuffer.length))
  }

  refreshPending()
}

/** Recompute how many of our ops no trusted peer has acknowledged yet. */
export function refreshPending(): void {
  if (!journal) return
  const devices = useAppStore.getState().sync_devices
  useAppStore.getState().setSyncPending(journal.pendingCount(trustedDeviceIds(devices)))
}

export function stopSyncRuntime(): void {
  stopTap?.()
  stopDevices?.()
  stopTap = null
  stopDevices = null
  journal = null
  preBootBuffer.length = 0
  unavailable = false
  attempts = 0
}

/**
 * Install the runtime as soon as local data is readable and stop recording
 * while the vault is locked. Hydration and lock/unlock are handled here rather
 * than in the tap so there is a single place that decides "sync can run".
 */
export function installSyncRuntime(): () => void {
  // Install the tap immediately: it buffers into the journal as soon as that
  // exists, and it must already be listening when hydration lands so the
  // restored workspace is adopted as a baseline instead of logged as new data.
  stopTap = initSyncTap({
    record: async (mutations) => {
      if (unavailable) return // no identity on this device: nothing to log
      const opened = journal
      if (!opened) {
        if (preBootBuffer.length + mutations.length <= PRE_BOOT_LIMIT) preBootBuffer.push(...mutations)
        else console.warn('sync: too many changes before the journal opened; not recorded')
        return
      }
      await opened.record(mutations)
      refreshPending()
    },
  })

  const tryStart = (state: AppState) => {
    if (unavailable || journal || starting) return
    if (!state.hydrated || state.vault_state === 'locked') return
    void startSyncRuntime().catch((cause: unknown) => {
      attempts += 1
      const permanent = cause instanceof IdentityUnavailableError || attempts >= MAX_BOOT_ATTEMPTS
      if (permanent) {
        // Sync cannot run on this device: stop retrying and stop buffering.
        unavailable = true
        preBootBuffer.length = 0
      }
      const store = useAppStore.getState()
      if (cause instanceof IdentityUnavailableError) {
        // Secure context missing (plain http:// on a LAN address, for example).
        store.setSyncStatus('error', 'Device sync needs HTTPS or localhost on this device.')
        return
      }
      console.error('sync runtime failed to start', cause)
      store.setSyncStatus('error', 'Device sync could not start on this device.')
    })
  }

  tryStart(useAppStore.getState())
  const unsubscribe = useAppStore.subscribe((state) => tryStart(state))
  return () => {
    unsubscribe()
    stopSyncRuntime()
  }
}
