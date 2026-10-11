import { afterEach, describe, expect, it } from 'vitest'
import type { SyncOperation } from '@/kernel'
import { loadKnownDevices, mergeKnownDevice } from '../devices'
import { loadIdentity } from '../identity'
import { disconnectSync, forgetDevice, renameThisDevice } from '../manage'
import { getJournal, installSyncRuntime } from '../runtime'
import { resetSyncTapForTests } from '../tap'
import { resetAppState, useAppStore } from '../../store'
import { installFakeServices } from './fake-services'
import { makeShot, type MemoryStorage } from './memory-storage'

/**
 * Devices & Sync actions (spec §7–§8) against real storage and a real journal.
 *
 * The one invariant these all share: managing the *relationship* never touches
 * the user's work, and never silently forgets something the user decided.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await sleep(5)
  }
  throw new Error('condition never became true')
}

let dispose: (() => void) | null = null
let storage: MemoryStorage

async function boot(): Promise<void> {
  storage = installFakeServices()
  resetSyncTapForTests()
  resetAppState()
  useAppStore.setState({ hydrated: true, vault_state: 'off' })
  dispose = installSyncRuntime()
  await waitFor(() => useAppStore.getState().sync_device !== null)
}

function peerRow() {
  return mergeKnownDevice(undefined, {
    deviceId: 'phone-1',
    name: 'My iPhone',
    platform: 'mobile',
    createdAt: 1,
  })
}

afterEach(() => {
  dispose?.()
  dispose = null
  resetSyncTapForTests()
  resetAppState()
})

describe('rename this device', () => {
  it('changes the display name, keeps the identity, and persists it', async () => {
    await boot()
    const before = useAppStore.getState().sync_device
    expect(before).not.toBeNull()

    await renameThisDevice('Studio PC')

    const after = useAppStore.getState().sync_device
    expect(after?.name).toBe('Studio PC')
    // Peers recognise the device by its id, so a rename must never re-pair it.
    expect(after?.deviceId).toBe(before?.deviceId)
    expect((await loadIdentity(storage))?.name).toBe('Studio PC')
  })

  it('refuses to invent a name for a device that has no identity yet', async () => {
    installFakeServices()
    resetAppState()
    await expect(renameThisDevice('Anything')).rejects.toThrow(/not ready/i)
  })
})

describe('forget a device', () => {
  it('revokes trust and drops per-peer state, and keeps every local record', async () => {
    await boot()
    const device = useAppStore.getState().sync_device!
    const journal = getJournal()!
    useAppStore.getState().upsertSyncDevice(peerRow())

    // Local work, and a peer's operation relayed through this device.
    await storage.saveShots('p-1', [makeShot('s-1', 0)])
    await journal.record([
      { entity: 'shot', entityId: 's-1', parentId: 'p-1', operation: 'update', data: makeShot('s-1', 0) },
    ])
    const foreign: SyncOperation = {
      id: 'op-from-phone',
      seq: 1,
      deviceId: 'phone-1',
      entity: 'shot',
      entityId: 's-2',
      parentId: 'p-1',
      operation: 'update',
      data: makeShot('s-2', 1),
      version: { counter: 1, deviceId: 'phone-1' },
      timestamp: 1,
    }
    await journal.ingest([foreign])
    expect(journal.snapshot().cursors['phone-1']).toBe(1)
    await journal.adoptSnapshotFrom('phone-1', 4)
    await journal.ackFrom('phone-1', { [device.deviceId]: 1 }, 1234)

    expect(journal.snapshot().cursors['phone-1']).toBe(4)
    expect(journal.snapshot().acked['phone-1']).toBe(1)
    expect(journal.snapshot().snapshots['phone-1']).toBe(4)
    const opsBefore = journal.ops().length

    await forgetDevice('phone-1')

    const state = useAppStore.getState()
    expect(state.sync_devices).toEqual([])
    // Nothing about that peer survives: it must pair again from scratch, which
    // also means the library is seeded again rather than silently trusted.
    expect(journal.snapshot().cursors['phone-1']).toBeUndefined()
    expect(journal.snapshot().acked['phone-1']).toBeUndefined()
    expect(journal.snapshot().snapshots['phone-1']).toBeUndefined()
    // …and no local work was harmed.
    expect(journal.ops()).toHaveLength(opsBefore)
    expect(await storage.listShots('p-1')).toHaveLength(1)

    // The revocation is durable, not just in memory.
    expect(await loadKnownDevices(storage)).toEqual([])
  })
})

describe('disconnect', () => {
  it('ends the session and says the next one is fresh', async () => {
    await boot()
    useAppStore.setState({ sync_enabled: true })
    useAppStore.getState().setSyncStatus('syncing', 'Syncing with My iPhone…')

    disconnectSync()

    const state = useAppStore.getState()
    expect(state.sync_status).toBe('idle')
    expect(state.sync_message).toMatch(/fresh session/i)
    expect(state.sync_message).not.toMatch(/background/i)
  })
})

describe('registry persistence across a lock', () => {
  it('keeps paired devices when the store is cleared and rebuilt', async () => {
    await boot()
    const device = useAppStore.getState().sync_device!
    useAppStore.getState().upsertSyncDevice(peerRow())
    expect(await loadKnownDevices(storage)).toHaveLength(1)

    // Locking clears the store (no plaintext stays resident) while the runtime
    // itself stays up; unlocking must not look like "all devices forgotten".
    resetAppState()
    useAppStore.setState({ hydrated: true, vault_state: 'unlocked' })
    await waitFor(() => useAppStore.getState().sync_devices.length === 1)

    expect(useAppStore.getState().sync_device?.deviceId).toBe(device.deviceId)
    expect(await loadKnownDevices(storage)).toHaveLength(1)
  })
})
