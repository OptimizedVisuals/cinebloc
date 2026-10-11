import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  encodeMessage,
  type DeviceIdentity,
  type LocalMutation,
  type SyncOperation,
  type SyncStatus,
} from '@/kernel'
import { resetAppState, useAppStore } from '../../store'
import { SyncSession, SYNC_LOCKED_MESSAGE, type SyncSessionResult } from '../engine'
import { SyncJournal } from '../journal'
import { initSyncTap, resetSyncTapForTests } from '../tap'
import { createLoopback, type LoopbackLink, type LoopbackTransport } from './loopback'
import { createMemoryStorage, makeProject, makeShot, type MemoryStorage } from './memory-storage'

/**
 * Two independent peers per test: separate identity, journal, change log,
 * storage and transport. Nothing is shared except the process, so a test can
 * only pass by actually moving data the way the wire would.
 *
 * The live zustand store IS shared (it is a module singleton), so these tests
 * deliberately run with no open project — a remote apply then touches storage
 * only, and the store's own wiring is covered by the dedicated case at the end
 * plus the existing applyOps/tap suites.
 */

interface Peer {
  deviceId: string
  identity: DeviceIdentity
  storage: MemoryStorage
  journal: SyncJournal
}

async function makePeer(deviceId: string, name: string): Promise<Peer> {
  const storage = createMemoryStorage()
  const identity: DeviceIdentity = { deviceId, name, platform: 'desktop', createdAt: 1 }
  const journal = await SyncJournal.open(storage, identity)
  return { deviceId, identity, storage, journal }
}

interface RunOptions {
  batchLimit?: number
  heartbeatMs?: number
  idleMs?: number
  code?: string
  blockedA?: () => boolean
  blockedB?: () => boolean
  activeProjectId?: string | null
}

interface RunningPair {
  link: LoopbackLink
  a: LoopbackTransport
  b: LoopbackTransport
  results: Promise<[SyncSessionResult, SyncSessionResult]>
  statuses: { a: { status: SyncStatus; message: string }[]; b: { status: SyncStatus; message: string }[] }
}

function runPair(peerA: Peer, peerB: Peer, options: RunOptions = {}): RunningPair {
  const { a, b, link } = createLoopback()
  const statuses = {
    a: [] as { status: SyncStatus; message: string }[],
    b: [] as { status: SyncStatus; message: string }[],
  }
  const activeProjectId = () => options.activeProjectId ?? null
  const idleMs = options.idleMs ?? 120

  const sessionA = new SyncSession({
    identity: peerA.identity,
    journal: peerA.journal,
    storage: peerA.storage,
    role: 'host',
    code: options.code ?? null,
    isBlocked: options.blockedA ?? (() => false),
    activeProjectId,
    readSettings: () => ({ board_mode: 'fast' }),
    batchLimit: options.batchLimit ?? 2,
    heartbeatMs: options.heartbeatMs ?? 0,
    idleMs,
    onStatus: (status, message) => statuses.a.push({ status, message }),
  })
  const sessionB = new SyncSession({
    identity: peerB.identity,
    journal: peerB.journal,
    storage: peerB.storage,
    role: 'guest',
    code: options.code ?? null,
    isBlocked: options.blockedB ?? (() => false),
    activeProjectId,
    readSettings: () => ({ board_mode: 'fast' }),
    batchLimit: options.batchLimit ?? 2,
    heartbeatMs: options.heartbeatMs ?? 0,
    idleMs,
    onStatus: (status, message) => statuses.b.push({ status, message }),
  })

  const results = Promise.all([sessionA.start(a), sessionB.start(b)]) as Promise<
    [SyncSessionResult, SyncSessionResult]
  >
  return { link, a, b, results, statuses }
}

function shotCreate(id: string, parentId: string, order = 0, notes = ''): LocalMutation {
  return {
    entity: 'shot',
    entityId: id,
    parentId,
    operation: 'create',
    data: makeShot(id, order, notes),
  }
}

function shotUpdate(id: string, parentId: string, notes: string): LocalMutation {
  return { entity: 'shot', entityId: id, parentId, operation: 'update', data: makeShot(id, 0, notes) }
}

function shotDelete(id: string, parentId: string): LocalMutation {
  return { entity: 'shot', entityId: id, parentId, operation: 'delete' }
}

