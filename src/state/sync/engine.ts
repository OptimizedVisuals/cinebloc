import {
  ASSET_CHUNK_BYTES,
  RECORD_BATCH_LIMIT,
  SYNC_PROTOCOL_VERSION,
  advanceCursors,
  chunkBytes,
  chunkRecords,
  decodeMessage,
  deviceIdentitySchema,
  encodeMessage,
  isCompatibleProtocol,
  opsSince,
  parseShot,
  type DeviceIdentity,
  type SyncCursorMap,
  type SyncManifest,
  type SyncMessage,
  type SyncOperation,
  type SyncProgress,
  type SyncStats,
  type SyncStatus,
  type SyncTransportPort,
  type SyncedSettings,
  type StoragePort,
} from '@/kernel'
import { applyRemoteToStore } from './applyLive'
import { applyRemoteOps } from './applyOps'
import { ASSET_MAX_BYTES, AssetAssembler, verifyAssembled } from './assetTransfer'
import { isSha256Hex, sha256Hex } from './hash'
import type { SyncJournal } from './journal'
import {
  applySnapshotProjects,
  applySnapshotSettings,
  applySnapshotShots,
  collectSnapshot,
} from './snapshot'

/**
 * The sync engine (ADR 0005): one paired session's worth of work, driven
 * entirely over the transport port.
 *
 * It owns the ordering rules that make a local-first journal safe to expose to
 * a network:
 *
 *   • Nothing is acknowledged before it is durable. `OPS_BATCH` is ACKed only
 *     after the journal has appended the ops AND the records are in storage, so
 *     a peer can never advance its cursor past data this device does not hold.
 *   • Assets are *requested* by the side that lacks them, so a transfer that
 *     dies halfway is retried by the next session and a peer that already has a
 *     still is never sent it again.
 *   • Two-phase completion: a session ends only after both sides have announced
 *     they are done AND the final receipts have crossed. Closing on the first
 *     "done" would drop the very acknowledgements that make the next session
 *     incremental.
 *   • Inbound frames are untrusted: every frame goes through `decodeMessage`,
 *     every record through `parseProject`/`parseShot`, every asset hash is
 *     recomputed, and a peer may not author operations as *this* device.
 *   • A remote change enters the store only inside `runViewChange`, so it can
 *     neither echo back as a new local op nor become an undo step.
 */

/** Sending pauses while this many bytes are still queued on the channel. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const BUFFER_WAIT_MS = 5_000
const DEFAULT_HEARTBEAT_MS = 5_000
/**
 * How long both sides must be silent, after both have announced they are done,
 * before the session is closed.
 *
 * A session is not a request/response exchange that can be counted: a peer may
 * still ask for an image, or acknowledge a change, moments after it declared
 * itself finished. Closing on "both said done" would cut off exactly the tail
 * that makes the next session incremental — so the rule is *quiescence*: done,
 * done, and nothing said for a moment. Any frame, in either direction, restarts
 * the window.
 */
const DEFAULT_IDLE_MS = 400
/** Bound on one `REQUEST_ASSETS` reply, so a peer cannot ask for everything at once. */
const MAX_ASSET_REQUESTS = 128

export const SYNC_LOCKED_MESSAGE = 'The vault is locked — unlock this device to sync.'

export interface SyncSessionOptions {
  identity: DeviceIdentity
  journal: SyncJournal
  storage: StoragePort
  role: 'host' | 'guest'
  /**
   * The 6-digit code both devices display. Both sides derive it from the two
   * signalling payloads, so a mismatch means the payloads did not come from the
   * two devices the user is looking at.
   */
  code?: string | null
  /** Vault gate: while locked, the session refuses to move any data. */
  isBlocked: () => boolean
  activeProjectId: () => string | null
  /** The shared settings slice (board_mode only) to include in a snapshot. */
  readSettings: () => SyncedSettings
  onStatus?: (status: SyncStatus, message: string) => void
  onProgress?: (progress: SyncProgress) => void
  onPeer?: (device: DeviceIdentity) => void
  /** Records per envelope. Tests lower it to force multi-batch transfers. */
  batchLimit?: number
  /** 0 disables the keepalive. */
  heartbeatMs?: number
  /** Quiet window that ends the session. Tests shorten it. */
  idleMs?: number
}

