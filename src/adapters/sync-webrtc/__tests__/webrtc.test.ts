import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceIdentity, SyncTransportPort } from '@/kernel'
import { createWebRtcPort, SYNC_CHANNEL_LABEL } from '../index'
import { SIGNAL_PREFIX, SignalError, decodeSignal, encodeSignal } from '../signal'
import { FakeChannel, FakePeer, asPeer } from './fake-rtc'

const PC: DeviceIdentity = { deviceId: 'pc-1', name: 'PC', platform: 'desktop', createdAt: 1 }
const PHONE: DeviceIdentity = { deviceId: 'phone-1', name: 'Phone', platform: 'mobile', createdAt: 2 }

const offer = () =>
  encodeSignal({ v: 1, kind: 'offer', sdp: 'v=0\r\no=offer', name: 'PC', deviceId: 'pc-1', createdAt: 1 })
const answer = () =>
  encodeSignal({ v: 1, kind: 'answer', sdp: 'v=0\r\no=answer', name: 'Phone', deviceId: 'phone-1', createdAt: 2 })

describe('signalling payload', () => {
  it('round-trips as a single copyable line', () => {
    const payload = offer()
    expect(payload.startsWith(SIGNAL_PREFIX)).toBe(true)
    expect(payload).not.toMatch(/\s/)
    expect(decodeSignal(payload)).toMatchObject({ kind: 'offer', deviceId: 'pc-1' })
  })

  it('survives the whitespace a chat client inserts', () => {
    const payload = answer()
    const wrapped = `${payload.slice(0, 40)}\n  ${payload.slice(40)}\r\n`
    expect(decodeSignal(wrapped).kind).toBe('answer')
  })

  it('refuses anything that is not one of our payloads', () => {
    expect(() => decodeSignal('')).toThrow(SignalError)
    expect(() => decodeSignal('hello there')).toThrow(/does not look like/i)
    expect(() => decodeSignal(`${SIGNAL_PREFIX}!!!not-base64!!!`)).toThrow(SignalError)
    // Valid base64, but not a payload we understand.
    expect(() => decodeSignal(encodeSignalLike({ v: 2, kind: 'offer' }))).toThrow(/different version/i)
  })
})

/** Builds a prefixed payload from arbitrary JSON, to test the version guard. */
function encodeSignalLike(value: unknown): string {
  const json = JSON.stringify(value)
  return SIGNAL_PREFIX + Buffer.from(json, 'utf8').toString('base64url')
}

