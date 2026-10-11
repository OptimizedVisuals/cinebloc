import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceIdentity, LocalMutation, SyncTransportPort } from '@/kernel'
import { createWebRtcPort } from '@/adapters/sync-webrtc'
import { FakeChannel, FakePeer, asPeer } from '@/adapters/sync-webrtc/__tests__/fake-rtc'
import { SyncJournal, SyncSession, type SyncSessionResult } from '@/state/sync'
import {
  createMemoryStorage,
  makeProject,
  makeShot,
  type MemoryStorage,
} from '@/state/sync/__tests__/memory-storage'

/**
 * The full stack, two devices at once: real signalling payloads (offer →
 * answer → derived pairing code), the real adapter's transport, and a real
 * `SyncSession` on each side — every peer with its own identity, journal and
 * storage. Nothing about the handshake is stubbed: only the OS WebRTC stack
 * itself is replaced (it does not exist in Node), exactly as the adapter's own
 * suite does.
 *
 * Together with `state/sync/__tests__/engine.test.ts` (which drills the hard
 * protocol cases — duplicates, corruption, mid-transfer interruption — over a
 * scripted link) this covers the increment's acceptance list:
 *
 *   initial sync ............ here, plus engine.test "seeds a brand-new device"
 *   bidirectional incremental  here (concurrent offline edits both ways)
 *   reconnection ............ here (disconnect reported, fresh pairing recovers)
 *   interrupted transfers ... engine.test "resumes an interrupted transfer"
 *   duplicate messages ...... engine.test "ignores a duplicate delivery"
 *   concurrent edits ........ engine.test "converges on one winner" + here
 *   deletes ................. here (delete crosses as a delta) + engine.test
 *   asset integrity ......... here (bytes arrive) + engine.test (hash refusal)
 */

interface Peer {
  identity: DeviceIdentity
  storage: MemoryStorage
  journal: SyncJournal
}

async function makePeer(deviceId: string, name: string, platform: 'desktop' | 'mobile'): Promise<Peer> {
  const storage = createMemoryStorage()
  const identity: DeviceIdentity = { deviceId, name, platform, createdAt: 1 }
  const journal = await SyncJournal.open(storage, identity)
  return { identity, storage, journal }
}

interface Wired {
  host: SyncTransportPort
  guest: SyncTransportPort
  /** The six-digit code both handshakes derived from the two payloads. */
  code: string
  /** Sever the channel the way a dropped network would. */
  cut(): void
}

const openHandshakes: { close(): void }[] = []
afterEach(() => {
  while (openHandshakes.length > 0) openHandshakes.pop()?.close()
})

/**
 * Pair two adapter instances the way the app does: host offer → guest answer →
 * host accept, then the browser's own channel plumbing (ICE complete, SCTP
 * open, `datachannel` arriving at the guest).
 */
async function connect(host: DeviceIdentity, guest: DeviceIdentity): Promise<Wired> {
  const hostPeer = new FakePeer()
  const guestPeer = new FakePeer()
  const hostPort = createWebRtcPort({ createPeer: () => asPeer(hostPeer), readyTimeoutMs: 2_000 })
  const guestPort = createWebRtcPort({ createPeer: () => asPeer(guestPeer), readyTimeoutMs: 2_000 })

  const hostHandshake = await hostPort.host(host)
  openHandshakes.push(hostHandshake)
  const guestHandshake = await guestPort.guest(guest, hostHandshake.payload())
  openHandshakes.push(guestHandshake)
  await hostHandshake.accept(guestHandshake.payload())

  const hostChannel = hostPeer.channels[0]
  const guestChannel = new FakeChannel()
  hostChannel.peer = guestChannel
  guestChannel.peer = hostChannel
  const hostReady = hostHandshake.ready()
  const guestReady = guestHandshake.ready()
  hostPeer.connect()
  guestPeer.emit('datachannel', { channel: guestChannel })
  guestChannel.open()
  hostChannel.open()

  const code = hostHandshake.code()
  if (code === null) throw new Error('The handshake did not derive a pairing code.')
  // The pairing code is the whole integrity story of manual signalling: both
  // sides must derive it from the same two payloads or the payloads did not
  // come from these two devices.
  expect(code).toMatch(/^\d{6}$/)
  expect(code).toBe(guestHandshake.code())

  return {
    host: await hostReady,
    guest: await guestReady,
    code,
    cut: () => {
      hostChannel.close()
      guestChannel.close()
    },
  }
}

