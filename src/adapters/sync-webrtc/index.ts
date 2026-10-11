import {
  pairingCode,
  type DeviceIdentity,
  type SyncHandshake,
  type SyncTransportPort,
  type SyncTransportState,
  type WebRtcPort,
} from '@/kernel'
import {
  SignalError,
  assertSignalFresh,
  decodeSignal,
  encodeSignal,
  type SignalPayload,
} from './signal'

/**
 * WebRTC data-channel transport (ADR 0005).
 *
 * Two decisions define this adapter:
 *
 * 1. **No ICE servers.** `new RTCPeerConnection({ iceServers: [] })` means the
 *    only candidates that can ever be produced are host candidates on the local
 *    subnet (browsers publish them as mDNS `*.local` names). There is no STUN
 *    lookup and no TURN relay, so a connection that leaves the LAN cannot be
 *    established even by accident. That is the structural reason this feature is
 *    LAN-only, rather than a rule someone has to remember to follow.
 *
 * 2. **Gathering completes before the payload is built.** Signalling here is
 *    out-of-band, one payload per direction, so trickle ICE has nowhere to go:
 *    candidates must already be inside the SDP by the time the payload is shown.
 *    We therefore wait for `iceGatheringState === 'complete'` with a bounded
 *    timeout (lanes without usable interfaces can gather forever).
 *
 * The DTLS-encrypted channel itself is opaque to this file: it moves strings
 * and bytes. Protocol validation belongs to the engine.
 */

export const SYNC_CHANNEL_LABEL = 'recbay-sync'

/** Long enough for a slow subnet to gather, short enough not to hang a pairing. */
const DEFAULT_GATHER_TIMEOUT_MS = 4_000
/** How long a device waits for the other side to finish the handshake. */
const DEFAULT_READY_TIMEOUT_MS = 120_000
/** WebRTC's "disconnected" is often transient; only a sustained loss is real. */
const DISCONNECT_GRACE_MS = 3_000

export interface WebRtcOptions {
  /** Injected in tests; the default is a real peer connection with no servers. */
  createPeer?: () => RTCPeerConnection
  gatherTimeoutMs?: number
  readyTimeoutMs?: number
}

function defaultPeer(): RTCPeerConnection {
  // The empty ICE server list is load-bearing: see the file header.
  return new RTCPeerConnection({ iceServers: [] })
}

