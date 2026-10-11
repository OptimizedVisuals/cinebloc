import {
  advance,
  advanceCursors,
  entityKey,
  opsSince,
  reconcile,
  type DeviceIdentity,
  type LocalMutation,
  type ReconcileResult,
  type StoragePort,
  type SyncCursorMap,
  type SyncOperation,
  type VersionMap,
} from '@/kernel'

/**
 * The local sync journal (ADR 0005).
 *
 * It owns everything a device needs to be eventually consistent on its own:
 *   • the logical clock and the per-device seq counter
 *   • the winning version per record, plus tombstones for deletions
 *   • cursors: how much of each peer's log we have applied, and how much of
 *     ours each peer confirmed (the ACK side)
 *   • the append-only op log itself, in `StoragePort.synclog`
 *
 * Everything is persisted, so a reload, a tab crash or an app restart resumes
 * exactly where it stopped — an interrupted sync simply continues, and an op
 * that already arrived is recognised as a duplicate instead of being applied
 * twice.
 */

export const SYNC_STATE_KEY = 'sync_state'

export interface SyncJournalState {
  clock: number
  seq: number
  /** entityKey → winning version. */
  versions: VersionMap
  /** entityKey → version of the delete that won. */
  tombstones: VersionMap
  /** peerDeviceId → highest seq applied FROM that peer. */
  cursors: SyncCursorMap
  /** peerDeviceId → highest seq of OURS that peer confirmed applying. */
  acked: SyncCursorMap
  /**
   * peerDeviceId → the seq that peer held when its full snapshot was accepted.
   * Presence means "this peer's library is already in my storage", which is
   * what stops a snapshot from being sent on every session to a device that
   * produces no operations of its own.
   */
  snapshots: SyncCursorMap
  lastSyncAt: number | null
}

export function emptyJournalState(): SyncJournalState {
  return {
    clock: 0,
    seq: 0,
    versions: {},
    tombstones: {},
    cursors: {},
    acked: {},
    snapshots: {},
    lastSyncAt: null,
  }
}

/** Defensive read: a half-written or older record must never crash the app. */
function normalizeState(value: unknown): SyncJournalState {
  const base = emptyJournalState()
  if (value === null || typeof value !== 'object') return base
  const raw = value as Record<string, unknown>
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  const map = (v: unknown): Record<string, never> =>
    v !== null && typeof v === 'object' ? (v as Record<string, never>) : {}
  return {
    clock: num(raw['clock'], 0),
    seq: num(raw['seq'], 0),
    versions: map(raw['versions']) as unknown as VersionMap,
    tombstones: map(raw['tombstones']) as unknown as VersionMap,
    cursors: map(raw['cursors']) as unknown as SyncCursorMap,
    acked: map(raw['acked']) as unknown as SyncCursorMap,
    snapshots: map(raw['snapshots']) as unknown as SyncCursorMap,
    lastSyncAt: typeof raw['lastSyncAt'] === 'number' ? raw['lastSyncAt'] : null,
  }
}

export class SyncJournal {
  private constructor(
    private readonly storage: StoragePort,
    readonly identity: DeviceIdentity,
    private state: SyncJournalState,
    private log: SyncOperation[],
  ) {}

  /** Load persisted state + log. Safe to call after every restart. */
  static async open(storage: StoragePort, identity: DeviceIdentity): Promise<SyncJournal> {
    const [rawState, log] = await Promise.all([
      storage.getMeta<unknown>(SYNC_STATE_KEY),
      storage.listSyncOps(),
    ])
    return new SyncJournal(storage, identity, normalizeState(rawState), log)
  }

  snapshot(): SyncJournalState {
    return this.state
  }

  ops(): readonly SyncOperation[] {
    return this.log
  }

  /** Ops this device authored. */
  private ownOps(): SyncOperation[] {
    return this.log.filter((op) => op.deviceId === this.identity.deviceId)
  }

  /** How many of our ops one peer has not acknowledged yet. */
  pendingFor(peerDeviceId: string): number {
    return opsSince(this.ownOps(), { [this.identity.deviceId]: this.state.acked[peerDeviceId] ?? 0 })
      .length
  }

  /**
   * Pending = not yet acknowledged by *every* trusted peer, so the UI copy
   * ("3 changes waiting") is true for all of them and not just one.
   */
  pendingCount(peerDeviceIds: readonly string[]): number {
    if (peerDeviceIds.length === 0) return 0
    const floor = Math.min(...peerDeviceIds.map((id) => this.state.acked[id] ?? 0))
    return opsSince(this.ownOps(), { [this.identity.deviceId]: floor }).length
  }

