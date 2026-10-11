import type { Project, Shot, StoragePort, SyncOperation } from '@/kernel'
import { getDB } from './db'

/**
 * Browser-native IndexedDB pipeline (claim 2): JSON records + raw binary
 * blobs, entirely client-side — no cloud storage dependencies.
 */
export function createIdbStorage(): StoragePort {
  return {
    async listProjects(): Promise<Project[]> {
      const db = await getDB()
      return (await db.getAll('projects')) as Project[]
    },
    async saveProject(project: Project): Promise<void> {
      const db = await getDB()
      await db.put('projects', project)
    },
    async loadProject(id: string): Promise<Project | null> {
      const db = await getDB()
      return ((await db.get('projects', id)) as Project | undefined) ?? null
    },
    async deleteProject(id: string): Promise<void> {
      const db = await getDB()
      const tx = db.transaction(['projects', 'shotlists'], 'readwrite')
      await tx.objectStore('projects').delete(id)
      await tx.objectStore('shotlists').delete(id)
      await tx.done
    },
    async saveShots(projectId: string, shots: Shot[]): Promise<void> {
      const db = await getDB()
      await db.put('shotlists', { project_id: projectId, shots })
    },
    async listShots(projectId: string): Promise<Shot[]> {
      const db = await getDB()
      const record = (await db.get('shotlists', projectId)) as { shots?: Shot[] } | undefined
      return record?.shots ?? []
    },
    async putBlob(key: string, blob: Blob): Promise<void> {
      const db = await getDB()
      await db.put('blobs', blob, key)
    },
    async getBlob(key: string): Promise<Blob | null> {
      const db = await getDB()
      return ((await db.get('blobs', key)) as Blob | undefined) ?? null
    },
    async deleteBlob(key: string): Promise<void> {
      const db = await getDB()
      await db.delete('blobs', key)
    },
    async listBlobKeys(): Promise<string[]> {
      const db = await getDB()
      return (await db.getAllKeys('blobs')) as string[]
    },
    async getMeta<T>(key: string): Promise<T | null> {
      const db = await getDB()
      return ((await db.get('meta', key)) as T | undefined) ?? null
    },
    async setMeta(key: string, value: unknown): Promise<void> {
      const db = await getDB()
      await db.put('meta', value, key)
    },

    async listSyncOps(): Promise<SyncOperation[]> {
      const db = await getDB()
      return (await db.getAll('synclog')) as SyncOperation[]
    },

    async appendSyncOps(ops: readonly SyncOperation[]): Promise<void> {
      if (ops.length === 0) return
      const db = await getDB()
      // One transaction per batch: a half-written log would look like lost work.
      const tx = db.transaction('synclog', 'readwrite')
      for (const op of ops) await tx.store.put(op)
      await tx.done
    },

    async deleteSyncOps(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return
      const db = await getDB()
      const tx = db.transaction('synclog', 'readwrite')
      for (const id of ids) await tx.store.delete(id)
      await tx.done
    },
  }
}
