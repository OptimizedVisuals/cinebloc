import type { Project } from '../model/project'
import type { Shot } from '../model/shot'
import type { SyncOperation } from '../sync/types'

/**
 * Persistence port (claim 2): JSON records + raw binary blobs, all local.
 * Implemented by adapters/storage-indexeddb; consumed by state/persistence
 * and the assets feature. Nothing else may touch IndexedDB.
 */
export interface StoragePort {
  listProjects(): Promise<Project[]>
  saveProject(project: Project): Promise<void>
  loadProject(id: string): Promise<Project | null>
  deleteProject(id: string): Promise<void>
  /** Replace-all semantics for a project's shots (single writer, debounced). */
  saveShots(projectId: string, shots: Shot[]): Promise<void>
  listShots(projectId: string): Promise<Shot[]>
  putBlob(key: string, blob: Blob): Promise<void>
  getBlob(key: string): Promise<Blob | null>
  deleteBlob(key: string): Promise<void>
  listBlobKeys(): Promise<string[]>
  getMeta<T>(key: string): Promise<T | null>
  setMeta(key: string, value: unknown): Promise<void>

  /**
   * Append-only local change log (ADR 0005). Every sync-relevant mutation is
   * recorded here so a reconnecting peer can be sent only the gap. Keyed by
   * `SyncOperation.id`, which is globally unique across devices, and encrypted
   * at rest by the vault decorator exactly like records are.
   */
  listSyncOps(): Promise<SyncOperation[]>
  appendSyncOps(ops: readonly SyncOperation[]): Promise<void>
  /** Pruning/compaction — ids are ignored if already absent. */
  deleteSyncOps(ids: readonly string[]): Promise<void>
}
