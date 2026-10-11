import { describe, expect, it } from 'vitest'
import {
  advanceCursors,
  countPending,
  entityKey,
  opsSince,
  reconcile,
  type VersionMap,
} from '../reconcile'
import type { SyncOperation } from '../types'

let seq = 0
function op(partial: Partial<SyncOperation> & Pick<SyncOperation, 'version' | 'entityId'>): SyncOperation {
  seq += 1
  return {
    id: `op-${seq}`,
    seq,
    deviceId: partial.version.deviceId,
    entity: partial.entity ?? 'shot',
    entityId: partial.entityId,
    operation: partial.operation ?? 'update',
    data: partial.data,
    version: partial.version,
    timestamp: partial.timestamp ?? 1_700_000_000_000 + seq,
    parentId: partial.parentId,
  }
}

const empty = { versions: {} as VersionMap, tombstones: {} as VersionMap }

describe('op reconciliation', () => {
  it('applies the same result no matter what order ops arrive in', () => {
    const pc = op({ entityId: 'C', version: { counter: 5, deviceId: 'pc' }, data: { notes: 'pc' } })
    const phone = op({ entityId: 'C', version: { counter: 5, deviceId: 'phone' }, data: { notes: 'phone' } })
    const forward = reconcile({ incoming: [pc, phone], ...empty })
    const backward = reconcile({ incoming: [phone, pc], ...empty })

    // Both ops win over "nothing", but the final winner is identical either way.
    expect(forward.accepted.map((o) => o.id)).toEqual(backward.accepted.map((o) => o.id))
    expect(forward.versions).toEqual(backward.versions)
    // counter tie → deviceId tie-break: "pc" < "phone", so the phone's edit lands last.
    expect(forward.accepted.at(-1)?.data).toEqual({ notes: 'phone' })
    expect(forward.versions[entityKey('shot', 'C')]).toEqual({ counter: 5, deviceId: 'phone' })
  })

  it('only transfers the record that actually changed', () => {
    const ops = ['A', 'B', 'C', 'D', 'E'].map((id) =>
      op({ entityId: id, version: { counter: 1, deviceId: 'pc' } }),
    )
    const cursorsAfterFirstSync = advanceCursors({}, ops)
    expect(countPending(ops, cursorsAfterFirstSync)).toBe(0)

    const editC = op({ entityId: 'C', version: { counter: 2, deviceId: 'pc' } })
    const all = [...ops, editC]
    const missing = opsSince(all, cursorsAfterFirstSync)

    expect(missing).toEqual([editC])
    expect(missing.map((o) => o.entityId)).toEqual(['C'])
  })

  it('keeps a delete beating a late offline edit', () => {
    const del = op({ entityId: 'C', operation: 'delete', version: { counter: 4, deviceId: 'pc' } })
    const first = reconcile({ incoming: [del], ...empty })
    expect(first.tombstones[entityKey('shot', 'C')]).toEqual({ counter: 4, deviceId: 'pc' })

    // The phone was offline and now reports an older edit of the same shot.
    const stale = op({ entityId: 'C', version: { counter: 3, deviceId: 'phone' } })
    const second = reconcile({ incoming: [stale], versions: first.versions, tombstones: first.tombstones })
    expect(second.accepted).toEqual([])
    expect(second.rejected).toBe(1)
    expect(second.tombstones[entityKey('shot', 'C')]).not.toBeNull()
  })

  it('lets a newer edit win over an older delete (resurrection is explicit, not accidental)', () => {
    const del = op({ entityId: 'C', operation: 'delete', version: { counter: 4, deviceId: 'pc' } })
    const first = reconcile({ incoming: [del], ...empty })
    const newer = op({ entityId: 'C', version: { counter: 9, deviceId: 'phone' }, data: { notes: 'restored' } })
    const second = reconcile({ incoming: [newer], versions: first.versions, tombstones: first.tombstones })
    expect(second.accepted).toHaveLength(1)
    expect(second.tombstones[entityKey('shot', 'C')]).toBeUndefined()
  })

  it('drops duplicate deliveries', () => {
    const dup = op({ entityId: 'A', version: { counter: 1, deviceId: 'pc' } })
    const first = reconcile({ incoming: [dup], ...empty })
    const again = reconcile({ incoming: [dup], versions: first.versions, tombstones: first.tombstones })
    expect(first.accepted).toHaveLength(1)
    expect(again.accepted).toHaveLength(0)
    expect(again.rejected).toBe(1)
  })

  it('reports a clock that has seen every remote version', () => {
    const remote = op({ entityId: 'A', version: { counter: 12, deviceId: 'pc' } })
    const older = op({ entityId: 'A', version: { counter: 3, deviceId: 'phone' } })
    const result = reconcile({ incoming: [remote, older], ...empty })
    expect(result.clock).toBe(12)
  })

  it('tracks cursors per source device so several peers can sync', () => {
    const fromPc = op({ entityId: 'A', version: { counter: 1, deviceId: 'pc' } })
    const fromTablet = op({ entityId: 'B', version: { counter: 2, deviceId: 'tablet' } })
    const cursors = advanceCursors({}, [fromPc, fromTablet])
    expect(cursors).toEqual({ pc: fromPc.seq, tablet: fromTablet.seq })

    const newerPc = op({ entityId: 'C', version: { counter: 3, deviceId: 'pc' } })
    expect(opsSince([fromPc, fromTablet, newerPc], cursors)).toEqual([newerPc])
  })
})
