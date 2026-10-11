import { describe, expect, it } from 'vitest'
import { ASSET_CHUNK_BYTES, chunkBytes, type AssetMeta } from '@/kernel'
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_INFLIGHT,
  AssetAssembler,
  verifyAssembled,
} from '../assetTransfer'
import { sha256Hex } from '../hash'

function meta(size: number, hash = 'a'.repeat(64)): AssetMeta {
  return { key: 'shot/frame.png', size, type: 'image/png', hash, shotId: null }
}

describe('asset assembly', () => {
  it('reassembles a multi-chunk asset byte for byte', async () => {
    const bytes = new Uint8Array(ASSET_CHUNK_BYTES * 2 + 5).map((_, i) => i % 251)
    const hash = await sha256Hex(bytes)
    const assembler = new AssetAssembler()
    expect(assembler.start(meta(bytes.byteLength, hash))).toBe(true)

    const chunks = chunkBytes(bytes)
    expect(chunks).toHaveLength(3)
    expect(assembler.push(chunks[0])).toBe('buffering')
    expect(assembler.push(chunks[1])).toBe('buffering')
    expect(assembler.push(chunks[2])).toBe('complete')

    const assembled = assembler.finish()
    expect(assembled).not.toBeNull()
    expect(assembled!.bytes).toEqual(bytes)
    expect(await sha256Hex(assembled!.bytes)).toBe(hash)
  })

  it('stores nothing when the bytes do not match the declared hash', async () => {
    const original = new Uint8Array(1000).fill(7)
    const tampered = original.slice()
    tampered[10] = 8
    const assembler = new AssetAssembler()
    assembler.start(meta(1000, await sha256Hex(original)))
    assembler.push(tampered)
    const assembled = assembler.finish()

    expect(assembled).not.toBeNull()
    expect(await verifyAssembled(assembled!)).toBeNull()
  })

  it('hands back a Blob only when the hash matches', async () => {
    const bytes = new TextEncoder().encode('a real frame')
    const assembler = new AssetAssembler()
    assembler.start(meta(bytes.byteLength, await sha256Hex(bytes)))
    assembler.push(bytes)
    const blob = await verifyAssembled(assembler.finish()!)
    expect(blob).not.toBeNull()
    expect(await blob!.text()).toBe('a real frame')
  })

  it('abandons a stream that ends short instead of storing a partial image', () => {
    const assembler = new AssetAssembler()
    assembler.start(meta(100))
    expect(assembler.push(new Uint8Array(40))).toBe('buffering')
    expect(assembler.finish()).toBeNull()
    // The stream is gone, so a stray chunk cannot be glued onto the next one.
    expect(assembler.active()).toBe(false)
    expect(assembler.push(new Uint8Array(10))).toBe('skipped')
  })

  it('refuses a chunk longer than the declared remainder', () => {
    const assembler = new AssetAssembler()
    assembler.start(meta(10))
    expect(assembler.push(new Uint8Array(20))).toBe('overflow')
    expect(assembler.finish()).toBeNull()
  })

  it('drops an oversized asset but keeps consuming its bytes so framing survives', () => {
    const assembler = new AssetAssembler()
    expect(assembler.start(meta(ASSET_MAX_BYTES + 1))).toBe(false)
    // Every frame is swallowed rather than buffered: no memory is held.
    expect(assembler.push(new Uint8Array(ASSET_CHUNK_BYTES))).toBe('skipped')
    expect(assembler.push(new Uint8Array(ASSET_CHUNK_BYTES))).toBe('skipped')
    expect(assembler.finish()).toBeNull()

    // The next, sane asset still assembles correctly.
    expect(assembler.start(meta(4))).toBe(true)
    expect(assembler.push(new Uint8Array(4))).toBe('complete')
    expect(assembler.finish()!.bytes.byteLength).toBe(4)
  })

  it('rejects a declaration that cannot be trusted in the first place', () => {
    const assembler = new AssetAssembler()
    expect(assembler.start(meta(Number.NaN))).toBe(false)
    expect(assembler.start(meta(-5))).toBe(false)
  })

  it('gives up on a stream that never reaches its declared size', () => {
    const assembler = new AssetAssembler()
    assembler.start(meta(ASSET_MAX_BYTES))
    let outcome = 'buffering'
    for (let i = 0; i < ASSET_MAX_INFLIGHT + 2 && outcome === 'buffering'; i++) {
      outcome = assembler.push(new Uint8Array(1))
    }
    expect(outcome).toBe('overflow')
    expect(assembler.active()).toBe(false)
  })

  it('ignores a chunk that arrives with no stream in progress', () => {
    const assembler = new AssetAssembler()
    expect(assembler.push(new Uint8Array(10))).toBe('skipped')
  })
})
