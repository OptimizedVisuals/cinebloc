import { z } from 'zod'
import { PAIRING_TTL_MS } from './pairing'

/**
 * The pairing payload and every form it travels in (ADR 0005, spec §3).
 *
 * This module is the *single* contract behind QR generation and QR parsing.
 * It lives in the kernel for two reasons:
 *
 *   • the payload is the same string on both devices, so the six-digit
 *     comparison code derived from it has to be derived from a canonical
 *     encoding, not from whatever formatting the transport happened to leave;
 *   • the feature that renders the QR is not allowed to import an adapter, so
 *     the wire format cannot live in `adapters/sync-webrtc` alone.
 *
 * There are exactly two accepted forms, and one canonical output:
 *
 *   bare   `recbay-sync-v1.<base64url>`          — what goes over the wire
 *   link   `https://…/#pair=recbay-sync-v1.<…>`  — what goes in the QR code
 *
 * The link exists so a scan can come *back into the app*: a QR that holds an
 * opaque string is unreadable to the phone's own camera app, which falls back
 * to a web search, and nothing on the receiving side can route it (defect 2).
 * The payload is carried in the fragment on purpose — a fragment is never sent
 * to a server, never appears in a Referer, and cannot end up in an access log.
 *
 * Everything else is refused with a specific explanation. A parser that
 * accepted "any string that looks close enough" would defeat the point of the
 * comparison code, which only means something if both sides hashed the same
 * bytes.
 */

export const SIGNAL_PREFIX = 'recbay-sync-v1.'

/** The fragment/query field a RecBay pairing link uses. */
export const PAIRING_LINK_FIELD = 'pair'

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

/** A payload body is base64url and nothing else — no spaces, no punctuation. */
const BODY_RE = /^[A-Za-z0-9\-_]+$/

function canonicalBare(text: string): string | null {
  const cleaned = text.replace(/\s+/g, '')
  if (!cleaned.startsWith(SIGNAL_PREFIX)) return null
  const body = cleaned.slice(SIGNAL_PREFIX.length)
  // The body must be base64url end to end. Trailing prose is deliberately NOT
  // tolerated: once whitespace is removed, "…payload" and "Please scan this"
  // are the same kind of characters, so finding where the payload stops would
  // mean guessing — and guessing is how a parser starts accepting strings it
  // should refuse. The copy buttons hand over the exact payload instead.
  if (!BODY_RE.test(body)) return null
  return SIGNAL_PREFIX + body
}

function payloadFromLink(text: string): string | null {
  const marker = `${PAIRING_LINK_FIELD}=`
  for (const start of [text.indexOf('#'), text.indexOf('?')]) {
    if (start < 0) continue
    for (const field of text.slice(start + 1).split('&')) {
      if (!field.startsWith(marker)) continue
      let value = field.slice(marker.length)
      try {
        value = decodeURIComponent(value)
      } catch {
        return null // malformed percent-encoding is a broken link, not a payload
      }
      const bare = canonicalBare(value)
      if (bare !== null) return bare
    }
  }
  return null
}

/**
 * Reduce any accepted form — a RecBay link, or a bare payload with transport
 * whitespace — to the one canonical string. Returns null when the text is not a
 * RecBay pairing payload at all, so a caller never has to guess whether a
 * scanned URL is one of ours.
 */
export function extractPairingPayload(text: string): string | null {
  const raw = text.trim()
  if (raw.length === 0) return null
  return payloadFromLink(raw) ?? canonicalBare(raw)
}

/** The link to put in a QR code, so the phone's camera app can open the app. */
export function pairingLink(barePayload: string, baseUrl: string): string {
  const bare = extractPairingPayload(barePayload)
  if (bare === null) return baseUrl
  // Keep the origin and path, drop any existing query/fragment: the fragment
  // is ours and a stale one would shadow the pairing payload.
  const base = `${baseUrl.split('#')[0]?.split('?')[0] ?? baseUrl}`.replace(/\/index\.html$/, '/')
  return `${base}#${PAIRING_LINK_FIELD}=${bare}`
}

/** Canonical encoding — the only string that is ever hashed into a code. */
export function encodeSignal(payload: SignalPayload): string {
  return SIGNAL_PREFIX + toBase64Url(JSON.stringify(signalPayloadSchema.parse(payload)))
}

/**
 * Validate anything that arrives from outside: a scan, a paste, a deep link.
 * Structural only — expiry is a separate, explicit check (`assertSignalFresh`)
 * so that clock skew between two devices can never silently reject a good
 * reply.
 */
export function decodeSignal(text: string): SignalPayload {
  const extracted = extractPairingPayload(text)
  if (extracted === null) {
    throw new SignalError('That does not look like a RecBay pairing payload.')
  }
  let json: string
  try {
    json = fromBase64Url(extracted.slice(SIGNAL_PREFIX.length))
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

/**
 * The canonical string for a payload, whoever produced it. Both peers store
 * *this* value, which is the actual fix for code mismatches: the comparison
 * code is a hash of the two canonical payloads, so it no longer depends on the
 * whitespace a chat client inserted on the way over.
 */
export function canonicalSignal(text: string): string {
  return encodeSignal(decodeSignal(text))
}

/** One-time pairing material expires; replayed or photographed codes die. */
export function assertSignalFresh(
  payload: SignalPayload,
  now: number = Date.now(),
  ttlMs: number = PAIRING_TTL_MS,
): void {
  // A payload stamped in the future (a device with a fast clock) is fresh, not
  // expired: only material older than the window is refused.
  if (now - payload.createdAt > ttlMs) {
    throw new SignalError('This invitation expired — create a new one on the other device.')
  }
}
