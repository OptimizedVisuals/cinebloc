import { describe, expect, it } from 'vitest'
import {
  PAIRING_LINK_FIELD,
  SIGNAL_PREFIX,
  SignalError,
  assertSignalFresh,
  canonicalSignal,
  decodeSignal,
  encodeSignal,
  extractPairingPayload,
  pairingLink,
  type SignalPayload,
} from '../payload'
import { PAIRING_TTL_MS } from '../pairing'

/**
 * The generator/parser contract behind the pairing QR (spec §3).
 *
 * These are the cases that made valid pairing data look invalid (defect 3):
 * a payload that arrived through a URL, a payload a chat client line-wrapped,
 * a payload with a sentence pasted after it, and the requirement that all of
 * them reduce to the *same* bytes — because those bytes are what the six-digit
 * comparison code is computed from on both devices.
 */

const BASE = 'https://recbay.example/'

function payload(overrides: Partial<SignalPayload> = {}): SignalPayload {
  return {
    v: 1,
    kind: 'offer',
    sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',
    name: 'My PC',
    deviceId: 'pc-1',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('pairing payload codec', () => {
  it('round-trips as a single copyable line', () => {
    const encoded = encodeSignal(payload())
    expect(encoded.startsWith(SIGNAL_PREFIX)).toBe(true)
    expect(encoded).not.toMatch(/\s/)
    expect(decodeSignal(encoded)).toMatchObject({ kind: 'offer', deviceId: 'pc-1' })
  })

  it('accepts the whitespace a chat client inserts anywhere in the payload', () => {
    const encoded = encodeSignal(payload({ kind: 'answer' }))
    const wrapped = `${encoded.slice(0, 40)}\n  ${encoded.slice(40, 90)}\r\n${encoded.slice(90)}\n`
    expect(decodeSignal(wrapped).kind).toBe('answer')
  })

  it('refuses a payload with prose glued to the end of it', () => {
    // Whitespace is a transport artefact and is ignored; prose is a different
    // string. Accepting it would mean guessing where the payload stops, and a
    // payload that can be guessed at cannot anchor the comparison code.
    const encoded = encodeSignal(payload())
    expect(() => decodeSignal(`${encoded}\n\nPaste this on the other device.`)).toThrow(
      /does not look like/i,
    )
  })

  it('accepts the RecBay link a scan produces, and gives back the same payload', () => {
    const encoded = encodeSignal(payload())
    const link = pairingLink(encoded, BASE)
    expect(link).toBe(`${BASE}#${PAIRING_LINK_FIELD}=${encoded}`)
    expect(extractPairingPayload(link)).toBe(encoded)
    expect(decodeSignal(link)).toMatchObject({ kind: 'offer', deviceId: 'pc-1' })
  })

  it('accepts a link that arrives with its field in the query string, or with neighbours', () => {
    const encoded = encodeSignal(payload())
    expect(decodeSignal(`${BASE}?pair=${encoded}&x=1`)).toMatchObject({ deviceId: 'pc-1' })
    expect(decodeSignal(`${BASE}#pair=${encoded}&keep=1`)).toMatchObject({ deviceId: 'pc-1' })
  })

  it('normalizes every accepted form to one canonical string (the code fix)', () => {
    const encoded = encodeSignal(payload())
    const link = pairingLink(encoded, BASE)
    const wrapped = `${encoded.slice(0, 30)}\n ${encoded.slice(30)}`
    const canonical = canonicalSignal(encoded)

    expect(canonical).toBe(encoded)
    expect(canonicalSignal(link)).toBe(canonical)
    expect(canonicalSignal(wrapped)).toBe(canonical)
    // The mangle was real: the raw transport form genuinely differs.
    expect(wrapped).not.toBe(canonical)
  })

  it('refuses everything that is not one of our payloads, in words', () => {
    expect(() => decodeSignal('')).toThrow(SignalError)
    expect(() => decodeSignal('   ')).toThrow(/does not look like/i)
    expect(() => decodeSignal('hello there')).toThrow(/does not look like/i)
    // An unrelated scanned URL must never be treated as a pairing link.
    expect(() => decodeSignal('https://example.com/')).toThrow(/does not look like/i)
    expect(() => decodeSignal('https://example.com/#pair=not-a-payload')).toThrow(
      /does not look like/i,
    )
    expect(() => decodeSignal(`${SIGNAL_PREFIX}!!!not-base64!!!`)).toThrow(/does not look like/i)
    // Valid base64, but not a payload this version understands.
    expect(() => decodeSignal(encodeForeign({ v: 2, kind: 'offer' }))).toThrow(/different version/i)
    // Truncated in the middle: damaged, not foreign.
    const encoded = encodeSignal(payload())
    expect(() => decodeSignal(`${encoded.slice(0, encoded.length - 6)}@@@@`)).toThrow(SignalError)
  })

  it('extracts nothing from a URL that merely mentions pair', () => {
    expect(extractPairingPayload('https://example.com/pair')).toBeNull()
    expect(extractPairingPayload('https://example.com/?pairing=x')).toBeNull()
    expect(extractPairingPayload('https://example.com/?pair=abc')).toBeNull()
  })

  it('builds links that replace a stale fragment and drop /index.html', () => {
    const encoded = encodeSignal(payload())
    const link = pairingLink(encoded, 'https://recbay.example/index.html')
    expect(link.startsWith(`https://recbay.example/#${PAIRING_LINK_FIELD}=`)).toBe(true)
    // An old fragment must not shadow the new payload.
    expect(pairingLink(encoded, `${BASE}#pair=stale`).startsWith(`${BASE}#pair=${SIGNAL_PREFIX}`)).toBe(
      true,
    )
    // Garbage in is not wrapped into a link at all.
    expect(pairingLink('not-a-payload', BASE)).toBe(BASE)
  })

  it('expires one-time pairing material, and only in the past', () => {
    const fresh = payload({ createdAt: 1_000 })
    expect(() => assertSignalFresh(fresh, 1_000 + PAIRING_TTL_MS)).not.toThrow()
    expect(() => assertSignalFresh(fresh, 1_000 + PAIRING_TTL_MS + 1)).toThrow(/expired/i)
    // A device with a fast clock is not an expired invitation.
    expect(() => assertSignalFresh(fresh, 500)).not.toThrow()
  })
})

/** A prefixed payload built from arbitrary JSON, to exercise the version guard. */
function encodeForeign(value: unknown): string {
  return SIGNAL_PREFIX + Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}
