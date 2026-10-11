import { z } from 'zod'
import { projectSchema, shotSchema } from '../schema'
import type { SyncManifest, SyncOperation, SyncStats } from './types'

/**
 * Explicit peer protocol (ADR 0005). Records travel as validated JSON
 * envelopes in batches; asset bytes travel as binary frames on the same data
 * channel — never base64 inside a JSON message.
 *
 * Handshake → HELLO (host) · WELCOME (guest)
 * First     → SNAPSHOT_START · SNAPSHOT_PROJECTS/SHOTS/SETTINGS…
 *             (only when the peer holds nothing)
 * Later     → REQUEST_OPS · OPS_BATCH… · ACK · SYNC_COMPLETE
 * Assets    → REQUEST_ASSETS · ASSET_START · [exactly `size` bytes] · ASSET_END
 *
 * Two direction conventions are load-bearing and easy to get backwards:
 *   • ACK is receiver → sender: "here are the cursors I have durably applied".
 *     It doubles as a pull request, so a sender can close a gap that opened
 *     while the exchange was running.
 *   • ASSET_END is receiver → sender: a receipt that the bytes were written
 *     to storage AND their SHA-256 matched. ASSET_START carries `size`, so the
 *     receiver knows exactly how many bytes belong to the stream and does not
 *     need an end-of-stream marker.
 */

export const SYNC_PROTOCOL_VERSION = 1

/** 16 KiB is comfortably under every browser's SCTP limit and keeps the UI responsive. */
export const ASSET_CHUNK_BYTES = 16 * 1024

/** Cap per JSON envelope so no message becomes "one giant JSON document". */
export const RECORD_BATCH_LIMIT = 64

const versionSchema = z.object({
  counter: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
})

const platformSchema = z.enum(['desktop', 'mobile', 'tablet'])

export const deviceIdentitySchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  platform: platformSchema,
  createdAt: z.number(),
})

export const manifestSchema = z.object({
  protocol: z.number().int().positive(),
  deviceId: z.string().min(1),
  name: z.string(),
  platform: platformSchema,
  projects: z.number().int().nonnegative(),
  shots: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
  cursors: z.record(z.number()),
  snapshots: z.record(z.number()),
})

export const assetMetaSchema = z.object({
  key: z.string().min(1),
  size: z.number().nonnegative(),
  type: z.string(),
  hash: z.string().min(1),
  shotId: z.string().nullable(),
})

export const syncOperationSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  entity: z.enum(['project', 'shot', 'settings', 'asset']),
  entityId: z.string().min(1),
  parentId: z.string().optional(),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.unknown().optional(),
  version: versionSchema,
  timestamp: z.number(),
  asset: assetMetaSchema.optional(),
})

export const syncStatsSchema = z.object({
  recordsReceived: z.number().int().nonnegative(),
  recordsSent: z.number().int().nonnegative(),
  assetsReceived: z.number().int().nonnegative(),
  assetsSent: z.number().int().nonnegative(),
  bytesReceived: z.number().nonnegative(),
  bytesSent: z.number().nonnegative(),
})

/**
 * The only slice of Settings that is shared. `api_key`, `provider`, `model`,
 * `base_url` and `viewport` are device-local and must never leave the device
 * (spec §14 — no secret, no provider config on the wire).
 */
export const syncedSettingsSchema = z.object({
  board_mode: z.enum(['default', 'fast', 'custom', 'blend']),
})
export type SyncedSettings = z.infer<typeof syncedSettingsSchema>

export const snapshotProjectsSchema = z.object({
  projects: z.array(projectSchema),
  more: z.boolean(),
})

/**
 * Shots are stored *per project* (`StoragePort.saveShots(projectId, …)`) and a
 * Shot carries no project id of its own, so a snapshot batch names the project
 * it belongs to. Reusing the op shape's `parentId` here would have been
 * ambiguous for the very first sync, when the receiver knows no projects yet.
 */
export const snapshotShotsSchema = z.object({
  projectId: z.string().min(1),
  shots: z.array(shotSchema),
  more: z.boolean(),
})

