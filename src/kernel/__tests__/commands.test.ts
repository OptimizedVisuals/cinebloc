import { describe, expect, it } from 'vitest'
import type { Shot } from '../model/shot'
import {
  addAssetRef,
  deleteShot,
  editShot,
  moveShot,
  nextShotNumber,
  removeAssetRef,
  toggleShot,
} from '../commands/shots'

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'shot-1',
    scene_id: 'int-diner-night',
    scene_heading: 'INT. DINER - NIGHT',
    shot_number: 1,
    character: null,
    action: 'Alice enters',
    size: 'MS',
    lens: null,
    movement: null,
    position_on_board: { x: 0, y: 0 },
    is_completed: false,
    order: 0,
    asset_refs: [],
    notes: '',
    ...overrides,
  }
}

describe('kernel shot commands', () => {
  it('moveShot updates coordinates without touching other shots', () => {
    const a = makeShot()
    const b = makeShot({ id: 'shot-2', order: 1 })
    const next = moveShot([a, b], 'shot-1', { x: 130, y: 260 })
    expect(next[0].position_on_board).toEqual({ x: 130, y: 260 })
    expect(next[1]).toBe(b)
  })

  it('toggleShot flips completion immutably', () => {
    const a = makeShot()
    const next = toggleShot([a], 'shot-1')
    expect(next[0].is_completed).toBe(true)
    expect(a.is_completed).toBe(false)
    expect(toggleShot(next, 'shot-1')[0].is_completed).toBe(false)
  })

  it('editShot patches fields but cannot override id', () => {
    const a = makeShot()
    const next = editShot([a], 'shot-1', { size: 'CU', id: 'hacked' } as Partial<Shot>)
    expect(next[0].size).toBe('CU')
    expect(next[0].id).toBe('shot-1')
  })

  it('asset refs add once and remove cleanly', () => {
    const a = makeShot()
    let next = addAssetRef([a], 'shot-1', 'k1')
    next = addAssetRef(next, 'shot-1', 'k1')
    expect(next[0].asset_refs).toEqual(['k1'])
    next = removeAssetRef(next, 'shot-1', 'k1')
    expect(next[0].asset_refs).toEqual([])
  })

  it('deleteShot removes only the target', () => {
    const a = makeShot()
    const b = makeShot({ id: 'shot-2' })
    const next = deleteShot([a, b], 'shot-1')
    expect(next.map((s) => s.id)).toEqual(['shot-2'])
  })

  it('nextShotNumber computes per-scene numbering', () => {
    const a = makeShot({ shot_number: 3 })
    expect(nextShotNumber([a], 'int-diner-night')).toBe(4)
    expect(nextShotNumber([a], 'other-scene')).toBe(1)
  })
})
