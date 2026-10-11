/**
 * Local-network sync vocabulary (ADR 0005 — no cloud, no server).
 *
 * Pure types only: the kernel imports nothing from src/, so the desktop
 * canvas, the mobile checklist and every transport adapter agree on a single
 * wire format. Nothing here touches the DOM, IndexedDB or WebRTC.
 */

/** Every synced record family. Assets travel as blobs, never inside JSON. */
export type SyncEntity = 'project' | 'shot' | 'settings' | 'asset'

export type SyncOperationKind = 'create' | 'update' | 'delete'

/**
 * Lamport-style logical version. Two devices that edit the same record while
 * disconnected both advance their own counter; the pair (counter, deviceId)
 * gives a *total* order with no reliance on wall clocks (which are wrong,
 * skewed and user-editable).
 */
export interface Version {
  counter: number
  deviceId: string
}

export type DevicePlatform = 'desktop' | 'mobile' | 'tablet'

/** This installation. Generated once, stored locally, never synced as data. */
export interface DeviceIdentity {
  deviceId: string
  name: string
  platform: DevicePlatform
  createdAt: number
}

/** A device the user has paired with ("known device" / trusted peer). */
export interface KnownDevice {
  deviceId: string
  name: string
  platform: DevicePlatform
  addedAt: number
  lastSeenAt: number
  lastSyncAt?: number
  trusted: boolean
}

/** Metadata exchanged before any bytes move, so the peer can skip assets. */
export interface AssetMeta {
  /** StoragePort blob key (opaque, unique). */
  key: string
  size: number
  type: string
  /** SHA-256, hex. Verified again after the last chunk arrives. */
  hash: string
  /** Owning shot, so the receiver can wire asset_refs on import. */
  shotId: string | null
}

/**
 * One local mutation. `seq` is monotonic *per device*, which is what lets two
 * peers ask for "everything after the seq I already applied from you".
 */
export interface SyncOperation {
  id: string
  seq: number
  deviceId: string
  entity: SyncEntity
  entityId: string
  /** project id for shots, shot id for assets. */
  parentId?: string
  operation: SyncOperationKind
  data?: unknown
  version: Version
  timestamp: number
  asset?: AssetMeta
}

/** deviceId → highest seq applied from that device. */
export type SyncCursorMap = Record<string, number>

/**
 * A mutation observed locally, *before* it is stamped with a version and a
 * seq. The store tap produces these; the journal turns them into ops, which
 * is what makes the log independent of how a change happened (edit, drag,
 * undo, import, asset attach — all of them reduce to this shape).
 */
export interface LocalMutation {
  entity: SyncEntity
  entityId: string
  /** project id for shots, shot id for assets. */
  parentId?: string
  operation: SyncOperationKind
  data?: unknown
  asset?: AssetMeta
}

/** Wire summary of what a device holds, sent right after HELLO. */
export interface SyncManifest {
  protocol: number
  deviceId: string
  name: string
  platform: DevicePlatform
  projects: number
  shots: number
  assets: number
  /** Total asset bytes, so the UI can show a real progress bar up front. */
  bytes: number
  /** deviceId → highest seq applied from that device (the op-log path). */
  cursors: SyncCursorMap
  /**
   * deviceId → the seq that device had when its snapshot was accepted.
   *
   * Record counts alone cannot answer "has this peer already taken my
   * library?" — a device whose records predate its own change log produces no
   * operations, so no cursor ever moves and the library would be resent on
   * every session. Presence of an entry here is that answer, and it is written
   * only after the whole snapshot is durably stored.
   */
  snapshots: Record<string, number>
}

export interface SyncStats {
  recordsReceived: number
  recordsSent: number
  assetsReceived: number
  assetsSent: number
  bytesReceived: number
  bytesSent: number
}

/** What the UI shows. Deliberately free of WebRTC vocabulary. */
export type SyncStatus = 'off' | 'idle' | 'connecting' | 'connected' | 'syncing' | 'error'

export interface SyncProgress {
  phase: 'idle' | 'connecting' | 'manifest' | 'records' | 'assets' | 'verify' | 'done'
  label: string
  itemsDone: number
  itemsTotal: number
  bytesDone: number
  bytesTotal: number
}

/** Nothing in flight — the UI's resting state. */
export const EMPTY_SYNC_PROGRESS: SyncProgress = {
  phase: 'idle',
  label: '',
  itemsDone: 0,
  itemsTotal: 0,
  bytesDone: 0,
  bytesTotal: 0,
}