export type SyncMessage =
  | { t: 'HELLO'; device: unknown; manifest: SyncManifest; code: string }
  | { t: 'WELCOME'; device: unknown; manifest: SyncManifest; code: string }
  | { t: 'REQUEST_OPS'; cursors: Record<string, number> }
  | { t: 'REQUEST_ASSETS'; keys: string[] }
  | { t: 'OPS_BATCH'; ops: SyncOperation[]; more: boolean }
  | { t: 'REQUEST_SNAPSHOT' }
  | {
      t: 'SNAPSHOT_START'
      projects: number
      shots: number
      assets: number
      bytes: number
      /**
       * The sender's logical clock at snapshot time. Records carry no version
       * field, so without this the receiver's clock would stay at zero and its
       * very next edit (counter 1) would lose to the snapshot it just adopted —
       * the classic Lamport receive rule, applied to a bulk transfer.
       */
      clock: number
    }
  | { t: 'SNAPSHOT_PROJECTS'; projects: z.infer<typeof projectSchema>[]; more: boolean }
  | {
      t: 'SNAPSHOT_SHOTS'
      projectId: string
      shots: z.infer<typeof shotSchema>[]
      more: boolean
    }
  | { t: 'SNAPSHOT_SETTINGS'; settings: SyncedSettings }
  | { t: 'ASSET_START'; asset: z.infer<typeof assetMetaSchema> }
  | { t: 'ASSET_END'; key: string; hash: string }
  | { t: 'ACK'; cursors: Record<string, number>; lastSyncAt: number }
  | { t: 'SYNC_COMPLETE'; stats: SyncStats }
  | { t: 'PING'; at: number }
  | { t: 'PONG'; at: number }
  | { t: 'ERROR'; message: string }

export const syncMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('HELLO'),
    device: deviceIdentitySchema,
    manifest: manifestSchema,
    code: z.string(),
  }),
  z.object({
    t: z.literal('WELCOME'),
    device: deviceIdentitySchema,
    manifest: manifestSchema,
    code: z.string(),
  }),
  z.object({ t: z.literal('REQUEST_OPS'), cursors: z.record(z.number()) }),
  z.object({ t: z.literal('REQUEST_ASSETS'), keys: z.array(z.string().min(1)) }),
  z.object({ t: z.literal('OPS_BATCH'), ops: z.array(syncOperationSchema), more: z.boolean() }),
  z.object({ t: z.literal('REQUEST_SNAPSHOT') }),
  z.object({
    t: z.literal('SNAPSHOT_START'),
    projects: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    bytes: z.number().nonnegative(),
    clock: z.number().int().nonnegative(),
  }),
  z.object({
    t: z.literal('SNAPSHOT_PROJECTS'),
    projects: z.array(projectSchema),
    more: z.boolean(),
  }),
  z.object({
    t: z.literal('SNAPSHOT_SHOTS'),
    projectId: z.string().min(1),
    shots: z.array(shotSchema),
    more: z.boolean(),
  }),
  z.object({ t: z.literal('SNAPSHOT_SETTINGS'), settings: syncedSettingsSchema }),
  z.object({ t: z.literal('ASSET_START'), asset: assetMetaSchema }),
  z.object({ t: z.literal('ASSET_END'), key: z.string(), hash: z.string() }),
  z.object({
    t: z.literal('ACK'),
    cursors: z.record(z.number()),
    lastSyncAt: z.number(),
  }),
  z.object({ t: z.literal('SYNC_COMPLETE'), stats: syncStatsSchema }),
  z.object({ t: z.literal('PING'), at: z.number() }),
  z.object({ t: z.literal('PONG'), at: z.number() }),
  z.object({ t: z.literal('ERROR'), message: z.string() }),
])

export class SyncProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncProtocolError'
  }
}

/** JSON text frames for records; binary frames for asset chunks. */
export function encodeMessage(message: SyncMessage): string {
  return JSON.stringify(message)
}

/**
 * Validate anything that arrives over the channel. A peer is untrusted
 * input until proven otherwise — a malformed frame must never reach the store.
 */
export function decodeMessage(raw: string): SyncMessage {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new SyncProtocolError('Peer sent a frame that is not JSON.')
  }
  const parsed = syncMessageSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new SyncProtocolError(`Unsupported sync message: ${first?.message ?? 'invalid shape'}`)
  }
  return parsed.data as SyncMessage
}

/** Batch helper — keeps every envelope under RECORD_BATCH_LIMIT. */
export function chunkRecords<T>(items: readonly T[], size = RECORD_BATCH_LIMIT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[])
  return out
}

/**
 * Split asset bytes into channel-sized views (no copy — `subarray` shares the
 * buffer). Bounded chunks are what keep a large still from starving the JSON
 * frames queued behind it on the same channel.
 */
export function chunkBytes(bytes: Uint8Array, size = ASSET_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size))
  return out
}

/** A peer on a different protocol generation must be refused, not guessed at. */
export function isCompatibleProtocol(protocol: number): boolean {
  return protocol === SYNC_PROTOCOL_VERSION
}

export function collectAssetMetas(shots: readonly { asset_refs: string[] }[]): string[] {
  const keys = new Set<string>()
  for (const shot of shots) for (const key of shot.asset_refs) keys.add(key)
  return [...keys]
}
