import { beforeEach, describe, expect, it } from 'vitest'
import type { Shot, SyncOperation } from '@/kernel'
import { applyRemoteOps } from '../applyOps'
import { createMemoryStorage, makeProject, makeShot, type MemoryStorage } from './memory-storage'

/**
 * Remote application: durable for every project, live only for the open one,
 * and always re-validated — a peer's payload is untrusted input.
 */

let storage: MemoryStorage

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, 'entity' | 'entityId'>): SyncOperation {
  return {
    id: `op-${partial.entityId}-${partial.operation ?? 'update'}`,
    seq: 1,
    deviceId: 'device-a',
    entity: partial.entity,
    entityId: partial.entityId,
    parentId: partial.parentId,
    operation: partial.operation ?? 'update',
    data: partial.data,
    version: { counter: 1, deviceId: 'device-a' },
    timestamp: 1_700_000_000_000,
  }
}

describe('remote operation application', () => {
  beforeEach(async () => {
    storage = createMemoryStorage()
    await storage.saveProject(makeProject('p-open', 'Open project'))
    await storage.saveProject(makeProject('p-other', 'Background project'))
    await storage.saveShots('p-other', [makeShot('bg-1', 0)])
  })

  it('persists a project that is not open, without touching the live store', async () => {
    const result = await applyRemoteOps({
      ops: [
        op({ entity: 'project', entityId: 'p-new', operation: 'create', data: makeProject('p-new', 'From the phone') }),
        op({
          entity: 'shot',
          entityId: 'n-1',
          parentId: 'p-new',
          operation: 'create',
          data: makeShot('n-1', 0, 'synced'),
        }),
      ],
      storage,
      activeProjectId: 'p-open',
    })

    expect(result.projectsWritten).toBe(1)
    expect(result.shotsWritten).toBe(1)
    expect(result.liveProject).toBeUndefined()
    expect(result.liveShots).toBeUndefined()

    const persisted = await storage.listShots('p-new')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].notes).toBe('synced')
  })

  it('returns live shots for the open project so the UI updates', async () => {
    const existing: Shot[] = [makeShot('s-1', 0)]
    await storage.saveShots('p-open', existing)

    const result = await applyRemoteOps({
      ops: [
        op({ entity: 'shot', entityId: 's-1', parentId: 'p-open', operation: 'update', data: makeShot('s-1', 0, 'edited remotely') }),
        op({ entity: 'shot', entityId: 's-2', parentId: 'p-open', operation: 'create', data: makeShot('s-2', 1) }),
      ],
      storage,
      activeProjectId: 'p-open',
    })

    expect(result.liveShots?.map((shot) => shot.id)).toEqual(['s-1', 's-2'])
    expect(result.liveShots?.find((shot) => shot.id === 's-1')?.notes).toBe('edited remotely')
    expect(result.liveShots).toEqual(await storage.listShots('p-open'))
  })

  it('clears the workspace when the open project is deleted remotely', async () => {
    const result = await applyRemoteOps({
      ops: [op({ entity: 'project', entityId: 'p-open', operation: 'delete' })],
      storage,
      activeProjectId: 'p-open',
    })

    expect(result.liveProject).toBeNull()
    expect(result.liveShots).toEqual([])
    expect(await storage.loadProject('p-open')).toBeNull()
    expect(await storage.listShots('p-open')).toEqual([])
  })

  it('rejects malformed payloads instead of corrupting the store', async () => {
    const good = op({ entity: 'project', entityId: 'p-evil', operation: 'create', data: makeProject('p-evil') })
    const tampered: SyncOperation = { ...good, data: { id: 'p-evil', title: 42 } }

    const result = await applyRemoteOps({ ops: [tampered], storage, activeProjectId: null })

    expect(result.rejected).toBe(1)
    expect(result.projectsWritten).toBe(0)
    expect(await storage.loadProject('p-evil')).toBeNull()
  })

  it('rejects shot ops that are not filed under a project', async () => {
    const orphan = op({ entity: 'shot', entityId: 'lonely', operation: 'create', data: makeShot('lonely', 0) })
    const result = await applyRemoteOps({ ops: [orphan], storage, activeProjectId: null })
    expect(result.rejected).toBe(1)
    expect(result.shotsWritten).toBe(0)
  })

  it('applies only the whitelisted settings slice', async () => {
    const result = await applyRemoteOps({
      ops: [
        op({
          entity: 'settings',
          entityId: 'settings',
          operation: 'update',
          data: { board_mode: 'default', api_key: 'sk-should-be-ignored' },
        }),
      ],
      storage,
      activeProjectId: null,
    })

    expect(result.liveSettings).toEqual({ board_mode: 'default' })
    expect(JSON.stringify(result.liveSettings)).not.toContain('sk-should-be-ignored')
  })

  it('applies an end-to-end delta: five shots, one edited, one removed', async () => {
    const five = [0, 1, 2, 3, 4].map((i) => makeShot(`s-${i}`, i))
    await storage.saveShots('p-open', five)

    const result = await applyRemoteOps({
      ops: [
        op({ entity: 'shot', entityId: 's-2', parentId: 'p-open', operation: 'update', data: makeShot('s-2', 2, 'only C changed') }),
        op({ entity: 'shot', entityId: 's-4', parentId: 'p-open', operation: 'delete' }),
      ],
      storage,
      activeProjectId: 'p-open',
    })

    expect(result.shotsWritten).toBe(1)
    expect(result.shotsDeleted).toBe(1)
    const next = await storage.listShots('p-open')
    expect(next.map((shot) => shot.id)).toEqual(['s-0', 's-1', 's-2', 's-3'])
    expect(next.find((shot) => shot.id === 's-2')?.notes).toBe('only C changed')
  })
})
