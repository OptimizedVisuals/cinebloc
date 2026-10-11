/**
 * Signalling payload surface for the WebRTC adapter.
 *
 * The codec itself lives in the kernel (`kernel/sync/payload.ts`) because the
 * payload is also what the QR code carries and what the feature layer links to,
 * and a feature may not import an adapter. This module keeps the adapter's
 * public names stable for its callers and tests, and states the transport's
 * side of the contract: what this adapter *must* verify before an
 * `RTCPeerConnection` ever sees an SDP.
 *
 * Rules the adapter applies (see `./index.ts`):
 *   • decode, never trust — a payload is untrusted input;
 *   • re-encode to the canonical form before storing it, so the six-digit code
 *     is a hash of identical bytes on both devices;
 *   • refuse one-time pairing material older than the pairing window.
 */

export {
  PAIRING_LINK_FIELD,
  SIGNAL_PREFIX,
  SignalError,
  assertSignalFresh,
  canonicalSignal,
  decodeSignal,
  encodeSignal,
  extractPairingPayload,
  pairingLink,
  signalPayloadSchema,
  type SignalPayload,
} from '@/kernel'
