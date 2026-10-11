import { describe, expect, it } from 'vitest'
import type { Shot } from '../model/shot'
import { shootGroups, shootOrderList } from '../selectors/shootOrder'

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

const DINER = 'INT. DINER - NIGHT'
const LOT = 'EXT. PARKING LOT - NIGHT'
const CAR = 'INT. CAR - NIGHT'

describe('shootOrderList (fastest-route checklist order)', () => {
  it('regroups shots setup by setup instead of story order', () => {
    const shots = [
      makeShot({ id: 'd1', scene_heading: DINER, order: 0 }),
      makeShot({ id: 'd2', scene_heading: DINER, order: 1 }),
      makeShot({ id: 'l1', scene_heading: LOT, order: 2 }),
      makeShot({ id: 'c1', scene_heading: CAR, order: 3 }),
      makeShot({ id: 'd3', scene_heading: DINER, order: 4 }),
    ]

    // Story order visits the diner three separate times (d1 d2 l1 c1 d3);
    // the fastest route shoots the whole diner setup in one rig.
    expect(shootOrderList(shots).map((s) => s.id)).toEqual(['d1', 'd2', 'd3', 'l1', 'c1'])
  })

  it('sinks completed shots within their own setup group', () => {
    const shots = [
      makeShot({ id: 'd1', scene_heading: DINER, order: 0, is_completed: true }),
      makeShot({ id: 'd2', scene_heading: DINER, order: 1 }),
      makeShot({ id: 'l1', scene_heading: LOT, order: 2 }),
    ]

    const list = shootOrderList(shots).map((s) => s.id)
    expect(list).toEqual(['d2', 'd1', 'l1'])
    // derived only — the stored array keeps its canonical order
    expect(shots.map((s) => s.id)).toEqual(['d1', 'd2', 'l1'])
  })

  it('returns every shot exactly once for any grouping', () => {
    const shots = [0, 1, 2, 3, 4].map((i) =>
      makeShot({ id: `s${i}`, scene_heading: i % 2 ? LOT : DINER, order: i }),
    )
    expect(shootOrderList(shots)).toHaveLength(shots.length)
    expect(new Set(shootOrderList(shots).map((s) => s.id)).size).toBe(shots.length)
    expect(shootGroups(shots).length).toBe(2)
  })
})
