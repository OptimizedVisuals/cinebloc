import type { Project, Shot, StoragePort, SyncOperation } from '@/kernel'

/**
 * In-memory StoragePort with IndexedDB semantics: every value is structured-
 * cloned on the way in and out, so a test can never accidentally pass because
 * two "devices" shared an object reference.
 */
export interface MemoryStorage extends StoragePort {
  blobs: Map<string, Blob>
}

export function createMemoryStorage(): MemoryStorage {
  const projects = new Map<string, Project>()
  const shotLists = new Map<string, Shot[]>()
  const blobs = new Map<string, Blob>()
  const meta = new Map<string, unknown>()
  const synclog = new Map<string, SyncOperation>()

  const clone = <T>(value: T): T => structuredClone(value)

  return {
    blobs,
    async listProjects() {
      return clone([...projects.values()])
    },
    async saveProject(project) {
      projects.set(project.id, clone(project))
    },
    async loadProject(id) {
      const found = projects.get(id)
      return found ? clone(found) : null
    },
    async deleteProject(id) {
      projects.delete(id)
      shotLists.delete(id)
    },
    async saveShots(projectId, shots) {
      shotLists.set(projectId, clone(shots))
    },
    async listShots(projectId) {
      return clone(shotLists.get(projectId) ?? [])
    },
    async putBlob(key, blob) {
      blobs.set(key, blob)
    },
    async getBlob(key) {
      return blobs.get(key) ?? null
    },
    async deleteBlob(key) {
      blobs.delete(key)
    },
    async listBlobKeys() {
      return [...blobs.keys()]
    },
    async getMeta<T>(key: string) {
      const found = meta.get(key)
      return found === undefined ? null : (clone(found) as T)
    },
    async setMeta(key, value) {
      meta.set(key, clone(value))
    },
    async listSyncOps() {
      return clone([...synclog.values()])
    },
    async appendSyncOps(ops) {
      for (const op of ops) synclog.set(op.id, clone(op))
    },
    async deleteSyncOps(ids) {
      for (const id of ids) synclog.delete(id)
    },
  }
}

export function makeShot(id: string, order = 0, notes = ''): Shot {
  return {
    id,
    scene_id: 'int-diner-night',
    scene_heading: 'INT. DINER - NIGHT',
    shot_number: order + 1,
    character: null,
    action: `Action ${id}`,
    size: 'MS',
    lens: null,
    movement: null,
    position_on_board: { x: 64 + order * 360, y: 64 },
    is_completed: false,
    order,
    asset_refs: [],
    notes,
  }
}

export function makeProject(id: string, title = 'Rain Diner'): Project {
  const now = 1_700_000_000_000
  return {
    id,
    title,
    script_text: 'INT. DINER - NIGHT',
    schema_version: 1,
    created_at: now,
    updated_at: now,
  }
}