/** One live data channel, presented as the kernel's transport port. */
class ChannelTransport implements SyncTransportPort {
  private current: SyncTransportState = 'new'
  private readonly stateListeners = new Set<(state: SyncTransportState) => void>()
  private readonly frameListeners = new Set<(raw: string) => void>()
  private readonly binaryListeners = new Set<(chunk: ArrayBuffer) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly channel: RTCDataChannel,
  ) {
    channel.binaryType = 'arraybuffer'

    channel.addEventListener('open', () => this.setState('connected'))
    channel.addEventListener('close', () => this.setState('disconnected'))
    channel.addEventListener('error', () => {
      this.emitError(new Error('The peer-to-peer channel reported an error.'))
      this.setState('failed')
    })
    channel.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data
      if (typeof data === 'string') {
        for (const listener of this.frameListeners) listener(data)
        return
      }
      if (data instanceof ArrayBuffer) {
        for (const listener of this.binaryListeners) listener(data)
      }
    })

    pc.addEventListener('connectionstatechange', () => {
      switch (pc.connectionState) {
        case 'connected':
          this.clearDisconnectTimer()
          this.setState('connected')
          break
        case 'connecting':
        case 'new':
          this.setState('connecting')
          break
        case 'disconnected':
          this.scheduleDisconnect()
          break
        case 'failed':
          this.clearDisconnectTimer()
          this.emitError(new Error('The peer-to-peer connection failed.'))
          this.setState('failed')
          break
        case 'closed':
          this.setState('failed')
          break
        default:
          break
      }
    })

    // The channel may already be open by the time handlers are attached.
    if (channel.readyState === 'open') this.setState('connected')
  }

  /** Resolves once the channel can actually carry frames. */
  whenOpen(): Promise<void> {
    if (this.channel.readyState === 'open') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onClose = () => {
        cleanup()
        reject(new Error('The connection closed before it became usable.'))
      }
      const cleanup = () => {
        this.channel.removeEventListener('open', onOpen)
        this.channel.removeEventListener('close', onClose)
        this.pc.removeEventListener('connectionstatechange', onState)
      }
      const onState = () => {
        if (this.pc.connectionState === 'failed') onClose()
      }
      this.channel.addEventListener('open', onOpen)
      this.channel.addEventListener('close', onClose)
      this.pc.addEventListener('connectionstatechange', onState)
    })
  }

  state(): SyncTransportState {
    return this.current
  }

  onStateChange(listener: (state: SyncTransportState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onFrame(listener: (raw: string) => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onBinary(listener: (chunk: ArrayBuffer) => void): () => void {
    this.binaryListeners.add(listener)
    return () => this.binaryListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  sendText(text: string): void {
    if (this.closed || this.channel.readyState !== 'open') return
    this.channel.send(text)
  }

  sendBinary(chunk: Uint8Array): void {
    if (this.closed || this.channel.readyState !== 'open') return
    // Chunks are views into one asset buffer; `send` needs a view type whose
    // buffer is a plain ArrayBuffer, which every chunk produced by `chunkBytes`
    // already is.
    this.channel.send(chunk as Uint8Array<ArrayBuffer>)
  }

  bufferedAmount(): number {
    return this.channel.bufferedAmount
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearDisconnectTimer()
    try {
      this.channel.close()
    } catch {
      // Closing twice, or after the peer vanished, is not an error worth raising.
    }
    try {
      this.pc.close()
    } catch {
      // Same.
    }
  }

  private scheduleDisconnect(): void {
    if (this.disconnectTimer) return
    this.setState('connecting')
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null
      if (!this.closed) this.setState('disconnected')
    }, DISCONNECT_GRACE_MS)
  }

  private clearDisconnectTimer(): void {
    if (!this.disconnectTimer) return
    clearTimeout(this.disconnectTimer)
    this.disconnectTimer = null
  }

  private setState(state: SyncTransportState): void {
    if (this.current === state) return
    this.current = state
    for (const listener of this.stateListeners) listener(state)
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

/** Wait for every candidate to be in the SDP, with a bounded escape hatch. */
async function gatherComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      if (timer) clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    timer = setTimeout(finish, timeoutMs)
  })
}

function sdpOf(description: RTCSessionDescription | RTCSessionDescriptionInit | null): string {
  if (!description) return ''
  return typeof description.sdp === 'string' ? description.sdp : ''
}

/**
 * Closes a possibly-already-assigned transport. Taking the value as an argument
 * is deliberate: `transport` is only ever assigned inside a closure, so reading
 * it directly after an `await` makes the compiler believe it is still null.
 */
function closeTransport(transport: ChannelTransport | null): void {
  transport?.close()
}

function closePeer(pc: RTCPeerConnection): void {
  try {
    pc.close()
  } catch {
    // Already closed, or the fake in a test — not worth raising.
  }
}

