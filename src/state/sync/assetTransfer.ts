import { ASSET_CHUNK_BYTES, type AssetMeta } from '@/kernel'
import { sha256Hex } from './hash'

/**
 * Asset byte transfer (ADR 0005).
 *
 * Framing is deliberately *length-driven*: `ASSET_START` carries the exact
 * size, so the receiver knows when a stream ends without an end marker and a
 * stray chunk from a previous session can never be glued onto the next asset.
 * Bytes then arrive as binary frames — never base64 inside JSON, which would
 * inflate every still by a third.
 *
 * Two bounds keep a hostile or broken peer from hurting this device:
 *   • `ASSET_MAX_BYTES` — anything larger is discarded (and the chunks that
 *     follow it are consumed and dropped, so framing stays in sync);
 *   • `ASSET_MAX_INFLIGHT` — a stream that never reaches its declared size is
 *     abandoned rather than buffered forever.
 */

/**
 * Largest single asset either side will move or store. Generous for
 * screenshots (the app's own demo frames are tens of KB) and small enough that
 * a lying peer cannot exhaust memory.
 */
export const ASSET_MAX_BYTES = 64 * 1024 * 1024

/** Chunks accepted for one stream before it is abandoned as stuck. */
export const ASSET_MAX_INFLIGHT = Math.ceil(ASSET_MAX_BYTES / ASSET_CHUNK_BYTES) + 64

export type AssemblerOutcome = 'buffering' | 'complete' | 'skipped' | 'overflow'

export interface AssembledAsset {
  meta: AssetMeta
  /** Owned buffer (not a view), so it can be handed straight to `Blob`. */
  bytes: Uint8Array<ArrayBuffer>
}

/**
 * Reassembles exactly one asset stream at a time. Single-stream by design: the
 * protocol never interleaves two assets, and allowing it would be new attack
 * surface for no benefit.
 */
export class AssetAssembler {
  private meta: AssetMeta | null = null
  private parts: Uint8Array[] = []
  private received = 0
  private frames = 0
  private discard = false
  private overflowed = false

  /** Begin a stream. Returns false when the declaration itself is unusable. */
  start(meta: AssetMeta): boolean {
    this.reset()
    if (!Number.isFinite(meta.size) || meta.size < 0) {
      this.discard = true
      return false
    }
    this.meta = meta
    // Too large to accept, or already inconsistent with itself: consume the
    // bytes so the next asset's framing is not corrupted, then drop them.
    this.discard = meta.size > ASSET_MAX_BYTES
    return !this.discard
  }

  active(): boolean {
    return this.meta !== null
  }

  expected(): number | null {
    return this.meta?.size ?? null
  }

  receivedBytes(): number {
    return this.received
  }

  /**
   * Feed one binary frame. Returns 'complete' once the declared size is
   * reached; `finish()` then yields the bytes for verification.
   */
  push(chunk: Uint8Array): AssemblerOutcome {
    const meta = this.meta
    if (!meta) return 'skipped' // a chunk with no stream: ignore, never guess

    this.frames += 1
    if (this.frames > ASSET_MAX_INFLIGHT) {
      this.overflowed = true
      this.reset()
      return 'overflow'
    }

    const remaining = meta.size - this.received
    if (remaining <= 0) return this.discard ? 'skipped' : 'complete'

    // A chunk longer than the declared remainder is a protocol violation.
    // Take only what was promised and drop the stream rather than storing a
    // blob whose length cannot match its hash.
    const take = Math.min(chunk.byteLength, remaining)
    if (!this.discard && take > 0) this.parts.push(chunk.subarray(0, take))
    this.received += take
    if (chunk.byteLength > take) {
      this.discard = true
      return 'overflow'
    }
    // Discarded streams still consume their declared bytes so the next asset's
    // framing stays intact — but nothing is ever buffered for them.
    if (this.discard) return 'skipped'
    return this.received < meta.size ? 'buffering' : 'complete'
  }

  /** Bytes assembled so far; null when the stream was discarded. */
  finish(): AssembledAsset | null {
    const meta = this.meta
    if (!meta || this.discard || this.received !== meta.size) {
      this.reset()
      return null
    }
    const bytes = new Uint8Array(this.received)
    let offset = 0
    for (const part of this.parts) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    this.reset()
    return { meta, bytes }
  }

  /** Abandon the current stream (peer disconnected mid-asset). */
  reset(): void {
    this.meta = null
    this.parts = []
    this.received = 0
    this.frames = 0
    this.discard = false
    this.overflowed = false
  }

  /** True when the last `push` abandoned a stream for being out of bounds. */
  overflowedStream(): boolean {
    return this.overflowed
  }
}

/**
 * Verify assembled bytes against the declared hash and hand back a Blob.
 * Returns null when the content does not match — the caller must not store it.
 */
export async function verifyAssembled(assembled: AssembledAsset): Promise<Blob | null> {
  const actual = await sha256Hex(assembled.bytes)
  if (actual !== assembled.meta.hash) return null
  return new Blob([assembled.bytes], { type: assembled.meta.type || 'application/octet-stream' })
}