  /** Ops a peer is missing: ours, plus third-party ops relayed through us. */
  opsFor(peerDeviceId: string): SyncOperation[] {
    return opsSince(this.log, { [peerDeviceId]: this.state.cursors[peerDeviceId] ?? 0 })
  }

  /**
   * Turn observed mutations into stamped operations. One version per record per
   * batch, so a coalesced burst consumes exactly one logical tick.
   */
  async record(mutations: readonly LocalMutation[]): Promise<SyncOperation[]> {
    if (mutations.length === 0) return []
    const created: SyncOperation[] = []
    for (const mutation of mutations) {
      const { version, clock } = advance(this.state.clock, this.identity.deviceId)
      this.state.clock = clock
      this.state.seq += 1
      const key = entityKey(mutation.entity, mutation.entityId)
      const op: SyncOperation = {
        id: generateId(),
        seq: this.state.seq,
        deviceId: this.identity.deviceId,
        entity: mutation.entity,
        entityId: mutation.entityId,
        ...(mutation.parentId ? { parentId: mutation.parentId } : {}),
        operation: mutation.operation,
        ...(mutation.data === undefined ? {} : { data: mutation.data }),
        version,
        timestamp: Date.now(),
        ...(mutation.asset ? { asset: mutation.asset } : {}),
      }
      this.state.versions[key] = version
      if (mutation.operation === 'delete') this.state.tombstones[key] = version
      else delete this.state.tombstones[key]
      created.push(op)
    }
    this.log.push(...created)
    await this.storage.appendSyncOps(created)
    await this.persist()
    return created
  }

  /**
   * Reconcile ops that arrived from a peer. Accepted ops are written into our
   * own log too, which is what lets a phone relay a PC's changes to a tablet.
   * Cursors advance over everything received — duplicates included, because
   * “I already have it” is exactly what a cursor means.
   */
  async ingest(incoming: readonly SyncOperation[]): Promise<ReconcileResult> {
    const result = reconcile({
      incoming,
      versions: this.state.versions,
      tombstones: this.state.tombstones,
    })
    this.state.versions = result.versions
    this.state.tombstones = result.tombstones
    this.state.clock = Math.max(this.state.clock, result.clock)
    this.state.cursors = advanceCursors(this.state.cursors, incoming)

    const known = new Set(this.log.map((op) => op.id))
    const fresh = result.accepted.filter((op) => !known.has(op.id))
    if (fresh.length > 0) {
      this.log.push(...fresh)
      await this.storage.appendSyncOps(fresh)
    }
    await this.persist()
    return result
  }

  /**
   * Record that a peer's *snapshot* has been durably stored, so its cursor for
   * that peer advances even though no operation was involved.
   *
   * Without this a device whose library predates its own journal produces no
   * ops at all, its peer's cursor stays at zero forever, and every session
   * would resend the whole library. The cursor is persisted for exactly the
   * same reason ops are: a restart must not forget what was already received.
   */
  async adoptSnapshotFrom(peerDeviceId: string, upToSeq: number): Promise<void> {
    // The marker is written even at seq 0: it is *presence*, not the number,
    // that tells the peer its library has landed.
    this.state.snapshots = { ...this.state.snapshots, [peerDeviceId]: upToSeq }
    const current = this.state.cursors[peerDeviceId] ?? 0
    if (upToSeq > current) {
      this.state.cursors = { ...this.state.cursors, [peerDeviceId]: upToSeq }
    }
    await this.persist()
  }

  /** A peer confirming how much of our log it has applied. */
  async ackFrom(peerDeviceId: string, cursors: SyncCursorMap, lastSyncAt?: number): Promise<void> {
    for (const [deviceId, seq] of Object.entries(cursors)) {
      if (deviceId !== this.identity.deviceId) continue
      const current = this.state.acked[peerDeviceId] ?? 0
      if (seq > current) this.state.acked[peerDeviceId] = seq
    }
    if (typeof lastSyncAt === 'number') this.state.lastSyncAt = lastSyncAt
    await this.persist()
  }

  /**
   * Fold a peer's logical clock into ours without any operation to compare
   * against — the snapshot case. Records travel without versions, so this is
   * the only thing that keeps the next local edit *newer* than what was just
   * adopted instead of losing to it.
   */
  async advanceClockTo(clock: number): Promise<void> {
    if (!Number.isFinite(clock) || clock <= this.state.clock) return
    this.state.clock = clock
    await this.persist()
  }

  async markSynced(at: number = Date.now()): Promise<void> {
    this.state.lastSyncAt = at
    await this.persist()
  }

  private async persist(): Promise<void> {
    await this.storage.setMeta(SYNC_STATE_KEY, this.state)
  }
}

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // Deterministic-enough fallback for exotic contexts; ids only need uniqueness.
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