export function createWebRtcPort(options: WebRtcOptions = {}): WebRtcPort {
  const createPeer = options.createPeer ?? defaultPeer
  const gatherTimeoutMs = options.gatherTimeoutMs ?? DEFAULT_GATHER_TIMEOUT_MS
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS

  async function createSession(
    role: 'host' | 'guest',
    identity: DeviceIdentity,
    incomingOffer: string | null,
  ): Promise<SyncHandshake> {
    const pc = createPeer()
    const createdAt = Date.now()
    let offerPayload: string | null = null
    let answerPayload: string | null = null
    let transport: ChannelTransport | null = null
    let settled = false
    let resolveReady: (transport: SyncTransportPort) => void = () => undefined
    let rejectReady: (error: Error) => void = () => undefined
    const ready = new Promise<SyncTransportPort>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A handshake that is torn down before anyone waited on it (the user closed
    // the panel) must not surface as an unhandled rejection. Awaiting callers
    // still see the error.
    ready.catch(() => undefined)
    const timeout = setTimeout(() => {
      settleFailure(
        new Error('The other device never connected. Create a new invitation and try again.'),
      )
      // An unanswered handshake must not leave a peer connection open forever.
      closeTransport(transport)
      closePeer(pc)
    }, readyTimeoutMs)

    function settleSuccess(opened: ChannelTransport): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveReady(opened)
    }

    function settleFailure(error: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectReady(error)
    }

    function attach(channel: RTCDataChannel): void {
      if (transport) {
        // A second channel for one session is not something we negotiate.
        channel.close()
        return
      }
      const opened = new ChannelTransport(pc, channel)
      transport = opened
      void opened
        .whenOpen()
        .then(() => settleSuccess(opened))
        .catch((cause: unknown) => settleFailure(cause instanceof Error ? cause : new Error('The connection failed.')))
    }

    function buildPayload(kind: 'offer' | 'answer', sdp: string): string {
      if (sdp.length === 0) {
        throw new SignalError('This browser could not describe the connection.')
      }
      const payload: SignalPayload = {
        v: 1,
        kind,
        sdp,
        name: identity.name,
        deviceId: identity.deviceId,
        createdAt,
      }
      return encodeSignal(payload)
    }

    try {
      if (role === 'host') {
        // The channel is created before the offer so the SCTP association is
        // negotiated as part of the same handshake.
        attach(pc.createDataChannel(SYNC_CHANNEL_LABEL, { ordered: true }))
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await gatherComplete(pc, gatherTimeoutMs)
        offerPayload = buildPayload('offer', sdpOf(pc.localDescription) || sdpOf(offer))
      } else {
        if (incomingOffer === null) throw new SignalError('An invitation is required to join.')
        const signal = decodeSignal(incomingOffer)
        // Wrong-device errors are reported before ageing ones: "that is a reply,
        // not an invitation" is what the user can act on when they pasted the
        // wrong string.
        if (signal.kind !== 'offer') {
          throw new SignalError(
            'That is a reply, not an invitation. Paste the payload the other device is showing.',
          )
        }
        // One-time pairing material: an offer photographed and replayed long
        // after the fact must not start a session.
        assertSignalFresh(signal)
        // Keep the offer's half of the exchange, re-encoded to the CANONICAL
        // form. Both devices hash these two strings into the comparison code,
        // so hashing whatever whitespace the transport left behind is exactly
        // how a valid pairing ends up rejected as a code mismatch (defect 3).
        offerPayload = encodeSignal(signal)
        pc.addEventListener('datachannel', (event: RTCDataChannelEvent) => attach(event.channel))
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await gatherComplete(pc, gatherTimeoutMs)
        answerPayload = buildPayload('answer', sdpOf(pc.localDescription) || sdpOf(answer))
      }
    } catch (cause) {
      // A failed setup must not leave a half-open peer connection behind.
      settleFailure(cause instanceof Error ? cause : new Error('The connection could not be prepared.'))
      closeTransport(transport)
      closePeer(pc)
      throw cause
    }

    return {
      role,
      payload(): string {
        const payload = role === 'host' ? offerPayload : answerPayload
        if (payload === null) throw new SignalError('The payload is not ready yet.')
        return payload
      },
      code(): string | null {
        // Known only once both halves of the exchange exist, which is why the
        // host's code appears after it accepts the reply.
        if (offerPayload === null || answerPayload === null) return null
        return pairingCode(offerPayload, answerPayload)
      },
      async accept(payload: string): Promise<void> {
        if (role !== 'host') {
          throw new SignalError('This device is joining — the other device ingests the reply.')
        }
        const signal = decodeSignal(payload)
        if (signal.kind !== 'answer') {
          throw new SignalError('That is an invitation, not a reply. Paste the payload the other device is showing.')
        }
        if (signal.deviceId === identity.deviceId) {
          throw new SignalError('That reply came from this same device.')
        }
        answerPayload = encodeSignal(signal)
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      },
      ready: () => ready,
      close(): void {
        if (!settled) settleFailure(new Error('Pairing was cancelled.'))
        transport?.close()
        closePeer(pc)
      },
    }
  }

  return {
    host: (identity) => createSession('host', identity, null),
    guest: (identity, offerPayload) => createSession('guest', identity, offerPayload),
  }
}
