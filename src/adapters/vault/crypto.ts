/**
 * WebCrypto primitives for the local vault: PBKDF2-SHA256 key derivation
 * and AES-GCM authenticated encryption. No dependencies — runs in every
 * modern browser and in Node ≥19 (tests).
 *
 * Envelope formats:
 *   JSON values → { e: 1, iv: <b64>, d: <b64> }
 *   Blobs       → b"CVLT" (magic) | iv (12 bytes) | ciphertext
 */

const PBKDF2_ITERATIONS = 310_000 // OWASP recommendation for PBKDF2-HMAC-SHA256
const IV_BYTES = 12
const MAGIC = new TextEncoder().encode('CVLT')

export interface JsonEnvelope {
  e: 1
  iv: string
  d: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function isJsonEnvelope(value: unknown): value is JsonEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return v['e'] === 1 && typeof v['iv'] === 'string' && typeof v['d'] === 'string'
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — the key never leaves this process
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<JsonEnvelope> {
  const iv = randomBytes(IV_BYTES)
  const plaintext = textEncoder.encode(JSON.stringify(value))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource),
  )
  return { e: 1, iv: bytesToB64(iv), d: bytesToB64(ct) }
}

export async function decryptJson<T>(key: CryptoKey, envelope: JsonEnvelope): Promise<T> {
  const iv = b64ToBytes(envelope.iv)
  const ct = b64ToBytes(envelope.d)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  )
  return JSON.parse(textDecoder.decode(plaintext)) as T
}

export async function encryptBlob(key: CryptoKey, blob: Blob): Promise<Blob> {
  const iv = randomBytes(IV_BYTES)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource),
  )
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length)
  out.set(MAGIC, 0)
  out.set(iv, MAGIC.length)
  out.set(ct, MAGIC.length + iv.length)
  return new Blob([out as BlobPart], { type: 'application/octet-stream' })
}

export async function decryptBlob(key: CryptoKey, blob: Blob): Promise<Blob> {
  const all = new Uint8Array(await blob.arrayBuffer())
  if (all.length < MAGIC.length + IV_BYTES + 16) throw new Error('Encrypted blob is truncated')
  for (let i = 0; i < MAGIC.length; i++) {
    if (all[i] !== MAGIC[i]) throw new Error('Encrypted blob is corrupted (bad magic)')
  }
  const iv = all.subarray(MAGIC.length, MAGIC.length + IV_BYTES)
  const ct = all.subarray(MAGIC.length + IV_BYTES)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  )
  return new Blob([plaintext as BlobPart], { type: 'application/octet-stream' })
}

/** Wrong passwords and tampered data both fail here (AES-GCM auth). */
export class VaultCryptoError extends Error {
  constructor(message = 'Wrong password or corrupted data') {
    super(message)
    this.name = 'VaultCryptoError'
  }
}
