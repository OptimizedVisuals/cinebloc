/**
 * Pairing verification (ADR 0005).
 *
 * Both peers know both signaling payloads (each generated one and received
 * the other), so both can derive the *same* short code with no extra round
 * trip. Showing it on both screens lets the user confirm they are looking at
 * their own two devices — the string is an integrity mark, not a secret, and
 * the transport is already DTLS-encrypted by WebRTC.
 */

/** FNV-1a, 32-bit. Tiny, dependency-free and identical on both devices. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Deterministic 6-digit code. The two payloads are ordered before hashing so
 * the host and the guest compute an identical value.
 */
export function pairingCode(a: string, b: string): string {
  const [first, second] = a <= b ? [a, b] : [b, a]
  const digest = fnv1a(`${fnv1a(first).toString(36)}|${fnv1a(second).toString(36)}|recbay-sync`)
  return String(digest % 1_000_000).padStart(6, '0')
}

/** "582941" → "582 941" — two groups are easier to read out loud. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/\D/g, '').padStart(6, '0').slice(0, 6)
  return `${clean.slice(0, 3)} ${clean.slice(3)}`
}

/**
 * Pairing sessions expire (spec §14): a QR photographed across the room must
 * not stay usable. Two minutes is long enough to unlock a phone and scan.
 */
export const PAIRING_TTL_MS = 2 * 60 * 1000

export function pairingExpired(createdAt: number, now: number): boolean {
  return now - createdAt > PAIRING_TTL_MS
}

export function pairingSecondsLeft(createdAt: number, now: number): number {
  return Math.max(0, Math.ceil((createdAt + PAIRING_TTL_MS - now) / 1000))
}
