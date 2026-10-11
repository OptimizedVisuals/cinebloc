import { z } from 'zod'

/**
 * The signalling payload (ADR 0005).
 *
 * This string IS the QR content: the user carries it from one device to the
 * other by whatever means they like. Two properties matter:
 *
 *   • it must survive being copied, texted or photographed, so it is a single
 *     line of base64url with a recognisable prefix and no whitespace;
 *   • it is untrusted input on the way in, so it is versioned and validated
 *     before an `RTCPeerConnection` ever sees the SDP.
 *
 * The SDP carries the DTLS fingerprints and the ICE `ufrag`/`pwd`, which is why
 * a payload is one session only. That, and not a design choice, is why
 * automatic reconnection needs a signalling endpoint this product does not have.
 */

export const SIGNAL_PREFIX = 'recbay-sync-v1.'

export const signalPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['offer', 'answer']),
  sdp: z.string().min(1),
  name: z.string(),
  deviceId: z.string().min(1),
  createdAt: z.number(),
})

export type SignalPayload = z.infer<typeof signalPayloadSchema>

export class SignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignalError'
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(withPadding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeSignal(payload: SignalPayload): string {
  return SIGNAL_PREFIX + toBase64Url(JSON.stringify(signalPayloadSchema.parse(payload)))
}

/**
 * Accepts a raw payload plus the small mistakes users actually make: pasted
 * whitespace and a line break inserted by a chat client mid-payload.
 */
export function decodeSignal(text: string): SignalPayload {
  const cleaned = text.replace(/\s+/g, '')
  if (cleaned.length === 0) throw new SignalError('Paste the payload from the other device first.')
  if (!cleaned.startsWith(SIGNAL_PREFIX)) {
    throw new SignalError('That does not look like a RecBay pairing payload.')
  }
  let json: string
  try {
    json = fromBase64Url(cleaned.slice(SIGNAL_PREFIX.length))
  } catch {
    throw new SignalError('That payload is incomplete — copy the whole thing and try again.')
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new SignalError('That payload is damaged — create a new one on the other device.')
  }
  const parsed = signalPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new SignalError('That payload came from a different version of the app.')
  }
  return parsed.data
}
