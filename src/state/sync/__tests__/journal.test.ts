import { beforeEach, describe, expect, it } from 'vitest'
import type { DeviceIdentity, LocalMutation } from '@/kernel'
import { opsSince } from '@/kernel'
import { SyncJournal } from '../journal'
import { applyRemoteOps } from '../applyOps'
import { createMemoryStorage, makeShot, type MemoryStorage } from './memory-storage'

/**
 * Two devices, two independent stores. Every scenario below is the spec's
 * disconnected-editing story: A and B work alone, then meet.
 */

interface Device {
  storage: MemoryStorage
  journal: SyncJournal
  identity: DeviceIdentity
}

function identity(deviceId: string, name: string): DeviceIdentity {
  return { deviceId, name, platform: 'desktop', createdAt: 1 }
}

async function makeDevice(deviceId: string, name: string): Promise<Device> {
  const storage = createMemoryStorage()
  const id = identity(deviceId, name)
  const journal = await SyncJournal.open(storage, id)
  return { storage, journal, identity: id }
}

/** Reload the journal from storage, as a browser restart would. */
async function restart(device: Device): Promise<void> {
  device.journal = await SyncJournal.open(device.storage, device.identity)
}

function shotUpdate(id: string, notes: string, parentId = 'p-1'): LocalMutation {
  return {
    entity: 'shot',
    entityId: id,
    parentId,
    operation: 'update',
    data: makeShot(id, 0, notes),
  }
}

