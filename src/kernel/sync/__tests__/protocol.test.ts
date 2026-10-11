import { describe, expect, it } from 'vitest'
import {
  ASSET_CHUNK_BYTES,
  RECORD_BATCH_LIMIT,
  SYNC_PROTOCOL_VERSION,
  chunkBytes,
  chunkRecords,
  collectAssetMetas,
  decodeMessage,
  encodeMessage,
  isCompatibleProtocol,
  syncedSettingsSchema,
  SyncProtocolError,
  type SyncMessage,
} from '../protocol'
import type { SyncManifest, SyncOperation } from '../types'

const manifest: SyncManifest = {
  protocol: 1,
  deviceId: 'pc-1',
  name: "Titan's PC",
  platform: 'desktop',
  projects: 24,
  shots: 186,
  assets: 186,
  bytes: 42_800_000,
  cursors: { 'phone-1': 12 },
  snapshots: { 'phone-1': 0 },
}

const operation: SyncOperation = {
  id: 'op-1',
  seq: 13,
  deviceId: 'pc-1',
  entity: 'project',
  entityId: 'proj-1',
  operation: 'update',
  data: { id: 'proj-1', title: 'Rain Diner' },
  version: { counter: 13, deviceId: 'pc-1' },
  timestamp: 1_700_000_000_000,
}

describe('sync protocol', () => {
  it('round-trips a hello and an op batch', () => {
    const hello: SyncMessage = {
      t: 'HELLO',
      device: { deviceId: 'pc-1', name: "Titan's PC", platform: 'desktop', createdAt: 1 },
      manifest,
      code: '582941',
    }
    const batch: SyncMessage = { t: 'OPS_BATCH', ops: [operation], more: false }

    for (const message of [hello, batch]) {
      expect(decodeMessage(encodeMessage(message))).toEqual(message)
    }
  })

  it('refuses a greeting without the pairing code the two devices compare', () => {
    const noCode = {
      t: 'HELLO',
      device: { deviceId: 'pc-1', name: 'PC', platform: 'desktop', createdAt: 1 },
      manifest,
    }
    expect(() => decodeMessage(JSON.stringify(noCode))).toThrow(SyncProtocolError)
  })

  it('rejects a peer built on a different protocol generation', () => {
    expect(isCompatibleProtocol(SYNC_PROTOCOL_VERSION)).toBe(true)
    expect(isCompatibleProtocol(SYNC_PROTOCOL_VERSION + 1)).toBe(false)
    expect(isCompatibleProtocol(0)).toBe(false)
  })

  it('splits asset bytes into bounded chunks without copying the buffer', () => {
    const bytes = new Uint8Array(ASSET_CHUNK_BYTES * 2 + 7)
    const chunks = chunkBytes(bytes)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].byteLength).toBe(ASSET_CHUNK_BYTES)
    expect(chunks[2].byteLength).toBe(7)
    // Views, not copies: chunking a 4 MB still must not allocate 4 MB.
    expect(chunks[0].buffer).toBe(bytes.buffer)
  })

  it('rejects malformed and unknown frames instead of trusting the peer', () => {
    expect(() => decodeMessage('not json')).toThrow(SyncProtocolError)
    expect(() => decodeMessage('{"t":"WHATEVER"}')).toThrow(SyncProtocolError)
    expect(() => decodeMessage(JSON.stringify({ t: 'OPS_BATCH', ops: [{ nope: true }] }))).toThrow(
      SyncProtocolError,
    )
  })

  it('never carries the API key: only board_mode survives the settings whitelist', () => {
    const parsed = syncedSettingsSchema.parse({
      board_mode: 'fast',
      api_key: 'sk-secret',
      provider: 'openai',
      model: 'gpt-4o',
      base_url: 'https://example.test',
      viewport: 'mobile',
    })
    expect(parsed).toEqual({ board_mode: 'fast' })
    expect(JSON.stringify(parsed)).not.toContain('sk-secret')
  })

  it('batches records so no message becomes one giant document', () => {
    const records = Array.from({ length: RECORD_BATCH_LIMIT + 5 }, (_, i) => i)
    const batches = chunkRecords(records)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(RECORD_BATCH_LIMIT)
    expect(batches[1]).toHaveLength(5)
  })

  it('keeps asset chunks far below the SCTP message limit', () => {
    expect(ASSET_CHUNK_BYTES).toBeLessThanOrEqual(16 * 1024)
  })

  it('treats an empty asset as zero chunks rather than one empty frame', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([])
  })

  it('collects unique asset keys from shots', () => {
    expect(
      collectAssetMetas([{ asset_refs: ['a', 'b'] }, { asset_refs: ['b', 'c'] }, { asset_refs: [] }]),
    ).toEqual(['a', 'b', 'c'])
  })
})