describe('webrtc port', () => {
  const disposers: (() => void)[] = []
  afterEach(() => {
    for (const dispose of disposers) dispose()
    disposers.length = 0
  })

  async function pair(): Promise<{
    host: SyncTransportPort
    guest: SyncTransportPort
    hostPeer: FakePeer
    guestPeer: FakePeer
    code: { host: string | null; guest: string | null }
  }> {
    const hostPeer = new FakePeer()
    const guestPeer = new FakePeer()
    const port = createWebRtcPort({
      createPeer: () => asPeer(hostPeer),
      readyTimeoutMs: 500,
    })
    const hostHandshake = await port.host(PC)
    const guestPort = createWebRtcPort({
      createPeer: () => asPeer(guestPeer),
      readyTimeoutMs: 500,
    })
    const guestHandshake = await guestPort.guest(PHONE, hostHandshake.payload())
    await hostHandshake.accept(guestHandshake.payload())

    // The browser would do this as ICE completes and SCTP handshakes: two ends
    // of one channel, the guest's arriving over `datachannel`.
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

    disposers.push(() => hostHandshake.close(), () => guestHandshake.close())
    return {
      host: await hostReady,
      guest: await guestReady,
      hostPeer,
      guestPeer,
      code: { host: hostHandshake.code(), guest: guestHandshake.code() },
    }
  }

  it('builds a peer connection with no ICE servers at all', async () => {
    // The single decision that makes this feature structurally LAN-only.
    let captured: unknown = null
    const original = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
    ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = function Fake(config: unknown) {
      captured = config
      return new FakePeer() as unknown as RTCPeerConnection
    }
    try {
      const port = createWebRtcPort({ readyTimeoutMs: 50 })
      await port.host(PC)
      expect(captured).toEqual({ iceServers: [] })
    } finally {
      ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = original
    }
  })

  it('offers a data channel and both sides derive the same pairing code', async () => {
    const session = await pair()
    expect(session.hostPeer.channels).toHaveLength(1)
    expect(session.hostPeer.remoteDescription?.type).toBe('answer')
    expect(session.guestPeer.remoteDescription?.type).toBe('offer')
    // Both halves of the exchange were produced by our own encoder.
    expect(session.code.host).not.toBeNull()
    expect(session.code.host).toBe(session.code.guest)
    expect(session.code.host).toMatch(/^\d{6}$/)
  })

  it('carries text and binary frames in both directions', async () => {
    const { host, guest } = await pair()
    const toGuest: string[] = []
    const toHost: string[] = []
    const binary: number[] = []
    const errors: Error[] = []
    guest.onFrame((raw) => toGuest.push(raw))
    host.onFrame((raw) => toHost.push(raw))
    guest.onBinary((chunk) => binary.push(chunk.byteLength))
    host.onError((error) => errors.push(error))

    host.sendText('{"t":"PING","at":1}')
    host.sendBinary(new Uint8Array(2048))
    guest.sendText('{"t":"PONG","at":1}')

    expect(toGuest).toEqual(['{"t":"PING","at":1}'])
    expect(toHost).toEqual(['{"t":"PONG","at":1}'])
    expect(binary).toEqual([2048])
    expect(guest.state()).toBe('connected')
    expect(host.state()).toBe('connected')
    expect(errors).toEqual([])
  })

  it('reports the channel state instead of pretending to be connected', async () => {
    const hostPeer = new FakePeer()
    const port = createWebRtcPort({ createPeer: () => asPeer(hostPeer), readyTimeoutMs: 50 })
    const handshake = await port.host(PC)
    disposers.push(() => handshake.close())
    const ready = handshake.ready()

    hostPeer.channels[0].fail()
    await expect(ready).rejects.toThrow()
  })

  it('refuses a payload that is a reply when an invitation is expected', async () => {
    const port = createWebRtcPort({ createPeer: () => asPeer(new FakePeer()), readyTimeoutMs: 50 })
    await expect(port.guest(PHONE, answer())).rejects.toThrow(/not an invitation/i)
  })

  it('does not build the payload until ICE gathering has finished', async () => {
    const gatheringPeer = new FakePeer('manual')
    const port = createWebRtcPort({
      createPeer: () => asPeer(gatheringPeer),
      readyTimeoutMs: 200,
      gatherTimeoutMs: 500,
    })
    let payload: string | null = null
    const pending = port.host(PC).then((handshake) => {
      payload = handshake.payload()
      disposers.push(() => handshake.close())
      return handshake
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    // Still gathering: no payload has been produced yet, so a QR could not
    // possibly carry a complete set of candidates.
    expect(payload).toBeNull()

    gatheringPeer.finishGathering()
    await pending
    expect(payload).not.toBeNull()
    expect(decodeSignal(payload!)).toMatchObject({ kind: 'offer', sdp: 'v=0\r\no=fake-offer' })
  })

  it('gives up instead of waiting forever for a device that never answers', async () => {
    const port = createWebRtcPort({
      createPeer: () => asPeer(new FakePeer()),
      readyTimeoutMs: 30,
    })
    const handshake = await port.host(PC)
    await expect(handshake.ready()).rejects.toThrow(/never connected/i)
  })

  it('fails cleanly when the invitation cannot be decoded', async () => {
    const port = createWebRtcPort({ createPeer: () => asPeer(new FakePeer()), readyTimeoutMs: 50 })
    await expect(port.guest(PHONE, 'recbay-sync-v1.nonsense')).rejects.toThrow(SignalError)
  })

  it('uses a single, ordered channel', async () => {
    const peer = new FakePeer()
    const port = createWebRtcPort({ createPeer: () => asPeer(peer), readyTimeoutMs: 50 })
    const handshake = await port.host(PC)
    disposers.push(() => handshake.close())
    expect(peer.channels).toHaveLength(1)
    expect(SYNC_CHANNEL_LABEL).toBe('recbay-sync')
  })
})