describe('sync journal across two devices', () => {
  let a: Device
  let b: Device

  beforeEach(async () => {
    a = await makeDevice('device-a', 'PC')
    b = await makeDevice('device-b', 'Phone')
  })

  it('marks only the changed record as pending, never the whole database', async () => {
    const created = [0, 1, 2, 3, 4].map((i) => ({
      entity: 'shot' as const,
      entityId: `s-${i}`,
      parentId: 'p-1',
      operation: 'create' as const,
      data: makeShot(`s-${i}`, i),
    }))
    await a.journal.record(created)

    // B syncs once: it acknowledges everything A has produced so far.
    const firstPass = a.journal.opsFor('device-b')
    expect(firstPass).toHaveLength(5)
    await a.journal.ackFrom('device-b', { 'device-a': firstPass.at(-1)!.seq }, Date.now())
    expect(a.journal.pendingCount(['device-b'])).toBe(0)

    // A edits exactly one record (C, in the spec's example).
    await a.journal.record([shotUpdate('s-2', 'edited on the PC')])

    expect(a.journal.pendingCount(['device-b'])).toBe(1)
    const missing = opsSince(a.journal.opsFor('device-b'), { 'device-a': firstPass.at(-1)!.seq })
    expect(missing.map((op) => op.entityId)).toEqual(['s-2'])
  })

  it('converges on the same winner for concurrent offline edits', async () => {
    await a.journal.record([shotUpdate('s-1', 'from PC')])
    await b.journal.record([shotUpdate('s-1', 'from phone')])

    // Neither has seen the other yet: both edits have counter 1.
    const aOps = a.journal.ops()
    const bOps = b.journal.ops()
    await a.journal.ingest(bOps)
    await b.journal.ingest(aOps)

    const aWinner = a.journal.snapshot().versions['shot:s-1']
    const bWinner = b.journal.snapshot().versions['shot:s-1']
    expect(aWinner).toEqual(bWinner)
    // Deterministic tie-break by deviceId: 'device-b' > 'device-a'.
    expect(aWinner).toEqual({ counter: 1, deviceId: 'device-b' })

    // Both devices now hold both ops, so either can relay the winner onward.
    expect(new Set(a.journal.ops().map((op) => op.deviceId))).toEqual(
      new Set(['device-a', 'device-b']),
    )
    expect(a.journal.snapshot().tombstones).toEqual({})
  })

  it('lets a newer delete win over an older edit made while offline', async () => {
    // B is offline and never sees A's create: its edit is logically older.
    await b.journal.record([shotUpdate('s-1', 'offline edit')])
    await b.storage.saveShots('p-1', [makeShot('s-1', 0)])

    // Meanwhile A creates the record and then deletes it (higher counters).
    await a.journal.record([shotUpdate('s-1', 'created on the PC')])
    await a.journal.record([
      { entity: 'shot', entityId: 's-1', parentId: 'p-1', operation: 'delete' },
    ])
    const deleteOp = a.journal.ops().at(-1)!
    expect(deleteOp.operation).toBe('delete')

    const aResult = await a.journal.ingest(b.journal.ops())
    const bResult = await b.journal.ingest(a.journal.ops())

    // The stale edit is rejected everywhere; the deletion stands.
    expect(aResult.accepted).toHaveLength(0)
    expect(bResult.accepted).toEqual([deleteOp])
    expect(bResult.tombstones['shot:s-1']).toEqual(deleteOp.version)

    const applied = await applyRemoteOps({
      ops: bResult.accepted,
      storage: b.storage,
      activeProjectId: 'p-1',
    })
    expect(applied.shotsDeleted).toBe(1)
    expect(await b.storage.listShots('p-1')).toEqual([])
  })

  it('resolves a genuine tie deterministically (same counter, different devices)', async () => {
    // Neither device saw the other: both edits carry counter 1.
    await a.journal.record([shotUpdate('s-9', 'A')])
    await b.journal.record([shotUpdate('s-9', 'B')])

    const aResult = await a.journal.ingest(b.journal.ops())
    const bResult = await b.journal.ingest(a.journal.ops())

    // device-b sorts after device-a, so B's edit is the winner on both sides.
    expect(a.journal.snapshot().versions['shot:s-9']).toEqual({ counter: 1, deviceId: 'device-b' })
    expect(b.journal.snapshot().versions['shot:s-9']).toEqual({ counter: 1, deviceId: 'device-b' })
    expect(aResult.accepted.map((op) => op.deviceId)).toEqual(['device-b'])
    expect(bResult.accepted).toHaveLength(0)
  })

  it('drops duplicate deliveries instead of applying them twice', async () => {
    await a.journal.record([shotUpdate('s-1', 'once')])
    const batch = a.journal.ops()

    const first = await b.journal.ingest(batch)
    const second = await b.journal.ingest(batch)

    expect(first.accepted).toHaveLength(1)
    expect(second.accepted).toHaveLength(0)
    expect(second.rejected).toBe(1)
    expect(b.journal.ops()).toHaveLength(1)
  })

  it('survives an interrupted transfer and finishes it later', async () => {
    const mutations: LocalMutation[] = [0, 1, 2, 3].map((i) => ({
      entity: 'shot',
      entityId: `s-${i}`,
      parentId: 'p-1',
      operation: 'create',
      data: makeShot(`s-${i}`, i),
    }))
    await a.journal.record(mutations)
    const all = a.journal.ops()

    // Half the batch arrives, then the connection drops.
    const partial = await b.journal.ingest(all.slice(0, 2))
    expect(partial.accepted).toHaveLength(2)
    expect(b.journal.snapshot().cursors['device-a']).toBe(all[1].seq)

    // Reconnecting resumes from the cursor and only sends the gap.
    const resumed = opsSince(a.journal.ops(), b.journal.snapshot().cursors)
    expect(resumed.map((op) => op.entityId)).toEqual(['s-2', 's-3'])

    const rest = await b.journal.ingest(resumed)
    expect(rest.accepted).toHaveLength(2)
    expect(b.journal.ops().map((op) => op.entityId).sort()).toEqual(['s-0', 's-1', 's-2', 's-3'])
  })

  it('recovers everything after a restart: versions, cursors, log and pending', async () => {
    await a.journal.record([shotUpdate('s-1', 'persisted')])
    const batch = a.journal.ops()
    await b.journal.ingest(batch)
    await a.journal.ackFrom('device-b', { 'device-a': batch.at(-1)!.seq }, 1234)

    await restart(a)
    await restart(b)

    expect(a.journal.ops()).toHaveLength(1)
    expect(a.journal.pendingCount(['device-b'])).toBe(0)
    expect(a.journal.snapshot().lastSyncAt).toBe(1234)
    expect(b.journal.snapshot().cursors['device-a']).toBe(batch[0].seq)
    expect(b.journal.snapshot().versions['shot:s-1']).toEqual(batch[0].version)

    // And re-delivering the same batch after the restart is still a no-op.
    expect((await b.journal.ingest(a.journal.ops())).accepted).toHaveLength(0)
  })

  it('keeps sequence numbers monotonic across restarts', async () => {
    await a.journal.record([shotUpdate('s-1', 'one')])
    const firstSeq = a.journal.ops().at(-1)!.seq
    await restart(a)
    await a.journal.record([shotUpdate('s-1', 'two')])
    expect(a.journal.ops().at(-1)!.seq).toBeGreaterThan(firstSeq)
  })

  it('relays a third device\u2019s changes (more than two devices)', async () => {
    const c = await makeDevice('device-c', 'Tablet')

    await a.journal.record([shotUpdate('s-1', 'made on the PC')])
    // B receives A's change…
    await b.journal.ingest(a.journal.ops())
    // …and C, which only ever talks to B, still learns about it.
    await c.journal.ingest(b.journal.ops())

    expect(c.journal.ops().map((op) => op.deviceId)).toEqual(['device-a'])
    expect(c.journal.snapshot().versions['shot:s-1']).toBeDefined()
  })

  it('counts pending work per peer, so the copy is true for all of them', async () => {
    await a.journal.record([shotUpdate('s-1', 'x')])
    const op = a.journal.ops()[0]

    await a.journal.ackFrom('device-b', { 'device-a': op.seq })
    expect(a.journal.pendingFor('device-b')).toBe(0)
    expect(a.journal.pendingFor('device-c')).toBe(1)
    // One peer is behind, so the device as a whole is not fully synced.
    expect(a.journal.pendingCount(['device-b', 'device-c'])).toBe(1)
  })
})