export interface SyncSessionResult {
  stats: SyncStats
  peer: DeviceIdentity | null
  status: 'done' | 'failed'
  message: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function emptyStats(): SyncStats {
  return {
    recordsReceived: 0,
    recordsSent: 0,
    assetsReceived: 0,
    assetsSent: 0,
    bytesReceived: 0,
    bytesSent: 0,
  }
}

/** Per-device maximum, so neither a resend nor an ack ever goes backwards. */
function mergeCursors(a: SyncCursorMap, b: SyncCursorMap): SyncCursorMap {
  const out: SyncCursorMap = { ...a }
  for (const [deviceId, seq] of Object.entries(b)) {
    if (seq > (out[deviceId] ?? 0)) out[deviceId] = seq
  }
  return out
}

export class SyncSession {
  private readonly identity: DeviceIdentity
  private readonly journal: SyncJournal
  private readonly storage: StoragePort
  private readonly role: 'host' | 'guest'
  private readonly code: string | null
  private readonly isBlocked: () => boolean
  private readonly activeProjectId: () => string | null
  private readonly readSettings: () => SyncedSettings
  private readonly onStatus: (status: SyncStatus, message: string) => void
  private readonly onProgress: (progress: SyncProgress) => void
  private readonly onPeer: (device: DeviceIdentity) => void
  private readonly batchLimit: number
  private readonly heartbeatMs: number
  private readonly idleMs: number

  private transport: SyncTransportPort | null = null
  private unsubscribes: (() => void)[] = []
  private queue: Promise<void> = Promise.resolve()

  private peer: DeviceIdentity | null = null
  private peerManifest: SyncManifest | null = null
  private myManifest: SyncManifest | null = null

  private stats: SyncStats = emptyStats()
  private readonly assembler = new AssetAssembler()
  private sentUpto: SyncCursorMap = {}
  private snapshotUpTo: SyncCursorMap = {}
  /** Assets asked for this session, so two batches never request the same one. */
  private readonly requestedAssets = new Set<string>()

  private snapshotTotal = 0
  private snapshotDone = 0
  private snapshotSent = false
  private greeted = false
  private peerDone = false
  private peerAckCursors: SyncCursorMap = {}
  private selfDone = false
  private completed = false
  private closed = false
  private failed = false
  private lastActivity = Date.now()
  private lastTrafficAt = Date.now()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null

  private resolveFinished: (result: SyncSessionResult) => void = () => undefined
  private readonly finished: Promise<SyncSessionResult>

