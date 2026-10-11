import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Project, Shot, SyncOperation } from '@/kernel'
import { createIdbStorage } from '../index'
import { getDB, resetDBCache } from '../db'

const storage = createIdbStorage()

/**
 * Drop the whole database between test cases. The cached connection must be
 * closed first, otherwise the delete stays blocked forever.
 */
async function deleteDatabase(): Promise<void> {
  const db = await getDB()
  db.close()
  resetDBCache()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('cinebloc')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

function makeOp(id: string, seq: number, deviceId = 'pc-1'): SyncOperation {
  return {
    id,
    seq,
    deviceId,
    entity: 'shot',
    entityId: `shot-${seq}`,
    operation: 'update',
    data: { notes: `note ${seq}` },
    version: { counter: seq, deviceId },
    timestamp: 1_700_000_000_000 + seq,
  }
}

function makeProject(id: string): Project {
  const now = Date.now()
  return {
    id,
    title: `Project ${id}`,
    script_text: 'INT. ROOM - DAY',
    schema_version: 1,
    created_at: now,
    updated_at: now,
  }
}function makeShot(id: string): Shot {
  return {
    id,
    scene_id: 'int-room-day',
    scene_heading: 'INT. ROOM - DAY',
    shot_number: 1,
    character: null,
    action: 'x',
    size: 'MS',
    lens: null,
    movement: null,
    position_on_board: { x: 64, y: 64 },
    is_completed: false,
    order: 0,
    asset_refs: [],
    notes: '',
  }
}

describe('storage adapter (IndexedDB port)', () => {
  it('round-trips projects', async () => {
    const project = makeProject('p-1')
    await storage.saveProject(project)
    const loaded = await storage.loadProject('p-1')
    expect(loaded).toEqual(project)

    const all = await storage.listProjects()
    expect(all.some((p) => p.id === 'p-1')).toBe(true)
  })

  it('replaces the shot list per project (single-writer semantics)', async () => {
    const shots = [makeShot('s-1'), makeShot('s-2')]
    await storage.saveShots('p-2', shots)
    expect(await storage.listShots('p-2')).toHaveLength(2)

    await storage.saveShots('p-2', [shots[0]])
    const after = await storage.listShots('p-2')
    expect(after.map((s) => s.id)).toEqual(['s-1'])
  })

  it('returns an empty list for unknown projects', async () => {
    expect(await storage.listShots('does-not-exist')).toEqual([])
    expect(await storage.loadProject('does-not-exist')).toBeNull()
  })

  it('stores binary blobs as raw bytes keyed by asset ref', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10])
    const blob = new Blob([bytes], { type: 'image/png' })
    await storage.putBlob('shot-1/ref.png', blob)

    const loaded = await storage.getBlob('shot-1/ref.png')
    expect(loaded).not.toBeNull()
    expect(loaded!.type).toBe('image/png')
    expect(new Uint8Array(await loaded!.arrayBuffer())).toEqual(bytes)

    await storage.deleteBlob('shot-1/ref.png')
    expect(await storage.getBlob('shot-1/ref.png')).toBeNull()
  })

  it('round-trips meta values (settings, flags)', async () => {
    await storage.setMeta('settings', { provider: 'gemini', model: 'x' })
    expect(await storage.getMeta('settings')).toEqual({ provider: 'gemini', model: 'x' })
    expect(await storage.getMeta('missing')).toBeNull()
  })

  it('appends change-log operations and lists them in one batch', async () => {
    await storage.appendSyncOps([makeOp('op-a', 1), makeOp('op-b', 2)])
    // A second device's ops coexist in the same log.
    await storage.appendSyncOps([makeOp('op-c', 1, 'phone-1')])

    const log = await storage.listSyncOps()
    expect(log.map((o) => o.id)).toEqual(expect.arrayContaining(['op-a', 'op-b', 'op-c']))
    expect(log.find((o) => o.id === 'op-c')?.deviceId).toBe('phone-1')
  })

  it('replaces a log row with the same id instead of duplicating it', async () => {
    await storage.appendSyncOps([makeOp('op-dup', 5)])
    await storage.appendSyncOps([makeOp('op-dup', 5)])
    expect((await storage.listSyncOps()).filter((o) => o.id === 'op-dup')).toHaveLength(1)
  })

  it('deletes pruned ops and tolerates unknown ids', async () => {
    await storage.appendSyncOps([makeOp('op-x', 9)])
    await storage.deleteSyncOps(['op-x', 'never-existed'])
    const remaining = await storage.listSyncOps()
    expect(remaining.some((o) => o.id === 'op-x')).toBe(false)
  })

  it('upgrades an existing v1 database without losing local data', async () => {
    // Isolate: a v1 database can only be created when none exists yet.
    await deleteDatabase()
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cinebloc', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('shotlists', { keyPath: 'project_id' })
        db.createObjectStore('blobs')
        db.createObjectStore('meta')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction(['projects', 'meta'], 'readwrite')
      tx.objectStore('projects').put(makeProject('p-legacy'))
      tx.objectStore('meta').put({ provider: 'gemini', api_key: 'kept' }, 'settings')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()

    // Reopening through the adapter must migrate to v2 and keep everything.
    const db = await getDB()
    expect(db.version).toBe(2)
    expect(db.objectStoreNames.contains('synclog')).toBe(true)
    expect(await storage.loadProject('p-legacy')).toMatchObject({ id: 'p-legacy' })
    expect(await storage.getMeta('settings')).toEqual({ provider: 'gemini', api_key: 'kept' })

    await storage.appendSyncOps([makeOp('op-after-upgrade', 1)])
    expect(await storage.listSyncOps()).toHaveLength(1)
  })

  it('deleting a project cascades its shot list', async () => {
    await storage.saveProject(makeProject('p-gone'))
    await storage.saveShots('p-gone', [makeShot('s-g')])
    await storage.deleteProject('p-gone')
    expect(await storage.loadProject('p-gone')).toBeNull()
    expect(await storage.listShots('p-gone')).toEqual([])
  })
})
