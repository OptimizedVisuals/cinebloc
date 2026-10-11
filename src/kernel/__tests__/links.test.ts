import { describe, expect, it } from 'vitest'
import type { Shot, ShotLink } from '../model/shot'
import {
  addLink,
  autoLinkByLocation,
  bestSides,
  deleteShot,
  removeLink,
  rotateLinkEnd,
} from '../commands/shots'
import { locationKey, setupIndexByShot, shootGroups } from '../selectors/shootOrder'

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

function link(overrides: Partial<ShotLink> = {}): ShotLink {
  return {
    id: 'link-1',
    to: 'shot-2',
    from_side: 'right',
    to_side: 'left',
    origin: 'manual',
    ...overrides,
  }
}

describe('locationKey / shootGroups', () => {
  it('normalizes sluglines: INT/EXT + place, time-of-day dropped', () => {
    expect(locationKey('INT. DINER - NIGHT')).toBe(locationKey('INT. DINER - DAY'))
    expect(locationKey('INT. DINER - NIGHT')).not.toBe(locationKey('EXT. DINER - NIGHT'))
    expect(locationKey('EXT. PARKING LOT - NIGHT')).toBe('ext|parking lot')
    expect(locationKey('INT./EXT. TRAIN - DAY')).toBe(locationKey('INT./EXT. TRAIN - NIGHT'))
  })

  it('groups by location in first-appearance order, shots in canonical order', () => {
    const shots = [
      makeShot({ id: 'a', order: 0, scene_heading: 'INT. DINER - NIGHT', shot_number: 1 }),
      makeShot({ id: 'b', order: 1, scene_heading: 'EXT. LOT - NIGHT', shot_number: 1 }),
      makeShot({ id: 'c', order: 2, scene_heading: 'INT. DINER - DAY', shot_number: 2 }),
      makeShot({ id: 'd', order: 3, scene_heading: 'INT. DINER - NIGHT', shot_number: 3 }),
    ]
    const groups = shootGroups(shots)
    expect(groups.map((g) => g.label)).toEqual(['INT. DINER', 'EXT. LOT'])
    expect(groups[0].shots.map((s) => s.id)).toEqual(['a', 'c', 'd'])

    const index = setupIndexByShot(shots)
    expect(index.get('a')).toBe(1)
    expect(index.get('c')).toBe(1)
    expect(index.get('b')).toBe(2)
    expect(index.get('d')).toBe(1)
  })
})

describe('link commands', () => {
  it('addLink stores on the source and dedupes per target', () => {
    const a = makeShot()
    let next = addLink([a], 'shot-1', link({ id: 'l1', to: 'shot-2' }))
    next = addLink(next, 'shot-1', link({ id: 'l2', to: 'shot-2', from_side: 'bottom' }))
    expect(next[0].links).toHaveLength(1)
    expect(next[0].links![0].id).toBe('l2')
    expect(next[0].links![0].from_side).toBe('bottom')
  })

  it('removeLink removes only the named thread', () => {
    const a = makeShot({
      links: [link({ id: 'l1', to: 'shot-2' }), link({ id: 'l2', to: 'shot-3' })],
    })
    const next = removeLink([a], 'shot-1', 'l1')
    expect(next[0].links!.map((l) => l.id)).toEqual(['l2'])
  })

  it('rotateLinkEnd cycles the attachment edge (right → bottom → left → top)', () => {
    const a = makeShot({ links: [link({ id: 'l1' })] })
    let shots = rotateLinkEnd([a], 'shot-1', 'l1', 'from')
    expect(shots[0].links![0].from_side).toBe('bottom')
    shots = rotateLinkEnd(shots, 'shot-1', 'l1', 'to')
    expect(shots[0].links![0].to_side).toBe('top') // left → top
    shots = rotateLinkEnd(shots, 'shot-1', 'l1', 'from')
    shots = rotateLinkEnd(shots, 'shot-1', 'l1', 'from')
    shots = rotateLinkEnd(shots, 'shot-1', 'l1', 'from')
    expect(shots[0].links![0].from_side).toBe('right')
  })

  it('deleteShot purges threads pointing at the deleted card', () => {
    const a = makeShot({ id: 'a', links: [link({ id: 'l1', to: 'b' })] })
    const b = makeShot({ id: 'b', order: 1 })
    const next = deleteShot([a, b], 'b')
    expect(next).toHaveLength(1)
    expect(next[0].links).toEqual([])
  })

  it('bestSides picks the facing edges by relative position', () => {
    const a = makeShot({ position_on_board: { x: 0, y: 0 } })
    expect(bestSides(a, makeShot({ position_on_board: { x: 400, y: 0 } }))).toEqual([
      'right',
      'left',
    ])
    expect(bestSides(a, makeShot({ position_on_board: { x: 0, y: 300 } }))).toEqual([
      'bottom',
      'top',
    ])
    expect(bestSides(a, makeShot({ position_on_board: { x: -400, y: 10 } }))).toEqual([
      'left',
      'right',
    ])
  })
})

describe('autoLinkByLocation', () => {
  const shots = [
    makeShot({ id: 'a', order: 0, scene_heading: 'INT. DINER - NIGHT', position_on_board: { x: 0, y: 0 } }),
    makeShot({ id: 'b', order: 1, scene_heading: 'EXT. LOT - NIGHT', position_on_board: { x: 400, y: 0 } }),
    makeShot({ id: 'c', order: 2, scene_heading: 'INT. DINER - DAY', position_on_board: { x: 0, y: 300 } }),
    makeShot({ id: 'd', order: 3, scene_heading: 'INT. DINER - NIGHT', position_on_board: { x: 360, y: 300 } }),
  ]

  it('chains consecutive same-location shots with AI links', () => {
    const linked = autoLinkByLocation(shots)
    const byId = new Map(linked.map((s) => [s.id, s]))
    // diner group: a → c → d ; lot group is single, no link
    expect(byId.get('a')!.links!.map((l) => l.to)).toEqual(['c'])
    expect(byId.get('a')!.links![0].origin).toBe('ai')
    expect(byId.get('c')!.links!.map((l) => l.to)).toEqual(['d'])
    expect(byId.get('b')!.links ?? []).toEqual([])
    expect(byId.get('d')!.links ?? []).toEqual([])
    // a is above c → vertical facing edges
    expect(byId.get('a')!.links![0].from_side).toBe('bottom')
    expect(byId.get('a')!.links![0].to_side).toBe('top')
  })

  it('regenerating replaces AI links but keeps manual ones', () => {
    let linked = autoLinkByLocation(shots)
    linked = addLink(linked, 'b', link({ id: 'manual-1', to: 'd', origin: 'manual' }))
    const again = autoLinkByLocation(linked)
    const byId = new Map(again.map((s) => [s.id, s]))
    expect(byId.get('b')!.links!.map((l) => l.id)).toEqual(['manual-1'])
    expect(byId.get('a')!.links).toHaveLength(1)
    expect(byId.get('a')!.links![0].origin).toBe('ai')
  })
})