  constructor(options: SyncSessionOptions) {
    this.identity = options.identity
    this.journal = options.journal
    this.storage = options.storage
    this.role = options.role
    this.code = options.code ?? null
    this.isBlocked = options.isBlocked
    this.activeProjectId = options.activeProjectId
    this.readSettings = options.readSettings
    this.onStatus = options.onStatus ?? (() => undefined)
    this.onProgress = options.onProgress ?? (() => undefined)
    this.onPeer = options.onPeer ?? (() => undefined)
    this.batchLimit = options.batchLimit ?? RECORD_BATCH_LIMIT
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })
  }

  /** Begin the session on an open transport. Resolves when it ends. */
  async start(transport: SyncTransportPort): Promise<SyncSessionResult> {
    if (this.closed || this.failed) {
      return { stats: this.stats, peer: this.peer, status: 'failed', message: 'The session was closed.' }
    }
    this.transport = transport
    // Listeners go on synchronously, before any await: a greeting must never
    // be lost because this side was still reading its own database.
    this.unsubscribes = [
      transport.onFrame((raw) => this.enqueue(() => this.handleFrame(raw))),
      transport.onBinary((chunk) => this.enqueue(() => this.handleBinary(chunk))),
      // Transport failures go through the same serial queue as frames: a peer
      // that closes *after* handing over its final receipts must be believed,
      // not treated as a failure one microtask before those receipts land.
      transport.onError((error) => {
        this.enqueue(async () => this.fail(error.message || 'The connection failed.'))
      }),
      transport.onStateChange((state) => {
        this.enqueue(async () => {
          if (state === 'failed') {
            this.fail('The connection failed.')
            return
          }
          if (state !== 'disconnected') return
          // Both sides announced they were done and the peer has acknowledged
          // everything this device holds: it simply finished first and closed.
          // That is a completed session, not a dropped one.
          if (this.selfDone && this.peerDone && this.outstandingForPeer(false).length === 0) {
            this.completeNow()
            return
          }
          this.fail('The other device disconnected before finishing.')
        })
      }),
    ]

    if (this.isBlocked()) {
      this.fail(SYNC_LOCKED_MESSAGE)
      return this.finished
    }

    try {
      this.myManifest = await this.buildManifest()
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : 'Could not read local data for sync.')
      return this.finished
    }

    this.setProgress({
      phase: 'manifest',
      label: 'Exchanging manifests',
      itemsDone: 0,
      itemsTotal: 0,
      bytesDone: 0,
      bytesTotal: 0,
    })

    if (this.heartbeatMs > 0) {
      this.heartbeat = setInterval(() => this.beat(), this.heartbeatMs)
    }

    if (this.role === 'host') {
      this.setStatus('connecting', 'Waiting for the other device to answer…')
      this.send({ t: 'HELLO', device: this.identity, manifest: this.myManifest, code: this.code ?? '' })
    } else {
      this.setStatus('connecting', 'Connecting…')
    }

    return this.finished
  }

  /** Stop the session, keeping whatever was already durably written. */
  close(): void {
    if (this.closed || this.completed) return
    this.closed = true
    this.teardown()
    this.resolveFinished({
      stats: this.stats,
      peer: this.peer,
      status: this.failed ? 'failed' : 'done',
      message: this.failed ? 'The session ended early.' : 'Up to date.',
    })
  }

  // ── inbound ────────────────────────────────────────────────────────────────

  /** One inbound frame at a time, in arrival order — ingest must not interleave. */
  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((cause: unknown) => {
      this.fail(cause instanceof Error ? cause.message : 'Sync failed unexpectedly.')
    })
  }

  private async handleFrame(raw: string): Promise<void> {
    this.lastActivity = Date.now()
    this.touch()
    let message: SyncMessage
    try {
      message = decodeMessage(raw)
    } catch (cause) {
      // A malformed frame is a protocol violation, not a warning: stop rather
      // than guess at half a message.
      this.fail(cause instanceof Error ? cause.message : 'The other device sent an unreadable message.')
      return
    }
    await this.handle(message)
  }

  private async handle(message: SyncMessage): Promise<void> {
    if (this.failed || this.closed) return
    switch (message.t) {
      case 'PING':
        this.send({ t: 'PONG', at: message.at })
        return
      case 'PONG':
        return
      case 'ERROR':
        this.fail(`The other device reported: ${message.message}`)
        return
      case 'HELLO': {
        // Only a guest answers a greeting. A HELLO arriving at the host means
        // two sessions crossed and neither would be authoritative.
        if (this.role !== 'guest') return
        if (!this.adoptPeer(message)) return
        await this.greet()
        return
      }
      case 'WELCOME': {
        if (this.role !== 'host') return
        if (!this.adoptPeer(message)) return
        await this.greet()
        return
      }
      case 'REQUEST_OPS':
        await this.sendOps(message.cursors)
        return
      case 'REQUEST_ASSETS':
        await this.sendAssetsFor(message.keys)
        return
      case 'REQUEST_SNAPSHOT':
        await this.sendSnapshot()
        return
      case 'OPS_BATCH':
        await this.receiveOps(message.ops)
        return
      case 'SNAPSHOT_START':
        // Adopt the sender's logical time before any of its records land, so a
        // local edit made right after this cannot lose to what was just synced.
        await this.journal.advanceClockTo(message.clock)
        this.snapshotTotal = message.projects + message.shots
        this.snapshotDone = 0
        this.setProgress({
          phase: 'records',
          label: 'Receiving the library',
          itemsDone: 0,
          itemsTotal: this.snapshotTotal,
          bytesDone: 0,
          bytesTotal: message.bytes,
        })
        return
      case 'SNAPSHOT_PROJECTS':
        await this.receiveSnapshotProjects(message.projects, message.more)
        return
      case 'SNAPSHOT_SHOTS':
        await this.receiveSnapshotShots(message.projectId, message.shots, message.more)
        return
      case 'SNAPSHOT_SETTINGS': {
        const live = applySnapshotSettings(message.settings)
        if (live) applyRemoteToStore({ liveSettings: live })
        return
      }
      case 'ASSET_START': {
        // A checksum that is not a SHA-256 hex is unusable *before* any bytes
        // move: accepting it would mean storing something that cannot verify.
        if (!isSha256Hex(message.asset.hash)) {
          this.assembler.reset()
          this.setStatus(
            'syncing',
            `Skipped “${message.asset.key}” — the sender did not include a valid checksum.`,
          )
          return
        }
        if (!this.assembler.start(message.asset)) {
          this.setStatus('syncing', `Skipped “${message.asset.key}” — too large to accept.`)
        }
        return
      }
      case 'ASSET_END':
        // Receipt from the peer: those bytes are durable on the other device.
        return
      case 'ACK':
        await this.receiveAck(message.cursors, message.lastSyncAt)
        return
      case 'SYNC_COMPLETE':
        this.peerDone = true
        // A receipt: everything this device has durably applied so far. It is
        // not a "we are finished" signal — the session ends on quiescence.
        this.send({ t: 'ACK', cursors: this.ackCursors(), lastSyncAt: Date.now() })
        return
    }
  }

  /** Validate the peer, its manifest and its pairing code before trusting it. */
  private adoptPeer(message: { device: unknown; manifest: SyncManifest; code: string }): boolean {
    const parsed = deviceIdentitySchema.safeParse(message.device)
    if (!parsed.success) {
      this.reject('The other device did not identify itself properly.')
      return false
    }
    const device = parsed.data
    if (device.deviceId === this.identity.deviceId) {
      this.reject('That is this same device — pair two different devices.')
      return false
    }
    if (message.manifest.deviceId !== device.deviceId) {
      this.reject('The other device sent a manifest that does not match its identity.')
      return false
    }
    if (!isCompatibleProtocol(message.manifest.protocol)) {
      this.reject('The other device is running a different version of sync.')
      return false
    }
    if (this.code !== null && message.code !== this.code) {
      this.reject('The pairing codes do not match — start a new pairing.')
      return false
    }
    this.peer = device
    this.peerManifest = message.manifest
    this.onPeer(device)
    return true
  }

  /** Both sides run this once the manifests have crossed. */
  private async greet(): Promise<void> {
    if (this.greeted) return
    this.greeted = true
    const peerManifest = this.peerManifest
    const peer = this.peer
    if (!peerManifest || !peer) return

    if (this.role === 'guest') {
      this.send({
        t: 'WELCOME',
        device: this.identity,
        manifest: this.myManifest ?? (await this.buildManifest()),
        code: this.code ?? '',
      })
    }

    this.setStatus('syncing', `Syncing with ${peer.name}…`)

    if (this.snapshotNeeded(peerManifest)) await this.sendSnapshot()
    // Both paths run on a first sync, and that is deliberate: the snapshot
    // guarantees the peer ends up with the records, while the operations give
    // it the *version* metadata (and the logical clock) that decides who wins
    // the next conflicting edit. Records are idempotent, so the only cost is
    // a second pass of JSON on the one session that seeds a device.
    await this.sendOps(peerManifest.cursors)

    this.selfDone = true
    this.send({ t: 'SYNC_COMPLETE', stats: this.stats })
    this.recomputeCompletion()
  }

  // ── outbound ───────────────────────────────────────────────────────────────

  private async buildManifest(): Promise<SyncManifest> {
    const state = this.journal.snapshot()
    const projects = await this.storage.listProjects()
    let shots = 0
    for (const project of projects) {
      shots += (await this.storage.listShots(project.id)).length
    }
    const keys = await this.storage.listBlobKeys()
    let bytes = 0
    for (const key of keys) {
      const blob = await this.storage.getBlob(key)
      if (blob) bytes += blob.size
    }
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      deviceId: this.identity.deviceId,
      name: this.identity.name,
      platform: this.identity.platform,
      projects: projects.length,
      shots,
      assets: keys.length,
      bytes,
      // What this device holds per author. The peer reads its own entry to
      // learn whether anything is missing, with no extra round trip.
      cursors: { ...state.cursors, [this.identity.deviceId]: state.seq },
      snapshots: { ...state.snapshots },
    }
  }

  /**
   * Should this device send its whole library?
   *
   * Record counts alone cannot answer this. A device whose records predate its
   * own change log produces no operations, so the peer's cursor never moves and
   * a cursor-only test would resend the library on every session. The mirror
   * problem is a peer that already took the library.
   *
   * So: seed a peer that holds nothing; otherwise only when this device holds
   * strictly more (the records the peer cannot know about) and has not already
   * seeded it. Snapshot records merge by id and never delete, so being wrong in
   * the expensive direction is safe — being wrong in the cheap direction would
   * lose data.
   */
  private snapshotNeeded(peerManifest: SyncManifest): boolean {
    const mine = (this.myManifest?.projects ?? 0) + (this.myManifest?.shots ?? 0)
    if (mine === 0) return false
    const theirs = peerManifest.projects + peerManifest.shots
    if (theirs === 0) return true
    if (mine <= theirs) return false
    return peerManifest.snapshots[this.identity.deviceId] === undefined
  }

  private async sendSnapshot(): Promise<void> {
    if (this.snapshotSent) return
    this.snapshotSent = true
    if (!this.canSend()) return

    const snapshot = await collectSnapshot(this.storage)
    if (snapshot.projects.length === 0 && snapshot.shots.length === 0) return

    this.send({
      t: 'SNAPSHOT_START',
      projects: snapshot.projects.length,
      shots: snapshot.shots.length,
      assets: snapshot.assetKeys.length,
      bytes: snapshot.bytes,
      clock: this.journal.snapshot().clock,
    })

    // Every envelope is self-describing: a shot batch names its project, so the
    // receiver never has to guess an owner or hold state between messages.
    const projectBatches = chunkRecords(snapshot.projects, this.batchLimit)
    const shotBatches: { projectId: string; shots: typeof snapshot.shots }[] = []
    for (const { projectId, shots } of snapshot.byProject) {
      for (const chunk of chunkRecords(shots, this.batchLimit)) {
        shotBatches.push({ projectId, shots: chunk })
      }
    }

    const total = projectBatches.length + shotBatches.length
    let sent = 0
    const more = () => sent < total

    for (const projects of projectBatches) {
      if (!this.canSend()) return
      sent += 1
      this.send({ t: 'SNAPSHOT_PROJECTS', projects, more: more() })
    }
    for (const batch of shotBatches) {
      if (!this.canSend()) return
      sent += 1
      this.send({ t: 'SNAPSHOT_SHOTS', projectId: batch.projectId, shots: batch.shots, more: more() })
    }

    this.send({ t: 'SNAPSHOT_SETTINGS', settings: this.readSettings() })
    this.stats.recordsSent += snapshot.projects.length + snapshot.shots.length
  }

  private async sendOps(cursors: SyncCursorMap): Promise<void> {
    if (!this.canSend()) return
    // Never resend below what this session already sent: an ACK that arrives
    // before the peer's cursor catches up would otherwise loop.
    const floor = mergeCursors(cursors, this.sentUpto)
    const ops = opsSince(this.journal.ops(), floor)
    if (ops.length === 0) return

    const batches = chunkRecords(ops, this.batchLimit)
    for (const [index, batch] of batches.entries()) {
      if (!this.canSend()) return
      await this.awaitBuffer()
      this.send({ t: 'OPS_BATCH', ops: batch, more: index < batches.length - 1 })
      this.sentUpto = advanceCursors(this.sentUpto, batch)
      this.stats.recordsSent += batch.length
      this.setProgress({
        phase: 'records',
        label: 'Sending changes',
        itemsDone: this.stats.recordsSent,
        itemsTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
      })
    }
  }

  /** Send exactly the assets the peer asked for and this device actually holds. */
  private async sendAssetsFor(requested: readonly string[]): Promise<void> {
    const keys = [...new Set(requested)].slice(0, MAX_ASSET_REQUESTS)
    let index = 0

    for (const key of keys) {
      if (!this.canSend()) return
      const blob = await this.storage.getBlob(key)
      if (!blob) continue // this device does not hold it; nothing to send
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (bytes.byteLength > ASSET_MAX_BYTES) continue

      let hash: string
      try {
        hash = await sha256Hex(bytes)
      } catch (cause) {
        this.fail(cause instanceof Error ? cause.message : 'Could not verify an image.')
        return
      }

      index += 1
      this.setProgress({
        phase: 'assets',
        label: `Sending images (${index}/${keys.length})`,
        itemsDone: index - 1,
        itemsTotal: keys.length,
        bytesDone: this.stats.bytesSent,
        bytesTotal: 0,
      })

      this.send({
        t: 'ASSET_START',
        asset: { key, size: bytes.byteLength, type: blob.type, hash, shotId: null },
      })
      for (const chunk of chunkBytes(bytes, ASSET_CHUNK_BYTES)) {
        if (!this.canSend()) return
        await this.awaitBuffer()
        this.transport?.sendBinary(chunk)
      }
      this.stats.bytesSent += bytes.byteLength
      this.stats.assetsSent += 1
    }
  }

  /**
   * Ask for the assets referenced by records just applied that are not in
   * local storage. Requesting (rather than the sender guessing) is what makes
   * an interrupted image transfer retry by itself and keeps a peer that already
   * has a still from being sent it again.
   */
  private async requestMissingAssets(records: readonly unknown[]): Promise<void> {
    if (!this.canSend()) return
    const keys = new Set<string>()
    for (const raw of records) {
      const shot = parseShot(raw)
      if (!shot) continue
      for (const key of shot.asset_refs) keys.add(key)
    }
    if (keys.size === 0) return

    const missing: string[] = []
    for (const key of keys) {
      if (missing.length >= MAX_ASSET_REQUESTS) break
      // Already asked for: a second request would race the answer and get the
      // same bytes twice.
      if (this.requestedAssets.has(key)) continue
      if ((await this.storage.getBlob(key)) === null) missing.push(key)
    }
    if (missing.length === 0) return
    for (const key of missing) this.requestedAssets.add(key)
    this.send({ t: 'REQUEST_ASSETS', keys: missing })
  }

  // ── receiving records ──────────────────────────────────────────────────────

  private async receiveOps(ops: readonly SyncOperation[]): Promise<void> {
    const peer = this.peer
    if (!peer) {
      this.fail('The other device sent data before identifying itself.')
      return
    }

    // A peer may relay a third device's operations, but it may never claim to
    // be *this* device: that would let it overwrite our own history.
    const usable = ops.filter((op) => op.deviceId !== this.identity.deviceId)
    const forged = ops.length - usable.length

    if (usable.length > 0) {
      const ingested = await this.journal.ingest(usable)
      this.stats.recordsReceived += usable.length
      if (ingested.accepted.length > 0) {
        // Storage first (durable), then the live store behind the
        // no-echo / no-undo guards.
        const applied = await applyRemoteOps({
          ops: ingested.accepted,
          storage: this.storage,
          activeProjectId: this.activeProjectId(),
        })
        applyRemoteToStore(applied)
        await this.requestMissingAssets(
          ingested.accepted
            .filter((op) => op.entity === 'shot' && op.operation !== 'delete')
            .map((op) => op.data),
        )
      }
      this.setProgress({
        phase: 'records',
        label: 'Receiving changes',
        itemsDone: this.stats.recordsReceived,
        itemsTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
      })
    }

    if (forged > 0) {
      // The peer tried to speak for this device. Ignored, and said out loud.
      this.setStatus(
        'syncing',
        `${forged} change(s) from ${peer.name} were ignored: they claimed to come from this device.`,
      )
    }

    // Durable by now — only here may the peer move its cursor forward.
    this.send({ t: 'ACK', cursors: this.ackCursors(), lastSyncAt: Date.now() })
  }

  private async receiveAck(cursors: SyncCursorMap, lastSyncAt: number): Promise<void> {
    const peer = this.peer
    if (!peer) return
    await this.journal.ackFrom(peer.deviceId, cursors, lastSyncAt)
    this.peerAckCursors = mergeCursors(this.peerAckCursors, cursors)
    // An ACK is also a pull request: anything the peer still lacks — including a
    // change made while this exchange was running — goes out now.
    await this.sendOps(cursors)
  }

  private async receiveSnapshotProjects(projects: readonly unknown[], more: boolean): Promise<void> {
    const result = await applySnapshotProjects({
      projects,
      storage: this.storage,
      activeProjectId: this.activeProjectId(),
    })
    applyRemoteToStore({ liveProject: result.liveProject })
    this.stats.recordsReceived += result.projectsWritten
    this.advanceSnapshot(result.projectsWritten)
    if (!more) await this.finishSnapshot()
  }

  private async receiveSnapshotShots(
    projectId: string,
    shots: readonly unknown[],
    more: boolean,
  ): Promise<void> {
    const result = await applySnapshotShots({
      projectId,
      shots,
      storage: this.storage,
      activeProjectId: this.activeProjectId(),
    })
    applyRemoteToStore({ liveShots: result.liveShots })
    this.stats.recordsReceived += result.shotsWritten
    await this.requestMissingAssets(shots)
    this.advanceSnapshot(result.shotsWritten)
    if (!more) await this.finishSnapshot()
  }

  private advanceSnapshot(written: number): void {
    this.snapshotDone += written
    this.setProgress({
      phase: 'records',
      label: 'Receiving the library',
      itemsDone: this.snapshotDone,
      itemsTotal: this.snapshotTotal,
      bytesDone: 0,
      bytesTotal: 0,
    })
  }

  /**
   * The whole snapshot is durably stored. Only now does the peer's cursor for
   * this device advance — the promise that stops the next session from
   * resending the library. Persisted, so a restart does not forget it either.
   */
  private async finishSnapshot(): Promise<void> {
    const peer = this.peer
    const peerManifest = this.peerManifest
    if (!peer || !peerManifest) return
    const upTo = peerManifest.cursors[peer.deviceId] ?? 0
    await this.journal.adoptSnapshotFrom(peer.deviceId, upTo)
    this.snapshotUpTo = mergeCursors(this.snapshotUpTo, { [peer.deviceId]: upTo })
    this.send({ t: 'ACK', cursors: this.ackCursors(), lastSyncAt: Date.now() })
  }

  /**
   * What this device holds, per author — the same convention as the manifest,
   * including this device's own sequence number.
   *
   * The own entry is not decorative: without it a peer sees "this device has
   * nothing from me" and helpfully sends our own operations back to us, which
   * is pure noise (and would look like a forgery attempt).
   */
  private ackCursors(): SyncCursorMap {
    const state = this.journal.snapshot()
    return mergeCursors(
      { ...state.cursors, [this.identity.deviceId]: state.seq },
      this.snapshotUpTo,
    )
  }

  // ── assets inbound ─────────────────────────────────────────────────────────

  private async handleBinary(chunk: ArrayBuffer): Promise<void> {
    this.lastActivity = Date.now()
    this.stats.bytesReceived += chunk.byteLength
    if (!this.assembler.active()) return // a frame with no stream: ignore
    const outcome = this.assembler.push(new Uint8Array(chunk))
    if (outcome === 'overflow') this.assembler.reset()
    if (outcome !== 'complete') return
    const assembled = this.assembler.finish()
    if (!assembled) return

    let blob: Blob | null
    try {
      blob = await verifyAssembled(assembled)
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : 'Could not verify an image.')
      return
    }
    if (!blob) {
      // Hash mismatch: a broken or hostile transfer. Never stored.
      this.setStatus('syncing', `“${assembled.meta.key}” did not arrive intact and was discarded.`)
      return
    }

    await this.storage.putBlob(assembled.meta.key, blob)
    this.stats.assetsReceived += 1
    this.setProgress({
      phase: 'verify',
      label: 'Images verified',
      itemsDone: this.stats.assetsReceived,
      itemsTotal: 0,
      bytesDone: this.stats.bytesReceived,
      bytesTotal: 0,
    })
    // Receipt, sent only after the bytes are durable and their hash matched.
    this.send({ t: 'ASSET_END', key: assembled.meta.key, hash: assembled.meta.hash })
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  private beat(): void {
    if (this.closed || this.failed || this.completed) return
    if (Date.now() - this.lastActivity > this.heartbeatMs * 3) {
      this.fail('The other device stopped responding.')
      return
    }
    if (this.peer) this.send({ t: 'PING', at: Date.now() })
  }

  private send(message: SyncMessage): void {
    if (this.failed || this.closed) return
    this.transport?.sendText(encodeMessage(message))
    this.touch()
  }

  /** Any frame in either direction restarts the quiet window. */
  private touch(): void {
    this.lastTrafficAt = Date.now()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.recomputeCompletion(), this.idleMs)
  }

  /** Refuse the peer and tell it why, so it does not wait for an answer. */
  private reject(message: string): void {
    this.send({ t: 'ERROR', message })
    this.fail(message)
  }

  private canSend(): boolean {
    if (this.failed || this.closed) return false
    if (this.isBlocked()) {
      this.fail(SYNC_LOCKED_MESSAGE)
      return false
    }
    return true
  }

  private async awaitBuffer(): Promise<void> {
    const transport = this.transport
    if (!transport || transport.bufferedAmount() <= MAX_BUFFERED_BYTES) return
    let waited = 0
    while (transport.bufferedAmount() > MAX_BUFFERED_BYTES && waited < BUFFER_WAIT_MS) {
      await sleep(10)
      waited += 10
      if (this.failed || this.closed) return
    }
  }

  /**
   * Ops the peer has not confirmed. With `trustSent`, anything this session has
   * already put on the wire counts as dealt with — that is the check for "this
   * side has nothing left to say". Without it, the check is stronger: every op
   * this device holds has been acknowledged.
   */
  private outstandingForPeer(trustSent: boolean): SyncOperation[] {
    const floor = trustSent ? mergeCursors(this.peerAckCursors, this.sentUpto) : this.peerAckCursors
    return opsSince(this.journal.ops(), floor)
  }

  /**
   * A session is over when both sides have announced they are done and the line
   * has been quiet since — so a late image request, acknowledgement or catch-up
   * batch is always answered before the channel closes. Nothing is left owed to
   * the peer either: everything we know it lacks has already gone out.
   */
  private recomputeCompletion(): void {
    if (this.completed || this.failed || this.closed) return
    if (!this.selfDone || !this.peerDone) return
    if (Date.now() - this.lastTrafficAt < this.idleMs) return
    if (this.outstandingForPeer(true).length > 0) {
      // Still behind on our own outbound work: keep the session open (and let
      // the keepalive end it) rather than closing the door on those records.
      this.touch()
      return
    }
    this.completeNow()
  }

  private completeNow(): void {
    if (this.completed || this.failed || this.closed) return
    this.completed = true
    this.setStatus('idle', 'Up to date')
    this.setProgress({
      phase: 'done',
      label: 'Up to date',
      itemsDone: this.stats.recordsReceived + this.stats.recordsSent,
      itemsTotal: 0,
      bytesDone: this.stats.bytesReceived + this.stats.bytesSent,
      bytesTotal: 0,
    })
    void this.journal.markSynced().catch(() => undefined)
    this.teardown()
    this.resolveFinished({
      stats: this.stats,
      peer: this.peer,
      status: 'done',
      message: 'Up to date',
    })
  }

  private fail(message: string): void {
    if (this.failed || this.completed) return
    this.failed = true
    this.closed = true
    this.setStatus('error', message)
    this.teardown()
    this.resolveFinished({ stats: this.stats, peer: this.peer, status: 'failed', message })
  }

  private teardown(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes = []
    this.assembler.reset()
    this.transport?.close()
  }

  private setStatus(status: SyncStatus, message: string): void {
    this.onStatus(status, message)
  }

  private setProgress(progress: SyncProgress): void {
    this.onProgress(progress)
  }
}