function startSessions(a: Peer, b: Peer, link: Wired): Promise<[SyncSessionResult, SyncSessionResult]> {
  const shared = {
    code: link.code,
    isBlocked: () => false,
    activeProjectId: () => null,
    readSettings: () => ({ board_mode: 'fast' as const }),
    heartbeatMs: 0,
    idleMs: 200,
    batchLimit: 2,
  }
  const sessionA = new SyncSession({ ...shared, identity: a.identity, journal: a.journal, storage: a.storage, role: 'host' })
  const sessionB = new SyncSession({ ...shared, identity: b.identity, journal: b.journal, storage: b.storage, role: 'guest' })
  return Promise.all([sessionA.start(link.host), sessionB.start(link.guest)]) as Promise<
    [SyncSessionResult, SyncSessionResult]
  >
}

const ASSET_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

/** A library that predates the change log, as a real first device would have. */
async function seedLibrary(peer: Peer): Promise<void> {
  const project = makeProject('p-1')
  const shots = [{ ...makeShot('s-1', 0), asset_refs: ['asset-1'] }, makeShot('s-2', 1), makeShot('s-3', 2)]
  await peer.storage.saveProject(project)
  await peer.storage.saveShots('p-1', shots)
  await peer.storage.putBlob('asset-1', new Blob([ASSET_BYTES], { type: 'image/jpeg' }))
  const mutations: LocalMutation[] = [
    { entity: 'project', entityId: 'p-1', operation: 'create', data: project },
    ...shots.map((shot) => ({
      entity: 'shot' as const,
      entityId: shot.id,
      parentId: 'p-1',
      operation: 'create' as const,
      data: shot,
    })),
  ]
  await peer.journal.record(mutations)
}

async function shotNotes(storage: MemoryStorage, id: string): Promise<string | null> {
  const shots = await storage.listShots('p-1')
  return shots.find((s) => s.id === id)?.notes ?? null
}