async function blobOf(text: string, type = 'image/png'): Promise<Blob> {
  return new Blob([new TextEncoder().encode(text)], { type })
}

let stopTap: (() => void) | null = null

describe('sync engine across two peers', () => {
  beforeEach(() => {
    resetSyncTapForTests()
    resetAppState()
  })

  afterEach(() => {
    stopTap?.()
    stopTap = null
    resetSyncTapForTests()
    resetAppState()
  })

  it('seeds a brand-new device with a library that predates the journal (first sync)', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')

    // The PC's library exists in storage but produced no operations, because it
    // was created before device sync existed. Nothing can be sent "since a
    // cursor" — this is exactly what the snapshot path is for.
    await pc.storage.saveProject(makeProject('p-1', 'Rain Diner'))
    await pc.storage.saveShots('p-1', [makeShot('s-1', 0), makeShot('s-2', 1)])
    expect(pc.journal.ops()).toHaveLength(0)

    const run = runPair(pc, phone)
    const [ra, rb] = await run.results

    expect(ra.status).toBe('done')
    expect(rb.status).toBe('done')
    expect((await phone.storage.listProjects()).map((p) => p.id)).toEqual(['p-1'])
    expect((await phone.storage.listShots('p-1')).map((s) => s.id)).toEqual(['s-1', 's-2'])

    // The snapshot must NOT become operations on the receiver: inventing
    // "creates" for records that already existed would resurrect them forever.
    expect(phone.journal.ops()).toHaveLength(0)
    // …and the phone now knows the PC's library is in place, so no re-send.
    expect(phone.journal.snapshot().snapshots['device-a']).toBe(0)
  })

  it('does not resend the library once the peer has taken it', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.storage.saveProject(makeProject('p-1'))
    await pc.storage.saveShots('p-1', [makeShot('s-1', 0)])
    await pc.journal.record([shotCreate('s-1', 'p-1')])

    await runPair(pc, phone).results
    const second = runPair(pc, phone)
    await second.results

    expect(second.link.sent().a.some((frame) => frame.includes('SNAPSHOT_START'))).toBe(false)
  })

  it('exchanges later edits in both directions and clears the pending counts', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotCreate('s-1', 'p-1'), shotCreate('s-2', 'p-1', 1)])
    await pc.storage.saveProject(makeProject('p-1'))
    await pc.storage.saveShots('p-1', [makeShot('s-1', 0), makeShot('s-2', 1)])

    await runPair(pc, phone).results
    expect((await phone.storage.listShots('p-1')).map((s) => s.id)).toEqual(['s-1', 's-2'])

    // Both devices now work offline.
    await pc.journal.record([shotUpdate('s-1', 'p-1', 'graded on the PC')])
    await phone.journal.record([shotUpdate('s-2', 'p-1', 'ticked on the phone')])

    const run = runPair(pc, phone)
    const [ra, rb] = await run.results
    expect(ra.status).toBe('done')
    expect(rb.status).toBe('done')

    const pcShots = await pc.storage.listShots('p-1')
    const phoneShots = await phone.storage.listShots('p-1')
    expect(pcShots.find((s) => s.id === 's-2')?.notes).toBe('ticked on the phone')
    expect(phoneShots.find((s) => s.id === 's-1')?.notes).toBe('graded on the PC')

    // Both sides acknowledged each other's work, so nothing is left pending.
    expect(pc.journal.pendingFor('device-b')).toBe(0)
    expect(phone.journal.pendingFor('device-a')).toBe(0)
  })

  it('resumes an interrupted transfer in a new session without losing or duplicating work', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    const mutations = [0, 1, 2, 3, 4, 5].map((i) => shotCreate(`s-${i}`, 'p-1', i))
    await pc.journal.record(mutations)

    // The link dies the moment the first batch of changes reaches the phone.
    const first = runPair(pc, phone)
    first.link.breakAfter((raw) => raw.includes('OPS_BATCH'))
    await first.link.settle()
    const [ra] = await first.results
    expect(ra.status).toBe('failed')

    const partial = phone.journal.ops()
    expect(partial.length).toBeGreaterThan(0)
    expect(partial.length).toBeLessThan(6)

    // A fresh session (new offer/answer, as the ADR requires) finishes the job.
    const second = runPair(pc, phone)
    const [ra2, rb2] = await second.results
    expect(ra2.status).toBe('done')
    expect(rb2.status).toBe('done')

    const applied = phone.journal.ops()
    expect(applied.map((op) => op.entityId).sort()).toEqual([
      's-0',
      's-1',
      's-2',
      's-3',
      's-4',
      's-5',
    ])
    // Resuming must not duplicate: ids are globally unique and the log is keyed by id.
    expect(new Set(applied.map((op) => op.id)).size).toBe(applied.length)
    expect(pc.journal.pendingFor('device-b')).toBe(0)
  })

  it('ignores a duplicate delivery of the same batch', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotUpdate('s-1', 'p-1', 'once')])

    const run = runPair(pc, phone)
    // A retrying transport hands the same frame over twice, mid-exchange.
    run.link.duplicateNext((raw) => raw.includes('OPS_BATCH'))
    const [, rb] = await run.results
    expect(rb.status).toBe('done')

    expect(phone.journal.ops()).toHaveLength(1)
    expect((await phone.storage.listShots('p-1')).length).toBeLessThanOrEqual(1)
  })

  it('converges on one winner for edits made offline on both devices', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    // The shot exists on both devices (someone created it earlier); each device
    // edits it while offline, so both edits carry counter 1.
    await pc.storage.saveShots('p-1', [makeShot('s-1', 0, 'from the PC')])
    await phone.storage.saveShots('p-1', [makeShot('s-1', 0, 'from the phone')])
    await pc.journal.record([shotUpdate('s-1', 'p-1', 'from the PC')])
    await phone.journal.record([shotUpdate('s-1', 'p-1', 'from the phone')])

    await runPair(pc, phone).results

    const winnerA = pc.journal.snapshot().versions['shot:s-1']
    const winnerB = phone.journal.snapshot().versions['shot:s-1']
    expect(winnerA).toEqual(winnerB)
    // Deterministic tie-break by deviceId, so the same side wins on both.
    expect(winnerA).toEqual({ counter: 1, deviceId: 'device-b' })
    expect((await pc.storage.listShots('p-1'))[0]?.notes).toBe('from the phone')
    expect((await phone.storage.listShots('p-1'))[0]?.notes).toBe('from the phone')
  })

  it('lets a newer delete beat an offline edit and never resurrects the record', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await phone.storage.saveShots('p-1', [makeShot('s-1', 0)])

    // The phone edited it while offline (logically older)…
    await phone.journal.record([shotUpdate('s-1', 'p-1', 'offline edit')])
    // …the PC created and then deleted it, at higher counters.
    await pc.journal.record([shotUpdate('s-1', 'p-1', 'created on the PC')])
    await pc.journal.record([shotDelete('s-1', 'p-1')])

    const run = runPair(pc, phone)
    const [, rb] = await run.results
    expect(rb.status).toBe('done')
    expect(await phone.storage.listShots('p-1')).toEqual([])

    // A late replay of the stale edit must not bring the record back.
    const stale = phone.journal.ops().find((op) => op.entityId === 's-1' && op.operation === 'update')
    expect(stale).toBeDefined()
    const replayed = await phone.journal.ingest([stale as SyncOperation])
    expect(replayed.accepted).toHaveLength(0)
    expect(await phone.storage.listShots('p-1')).toEqual([])
  })

  it('transfers asset bytes in chunks and stores them only after the checksum matches', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')

    const key = 's-1/frame.png'
    const blob = await blobOf('a'.repeat(40_000)) // spans several 16 KiB chunks
    await pc.storage.putBlob(key, blob)
    const shot = { ...makeShot('s-1', 0), asset_refs: [key] }
    await pc.storage.saveProject(makeProject('p-1'))
    await pc.storage.saveShots('p-1', [shot])
    await pc.journal.record([
      { entity: 'shot', entityId: 's-1', parentId: 'p-1', operation: 'create', data: shot },
    ])

    const run = runPair(pc, phone)
    const [, rb] = await run.results
    expect(rb.status).toBe('done')

    const received = await phone.storage.getBlob(key)
    expect(received).not.toBeNull()
    expect(received!.size).toBe(blob.size)
    expect(await received!.text()).toBe(await blob.text())
  })

  it('refuses to store an asset that does not match its declared hash', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    const key = 's-1/corrupt.png'
    const blob = await blobOf('b'.repeat(1000))
    await pc.storage.putBlob(key, blob)
    const shot = { ...makeShot('s-1', 0), asset_refs: [key] }
    await pc.storage.saveProject(makeProject('p-1'))
    await pc.storage.saveShots('p-1', [shot])
    await pc.journal.record([
      { entity: 'shot', entityId: 's-1', parentId: 'p-1', operation: 'create', data: shot },
    ])

    const run = runPair(pc, phone, { batchLimit: 64 })
    // Corrupt the bytes in transit: same length, different content.
    run.link.corruptBinaryFrames(1)
    await run.link.settle()
    await run.results

    expect(await phone.storage.getBlob(key)).toBeNull()
    const reported = [...run.statuses.b.map((s) => s.message), ...run.statuses.b.map((s) => s.message)]
    expect(reported.some((message) => /intact/.test(message))).toBe(true)
  })

  it('reports a peer disconnect instead of pretending the sync finished', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotCreate('s-1', 'p-1')])

    const run = runPair(pc, phone)
    // The link dies during the greeting, well before any data can be applied.
    run.link.onDeliver((raw) => {
      if (raw.includes('HELLO')) run.link.break()
    })
    const [ra, rb] = await run.results

    expect(ra.status).toBe('failed')
    expect(rb.status).toBe('failed')
    expect(ra.message).toMatch(/disconnected/i)
    expect(run.statuses.a.at(-1)?.status).toBe('error')
  })

  it('refuses to move any data while the vault is locked', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotCreate('s-1', 'p-1')])

    const run = runPair(pc, phone, { blockedA: () => true })
    const [ra] = await run.results

    expect(ra.status).toBe('failed')
    expect(ra.message).toBe(SYNC_LOCKED_MESSAGE)
    // Nothing left the device: not even the greeting.
    expect(run.link.sent().a).toEqual([])
  })

  it('stops a running exchange the moment the vault locks', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([0, 1, 2, 3].map((i) => shotCreate(`s-${i}`, 'p-1', i)))

    let locked = false
    const run = runPair(pc, phone, { blockedA: () => locked })
    // As soon as the phone's ACK is on the wire, the PC is locked.
    run.link.onDeliver((raw) => {
      if (raw.includes('"t":"ACK"')) locked = true
    })

    const [ra] = await run.results
    expect(ra.status).toBe('failed')
    expect(ra.message).toBe(SYNC_LOCKED_MESSAGE)
  })

  it('aborts when the two devices do not agree on the pairing code', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotCreate('s-1', 'p-1')])

    // Two different codes: the payloads the user carried were not this pair.
    const run = runPairWithCodes(pc, phone, '111111', '222222')
    const [ra] = await run.results

    expect(ra.status).toBe('failed')
    expect(ra.message).toMatch(/pairing codes do not match/i)
    // Nothing was applied on either side.
    expect(phone.journal.ops()).toHaveLength(0)
  })

  it('refuses a session with this same device', async () => {
    const pc = await makePeer('device-a', 'PC')
    const other = await makePeer('device-a', 'PC copy')
    const run = runPair(pc, other)
    const [ra] = await run.results
    expect(ra.status).toBe('failed')
    expect(ra.message).toMatch(/same device/i)
  })

  it('rejects a malformed frame without touching local data', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    const run = runPair(pc, phone)
    // Garbage from the peer, delivered while the session is still running.
    run.link.injectOnNextDelivery((raw) => raw.includes('HELLO'), '{"t":"NONSENSE"}')
    const [, rb] = await run.results

    expect(rb.status).toBe('failed')
    expect(rb.message).toMatch(/Unsupported sync message/i)
    expect(await phone.storage.listProjects()).toEqual([])
  })

  it('ignores operations a peer tries to author as this device', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    const run = runPair(pc, phone)

    const forged: SyncOperation = {
      id: 'forged-1',
      seq: 99,
      deviceId: 'device-b', // claiming to be the phone, sent by the PC
      entity: 'shot',
      entityId: 's-forged',
      parentId: 'p-1',
      operation: 'create',
      data: makeShot('s-forged', 0),
      version: { counter: 99, deviceId: 'device-b' },
      timestamp: Date.now(),
    }
    run.link.injectOnNextDelivery(
      (raw) => raw.includes('HELLO'),
      encodeMessage({ t: 'OPS_BATCH', ops: [forged], more: false }),
    )
    const [, rb] = await run.results

    expect(rb.status).toBe('done')
    expect(phone.journal.ops()).toHaveLength(0)
    expect(await phone.storage.listShots('p-1')).toEqual([])
  })

  it('acknowledges only the batches that were durably written', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    // Five ops at two per batch: the second batch is what fails to persist.
    await pc.journal.record([0, 1, 2, 3, 4].map((i) => shotCreate(`s-${i}`, 'p-1', i)))

    const originalSaveShots = phone.storage.saveShots.bind(phone.storage)
    // The first batch lands; from the second onwards the disk is full.
    phone.storage.saveShots = async (projectId, shots) => {
      if (shots.some((shot) => shot.id === 's-2')) throw new Error('disk full')
      return originalSaveShots(projectId, shots)
    }

    const run = runPair(pc, phone)
    const [ra, rb] = await run.results

    expect(rb.status).toBe('failed')
    // The first batch was persisted and ACKed; the cursor stops exactly there.
    const acked = pc.journal.snapshot().acked['device-b'] ?? 0
    expect(acked).toBe(2)
    expect(pc.journal.pendingFor('device-b')).toBe(3)
    // The peer must not receive an acknowledgement it cannot back with data.
    expect(ra.status).toBe('failed')
  })

  it('gives up on a peer that stops responding', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')
    await pc.journal.record([shotCreate('s-1', 'p-1')])

    // A tiny keepalive window; the phone's frames never arrive.
    const run = runPair(pc, phone, { heartbeatMs: 10 })
    run.link.freeze()
    const [ra] = await run.results

    expect(ra.status).toBe('failed')
    expect(ra.message).toMatch(/stopped responding/i)
  })

  it('applies a remote change to the open project without recording a new operation', async () => {
    const pc = await makePeer('device-a', 'PC')
    const phone = await makePeer('device-b', 'Phone')

    // The phone has the project open, so the remote change is live.
    const shot = makeShot('s-live', 0, 'arrived while open')
    await pc.journal.record([
      { entity: 'project', entityId: 'p-1', operation: 'create', data: makeProject('p-1') },
      { entity: 'shot', entityId: 's-live', parentId: 'p-1', operation: 'create', data: shot },
    ])

    useAppStore.setState({ hydrated: true, vault_state: 'off', project: makeProject('p-1'), shots: [] })
    const recorded: LocalMutation[][] = []
    stopTap = initSyncTap({ record: async (mutations) => void recorded.push([...mutations]) }, { windowMs: 5 })

    const run = runPair(pc, phone, { activeProjectId: 'p-1' })
    const [, rb] = await run.results
    expect(rb.status).toBe('done')

    // The open board now shows the phone… the PC's shot.
    expect(useAppStore.getState().shots.map((s) => s.id)).toEqual(['s-live'])
    expect(useAppStore.getState().project?.id).toBe('p-1')
    // …and the tap recorded nothing: a peer's edit must not echo back as ours.
    expect(recorded).toEqual([])
  })
})

/** One-off variant that gives each side a different code, to test the check. */
function runPairWithCodes(peerA: Peer, peerB: Peer, codeA: string, codeB: string): RunningPair {
  const { a, b, link } = createLoopback()
  const shared = {
    readSettings: () => ({ board_mode: 'fast' as const }),
    activeProjectId: () => null,
    batchLimit: 2,
    heartbeatMs: 0,
    idleMs: 120,
  }
  const sessionA = new SyncSession({
    ...shared,
    identity: peerA.identity,
    journal: peerA.journal,
    storage: peerA.storage,
    role: 'host',
    code: codeA,
    isBlocked: () => false,
  })
  const sessionB = new SyncSession({
    ...shared,
    identity: peerB.identity,
    journal: peerB.journal,
    storage: peerB.storage,
    role: 'guest',
    code: codeB,
    isBlocked: () => false,
  })
  const results = Promise.all([sessionA.start(a), sessionB.start(b)]) as Promise<
    [SyncSessionResult, SyncSessionResult]
  >
  return { link, a, b, results, statuses: { a: [], b: [] } }
}
