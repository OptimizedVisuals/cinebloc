import type { DeviceIdentity, DevicePlatform } from '../sync/types'

/**
 * Sync ports (ADR 0005). Three deliberately separate seams so the transport
 * can be swapped or absent without touching the engine:
 *
 *   WebRtcPort       — peer-to-peer data channel (adapters/sync-webrtc)
 *   SignalingCarrier — how a one-shot SDP payload crosses devices:
 *                      QR/paste now (`qr`), an optional LAN helper later
 *                      (`local-bridge`). No hosted endpoint is ever wired in.
 *   LanBridgePort    — optional, user-controlled local service used *only*
 *                      for discovery and payload relay on the same subnet.
 *
 * Nothing here mentions ICE, SDP or STUN by name: those live inside adapters.
 */

export type SyncTransportState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed'

/**
 * An open, ordered, reliable pipe between two peers.
 *
 * Deliberately dumb: it moves *opaque* strings and bytes and interprets
 * nothing. The protocol owner is the engine (`state/sync/engine.ts`), which
 * serialises outbound messages and validates every inbound one with
 * `decodeMessage` before the data can reach storage or the store. A transport
 * that parsed frames itself would put the trust boundary in the wrong place
 * (and in the adapter, where the ADR forbids it).
 */
export interface SyncTransportPort {
  state(): SyncTransportState
  /** Subscribe to lifecycle changes; returns an unsubscribe function. */
  onStateChange(listener: (state: SyncTransportState) => void): () => void
  /** Inbound JSON frame, exactly as it arrived — the engine validates it. */
  onFrame(listener: (raw: string) => void): () => void
  /** Raw binary frames — asset chunks only, never records. */
  onBinary(listener: (chunk: ArrayBuffer) => void): () => void
  /** Transport-level failures: channel error, ICE failure, invalid frame. */
  onError(listener: (error: Error) => void): () => void
  /** Outbound JSON frame (the engine has already encoded it). */
  sendText(text: string): void
  sendBinary(chunk: Uint8Array): void
  /** Bytes queued on the channel — the engine throttles on this. */
  bufferedAmount(): number
  close(): void
}

/**
 * One WebRTC session in progress. The host creates the offer (what the
 * signalling payload carries); the guest consumes it and produces the answer.
 * Neither side needs a second scan to *use* the channel once both payloads
 * have crossed.
 */
export interface SyncHandshake {
  role: 'host' | 'guest'
  /** Payload for the peer: offer when hosting, answer when joining. */
  payload(): string
  /**
   * Short code both devices display for the user to compare. Derived from
   * both payloads, so the host only knows it once `accept()` has run — hence
   * `null` rather than an invented value before then.
   */
  code(): string | null
  /** Ingest the peer's payload. */
  accept(payload: string): Promise<void>
  /** Resolves once the data channel is open and usable. */
  ready(): Promise<SyncTransportPort>
  close(): void
}

export interface WebRtcPort {
  /** Host: no server, no STUN — LAN host candidates only. */
  host(identity: DeviceIdentity): Promise<SyncHandshake>
  /** Guest: ingest the host's offer payload and answer it. */
  guest(identity: DeviceIdentity, offerPayload: string): Promise<SyncHandshake>
}

export type SignalingCarrierKind = 'qr' | 'local-bridge'

/** A way to move one signalling payload between two nearby devices. */
export interface SignalingCarrier {
  readonly kind: SignalingCarrierKind
  /** True when this device can use the carrier right now (camera, bridge up). */
  available(): Promise<boolean>
}

/** A device the local helper can see on this subnet. */
export interface NearbyDevice {
  deviceId: string
  name: string
  platform: DevicePlatform
  lastSeenAt: number
}

/** A payload waiting to be picked up by the other device. */
export interface BridgeEnvelope {
  sessionId: string
  fromDeviceId: string
  payload: string
}

/**
 * Optional local helper (user-run, same machine or LAN — never RecBay's).
 * Every method must fail softly: `available()` false means the app simply
 * falls back to QR/paste pairing and no automatic reconnection.
 */
export interface LanBridgePort {
  available(): Promise<boolean>
  /** Advertise this device so neighbours can reconnect without a scan. */
  announce(identity: DeviceIdentity): Promise<void>
  /** Trusted neighbours currently advertising themselves. */
  listNearby(): Promise<NearbyDevice[]>
  /** Publish a payload for one specific device. */
  publish(toDeviceId: string, payload: string): Promise<string>
  /** Long-poll for a payload addressed to this device. */
  fetchFor(deviceId: string): Promise<BridgeEnvelope | null>
  /** Ack/clear an envelope so it is never delivered twice. */
  consume(sessionId: string): Promise<void>
}

/** Ops the engine has queued but not yet acknowledged by every peer. */
export interface PendingOpsSummary {
  total: number
  byPeer: Record<string, number>
}