describe('two devices over the real WebRTC adapter', () => {
  it('pairs through offer/answer payloads and performs the first full sync, assets included', async () => {
    const pc = await makePeer('device-pc', "Titan's PC", 'desktop')
    const phone = await makePeer('device-phone', 'Titan\'s Phone', 'mobile')
    await seedLibrary(pc)

    const link = await connect(pc.identity, phone.identity)
    const [ra, rb] = await startSessions(pc, phone, link)

    expect(ra.status).toBe('done')
    expect(rb.status).toBe('done')
    // The peer was adopted from a validated HELLO/WELCOME, codes included.
    expect(rb.peer?.deviceId).toBe('device-pc')
    expect(ra.peer?.deviceId).toBe('device-phone')

    // Records landed in the phone's own storage…
    expect(await phone.storage.loadProject('p-1')).toEqual(await pc.storage.loadProject('p-1'))
    const shots = await phone.storage.listShots('p-1')
    expect(shots.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])

    // …the asset arrived in chunks and matches byte for byte…
    const blob = await phone.storage.getBlob('asset-1')
    expect(blob).not.toBeNull()
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(ASSET_BYTES)
    expect(rb.stats.assetsReceived).toBe(1)
    expect(rb.stats.bytesReceived).toBe(ASSET_BYTES.byteLength)

    // …and the phone adopted the PC's cursor, so the next session is incremental.
    expect(phone.journal.snapshot().cursors['device-pc']).toBeGreaterThan(0)
  })

  it('converges concurrent offline edits and a delete in both directions, as deltas only', async () => {
    const pc = await makePeer('device-pc', 'PC', 'desktop')
    const phone = await makePeer('device-phone', 'Phone', 'mobile')
    await seedLibrary(pc)

    // Session 1: seed the phone.
    const first = await connect(pc.identity, phone.identity)
    const [r1a, r1b] = await startSessions(pc, phone, first)
    expect(r1a.status).toBe('done')
    expect(r1b.status).toBe('done')
    expect(await phone.storage.listShots('p-1')).toHaveLength(3)

    // Both devices work offline — concurrently, including a delete on the PC.
    const s1 = makeShot('s-1', 0, 'rewritten on the PC')
    const s2 = makeShot('s-2', 1, 'rewritten on the phone')
    await pc.journal.record([
      { entity: 'shot', entityId: 's-1', parentId: 'p-1', operation: 'update', data: s1 },
      {
        entity: 'shot',
        entityId: 's-4',
        parentId: 'p-1',
        operation: 'create',
        data: makeShot('s-4', 3, 'new on the PC'),
      },
      { entity: 'shot', entityId: 's-3', parentId: 'p-1', operation: 'delete' },
    ])
    const pcShots = [s1, s2, makeShot('s-4', 3, 'new on the PC')]
    await pc.storage.saveShots('p-1', pcShots)

    await phone.journal.record([
      { entity: 'shot', entityId: 's-2', parentId: 'p-1', operation: 'update', data: s2 },
    ])
    const phoneShots = (await phone.storage.listShots('p-1')).map((s) => (s.id === 's-2' ? s2 : s))
    await phone.storage.saveShots('p-1', phoneShots)

    // Session 2: a fresh pairing (manual signalling has no auto-reconnect).
    const second = await connect(pc.identity, phone.identity)
    const [r2a, r2b] = await startSessions(pc, phone, second)
    expect(r2a.status).toBe('done')
    expect(r2b.status).toBe('done')

    // Deltas only — no snapshot was resent in either direction. Exactly the
    // three PC ops (update, create, delete) and the one phone op crossed.
    expect(r2a.stats.recordsSent).toBe(3)
    expect(r2b.stats.recordsSent).toBe(1)

    // The phone holds the PC's work: new shot, edited shot, delete applied.
    const phoneAfter = await phone.storage.listShots('p-1')
    expect(phoneAfter.map((s) => s.id).sort()).toEqual(['s-1', 's-2', 's-4'])
    expect(await shotNotes(phone.storage, 's-1')).toBe('rewritten on the PC')

    // The PC holds the phone's work.
    const pcAfter = await pc.storage.listShots('p-1')
    expect(pcAfter.map((s) => s.id).sort()).toEqual(['s-1', 's-2', 's-4'])
    expect(await shotNotes(pc.storage, 's-2')).toBe('rewritten on the phone')
  })

  it('reports a mid-session disconnect honestly and recovers completely on re-pair', async () => {
    const pc = await makePeer('device-pc', 'PC', 'desktop')
    const phone = await makePeer('device-phone', 'Phone', 'mobile')
    await seedLibrary(pc)

    const link = await connect(pc.identity, phone.identity)
    // Sever the channel the instant the first reply reaches the PC — before
    // its session can process it, so the exchange is definitively unfinished.
    let cut = false
    link.host.onFrame(() => {
      if (cut) return
      cut = true
      link.cut()
    })

    const [ra, rb] = await startSessions(pc, phone, link)
    // Neither side may pretend this finished.
    expect(ra.status).toBe('failed')
    expect(rb.status).toBe('failed')
    expect(ra.message).toMatch(/disconnect/i)
    expect(rb.message).toMatch(/disconnect/i)
    // Nothing had been written yet, and nothing is half-applied.
    expect(await phone.storage.listProjects()).toHaveLength(0)
    expect(await phone.storage.listBlobKeys()).toHaveLength(0)

    // Recovery: a fresh pairing (the only reconnect story manual signalling
    // has) completes the sync with no loss and no duplication.
    const link2 = await connect(pc.identity, phone.identity)
    const [ra2, rb2] = await startSessions(pc, phone, link2)
    expect(ra2.status).toBe('done')
    expect(rb2.status).toBe('done')
    expect(await phone.storage.listProjects()).toHaveLength(1)
    expect((await phone.storage.listShots('p-1')).map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])
    expect(rb2.stats.assetsReceived).toBe(1)
  })
})
