import { openDB, type IDBPDatabase } from 'idb'

export interface ShotListRecord {
  project_id: string
  shots: unknown[]
}

const DB_NAME = 'cinebloc'
/** v2 adds the append-only change log for local-network device sync. */
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase> | null = null

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Version guards keep the upgrade additive: a device that already holds
      // v1 data keeps every record, and only gains the new store.
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' })
          db.createObjectStore('shotlists', { keyPath: 'project_id' })
          // out-of-line keys: blob key → Blob, meta key → value
          db.createObjectStore('blobs')
          db.createObjectStore('meta')
        }
        if (oldVersion < 2) {
          // One record per SyncOperation, keyed by its globally unique id so
          // several peers' ops can coexist in one log.
          db.createObjectStore('synclog', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

/** Test seam: drop the cached connection (used between test cases). */
export function resetDBCache(): void {
  dbPromise = null
}

/** Close the cached connection and delete the whole database (vault erase). */
export async function closeAndDeleteDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
    request.onblocked = () => resolve()
  })
}
