import type { SyncCursorMap, SyncEntity, SyncOperation, Version } from './types'
import { compareVersions, isNewerThan, mergeClock } from './version'

/**
 * Op reconciliation — the heart of eventually-consistent sync (ADR 0005).
 *
 * `versions` remembers, per record, the version that won. `tombstones`
 * remembers deleted records *with* the version that deleted them, so a stale
 * update that arrives late (a phone that was offline) can never resurrect a
 * record the other device removed.
 *
 * Application order is normalised before anything is applied: ops are sorted
 * by (counter, deviceId, id) — the same total order every device computes —
 * so the resulting state depends only on the *set* of ops, never on the order
 * packets happened to arrive in.
 */

export type VersionMap = Record<string, Version>

/** Stable identity of a synced record across devices. */
export function entityKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`
}

export interface ReconcileInput {
  incoming: readonly SyncOperation[]
  /** Winning version per entity key (persisted locally). */
  versions: VersionMap
  /** Deletions, keyed identically, so they keep beating late updates. */
  tombstones: VersionMap
}

export interface ReconcileResult {
  /** Ops that won and must be written into the local store. */
  accepted: SyncOperation[]
  /** Ops dropped because a newer (or identical) version already won. */
  rejected: number
  versions: VersionMap
  tombstones: VersionMap
  /** Local clock after folding in everything observed. */
  clock: number
}

function compareOps(a: SyncOperation, b: SyncOperation): number {
  const byVersion = compareVersions(a.version, b.version)
  if (byVersion !== 0) return byVersion
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const versions: VersionMap = { ...input.versions }
  const tombstones: VersionMap = { ...input.tombstones }
  const accepted: SyncOperation[] = []
  let rejected = 0

  for (const op of [...input.incoming].sort(compareOps)) {
    const key = entityKey(op.entity, op.entityId)
    if (!isNewerThan(op.version, versions[key])) {
      rejected++
      continue
    }
    versions[key] = op.version
    if (op.operation === 'delete') tombstones[key] = op.version
    else delete tombstones[key]
    accepted.push(op)
  }

  // The clock must reflect everything we have *seen*, accepted or not.
  const observed = [...input.incoming.map((op) => op.version), ...Object.values(versions)]
  return { accepted, rejected, versions, tombstones, clock: mergeClock(0, observed) }
}

export function isTombstoned(key: string, tombstones: VersionMap): boolean {
  return key in tombstones
}

/**
 * "Everything you have not seen from me": per-device seq is monotonic, so a
 * cursor map is enough to ask for exactly the gap. This is what keeps later
 * syncs from re-sending the whole database.
 */
export function opsSince(ops: readonly SyncOperation[], cursors: SyncCursorMap): SyncOperation[] {
  return ops.filter((op) => op.seq > (cursors[op.deviceId] ?? 0))
}

/** Cursors advance to the highest seq applied from each source device. */
export function advanceCursors(cursors: SyncCursorMap, ops: readonly SyncOperation[]): SyncCursorMap {
  const next: SyncCursorMap = { ...cursors }
  for (const op of ops) {
    const seen = next[op.deviceId] ?? 0
    if (op.seq > seen) next[op.deviceId] = op.seq
  }
  return next
}

/** Number of ops a peer is missing, for the "3 changes waiting" copy. */
export function countPending(ops: readonly SyncOperation[], cursors: SyncCursorMap): number {
  return opsSince(ops, cursors).length
}
