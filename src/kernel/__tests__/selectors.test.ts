import { describe, expect, it } from 'vitest'
import type { Shot } from '../model/shot'
import { completionProgress, groupByScene, sortedShots } from '../selectors/shots'

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: crypto.randomUUID(),
    scene_id: 's1',
    scene_heading: 'INT. ONE - DAY',
    shot_number: 1,
    character: null,
    action: 'x',
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

describe('selectors', () => {
  it('sortedShots sinks completed shots without mutating the source', () => {
    const a = makeShot({ order: 0 })
    const b = makeShot({ order: 1, is_completed: true })
    const c = makeShot({ order: 2 })
    const source = [a, b, c]

    const sorted = sortedShots(source)
    expect(sorted.map((s) => s.id)).toEqual([a.id, c.id, b.id])

    // source untouched (claim 5: derived view, never a mutation)
    expect(source.map((s) => s.id)).toEqual([a.id, b.id, c.id])
    expect(source[1].is_completed).toBe(true)
  })

  it('sortedShots keeps canonical order among equals (stable)', () => {
    const shots = [makeShot({ order: 2 }), makeShot({ order: 0 }), makeShot({ order: 1 })]
    expect(sortedShots(shots).map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('completionProgress counts and rounds', () => {
    const shots = [makeShot({ is_completed: true }), makeShot(), makeShot(), makeShot()]
    const p = completionProgress(shots)
    expect(p).toEqual({ completed: 1, total: 4, percent: 25 })
    expect(completionProgress([])).toEqual({ completed: 0, total: 0, percent: 0 })
  })

  it('groupByScene groups in first-appearance order with canonical shots', () => {
    const shots = [
      makeShot({ scene_id: 'a', scene_heading: 'INT. A - DAY', order: 1 }),
      makeShot({ scene_id: 'b', scene_heading: 'EXT. B - NIGHT', order: 2 }),
      makeShot({ scene_id: 'a', scene_heading: 'INT. A - DAY', order: 0 }),
    ]
    const groups = groupByScene(shots)
    expect(groups.map((g) => g.scene_id)).toEqual(['a', 'b'])
    expect(groups[0].shots.map((s) => s.order)).toEqual([0, 1])
  })
})
