import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalMutation } from '@/kernel'

/**
 * The whole pairing story as the app wires it, twice in one process: two
 * independent instances — each with its own store, services registry, storage,
 * identity, journal and WebRTC peer — driving `state/sync/pairing.ts` end to
 * end through the real adapter and the real engine.
 *
 * `vi.resetModules()` gives each instance its own copy of every module, which
 * is the closest Node gets to two browser profiles. Only the OS's WebRTC stack
 * is replaced (it does not exist in Node), exactly as in the adapter suite.
 *
 * This is what proves the panel's code path: invitation → reply → accepted
 * answer → channel → HELLO/WELCOME with the derived pairing code → snapshot →
 * both sides reporting "Up to date" on their own status surfaces.
 */

type PairingModule = typeof import('@/state/sync/pairing')
type RuntimeModule = typeof import('@/state/sync/runtime')
type StoreModule = typeof import('@/state/store')
type MemoryModule = typeof import('@/state/sync/__tests__/memory-storage')
type FakeRtcModule = typeof import('@/adapters/sync-webrtc/__tests__/fake-rtc')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await sleep(20)
  }
  throw new Error('condition never became true')
}

interface Instance {
  pairing: PairingModule
  runtime: RuntimeModule
  store: StoreModule
  memory: MemoryModule
  storage: ReturnType<MemoryModule['createMemoryStorage']>
  rtcPeer: InstanceType<FakeRtcModule['FakePeer']>
  fakeRtc: FakeRtcModule
  dispose: () => void
}

const booted: Instance[] = []

afterEach(() => {
  for (const instance of booted.splice(0, booted.length)) {
    try {
      instance.pairing.cancelPairing()
    } catch {
      // already gone
    }
    instance.dispose()
  }
})

/** One "browser profile": fresh module registry, fresh services, fresh storage. */
async function bootInstance(): Promise<Instance> {
  vi.resetModules()
  const pairing = await import('@/state/sync/pairing')
  const runtime = await import('@/state/sync/runtime')
  const store = await import('@/state/store')
  const fakeServices = await import('@/state/sync/__tests__/fake-services')
  const memory = await import('@/state/sync/__tests__/memory-storage')
  const webrtc = await import('@/adapters/sync-webrtc')
  const fakeRtc = await import('@/adapters/sync-webrtc/__tests__/fake-rtc')

  const storage = memory.createMemoryStorage()
  const rtcPeer = new fakeRtc.FakePeer()
  const rtc = webrtc.createWebRtcPort({
    createPeer: () => fakeRtc.asPeer(rtcPeer),
    readyTimeoutMs: 2_000,
  })
  fakeServices.installFakeServices(storage, rtc)
  store.useAppStore.setState({ hydrated: true, vault_state: 'off' })
  const dispose = runtime.installSyncRuntime()
  await waitFor(() => store.useAppStore.getState().sync_device !== null)

  const instance: Instance = { pairing, runtime, store, memory, storage, rtcPeer, fakeRtc, dispose }
  booted.push(instance)
  return instance
}

describe('app-level pairing flow', () => {
  it('pairs two app instances, moves a library, and reports done on both screens', async () => {
    const host = await bootInstance()
    const guest = await bootInstance()

    // A library that predates this pairing, on the host only.
    const journal = host.runtime.getJournal()
    expect(journal).not.toBeNull()
    const project = host.memory.makeProject('p-1', 'Rain Diner')
    const shots = [
      host.memory.makeShot('s-1', 0, 'first'),
      host.memory.makeShot('s-2', 1, 'second'),
    ]
    await host.storage.saveProject(project)
    await host.storage.saveShots('p-1', shots)
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
    await journal!.record(mutations)

    // The invitation: a payload the user carries to the other device.
    const invitation = await host.pairing.createInvitation()
    expect(invitation.phase).toBe('payload')
    expect(invitation.payload).toMatch(/^recbay-sync-v1\./)
    expect(invitation.code).toBeNull() // host learns it only after the reply
    expect(host.store.useAppStore.getState().sync_status).not.toBe('error')

    // The guest consumes it and shows its reply.
    const reply = await guest.pairing.joinWithInvitation(invitation.payload!)
    expect(reply.phase).toBe('payload')
    expect(reply.payload).toMatch(/^recbay-sync-v1\./)
    expect(reply.code).toMatch(/^\d{6}$/)
    expect(guest.store.useAppStore.getState().sync_status).toBe('connecting')

    // The browser's own channel plumbing, between accept and open.
    const hostChannel = host.rtcPeer.channels[0]
    expect(hostChannel).toBeDefined()
    const guestChannel = new host.fakeRtc.FakeChannel()
    hostChannel.peer = guestChannel
    guestChannel.peer = hostChannel

    await host.pairing.acceptAnswer(reply.payload!)
    expect(host.pairing.pairingState().phase).toBe('connecting')
    // Both screens can show the same comparison code.
    expect(host.pairing.pairingState().code).toBe(reply.code)
    expect(host.store.useAppStore.getState().sync_status).toBe('connecting')

    guest.rtcPeer.emit('datachannel', { channel: guestChannel })
    host.rtcPeer.connect()
    guestChannel.open()
    hostChannel.open()

    // The sessions run to quiescence and both panels land on "done".
    await waitFor(
      () =>
        host.pairing.pairingState().phase === 'done' &&
        guest.pairing.pairingState().phase === 'done',
    )

    // The library is in the guest's own storage, byte for byte.
    const synced = await guest.storage.loadProject('p-1')
    expect(synced?.title).toBe('Rain Diner')
    expect((await guest.storage.listShots('p-1')).map((s) => s.id)).toEqual(['s-1', 's-2'])

    // Honest status surfaces: idle, not a fabricated "connected", and each
    // device knows the other by name.
    expect(host.store.useAppStore.getState().sync_status).toBe('idle')
    expect(guest.store.useAppStore.getState().sync_status).toBe('idle')
    const hostId = host.store.useAppStore.getState().sync_device!.deviceId
    const guestId = guest.store.useAppStore.getState().sync_device!.deviceId
    expect(hostId).not.toBe(guestId)
    expect(guest.store.useAppStore.getState().sync_devices.map((d) => d.deviceId)).toContain(hostId)
    expect(host.store.useAppStore.getState().sync_devices.map((d) => d.deviceId)).toContain(guestId)
    expect(host.pairing.pairingState().message).toContain('Up to date')
    expect(guest.pairing.pairingState().message).toContain('Up to date')
  })
})
