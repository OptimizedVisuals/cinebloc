/**
 * Content hashing for asset transfer (ADR 0005).
 *
 * A peer is untrusted input, so `ASSET_START.hash` is not decoration: the
 * receiver recomputes SHA-256 over the assembled bytes and refuses to store
 * anything that does not match. That is what makes a truncated or interleaved
 * transfer a *detectable* failure instead of a silently corrupt still.
 *
 * `crypto.subtle` is secure-context-only, which is the same constraint that
 * already gates device identity — asset sync therefore inherits the documented
 * "HTTPS or localhost" requirement rather than inventing a second one.
 */

const HEX = /^[0-9a-f]{64}$/

export class HashUnavailableError extends Error {
  constructor() {
    super('Asset verification needs a secure context (HTTPS or localhost) for SHA-256.')
    this.name = 'HashUnavailableError'
  }
}

export function isSha256Hex(value: string): boolean {
  return HEX.test(value)
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Lower-case hex SHA-256, exactly 64 chars — the wire format for asset hashes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new HashUnavailableError()
  // A fresh view over exactly these bytes: passing a subarray view straight in
  // would hash the whole underlying buffer for some implementations.
  const digest = await subtle.digest('SHA-256', bytes.slice())
  return bytesToHex(new Uint8Array(digest))
}
