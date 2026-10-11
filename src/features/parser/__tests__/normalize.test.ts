import { describe, expect, it } from 'vitest'
import { parseShot, type SkeletonItem } from '@/kernel'
import { normalizeSkeleton } from '../normalize'

describe('normalize: skeleton → strict shots', () => {
  it('fills defaults for a minimal item', () => {
    const [shot] = normalizeSkeleton([{ action: 'Alice enters' }])
    expect(shot).toBeDefined()
    expect(shot.size).toBe('MS')
    expect(shot.movement).toBeNull()
    expect(shot.lens).toBeNull()
    expect(shot.is_completed).toBe(false)
    expect(shot.asset_refs).toEqual([])
    expect(shot.notes).toBe('')
    expect(shot.scene_heading).toBe('UNSLUGGED')
    expect(shot.position_on_board).toEqual({ x: 64, y: 64 })
    expect(parseShot(shot)).not.toBeNull()
  })

  it('maps size aliases to the camera vocabulary', () => {
    const shots = normalizeSkeleton([
      { action: 'a', size: 'CLOSE UP' },
      { action: 'b', size: 'wide shot' },
      { action: 'c', size: 'BANANA' },
      { action: 'd', size: 'ECU' },
    ])
    expect(shots.map((s) => s.size)).toEqual(['CU', 'WS', 'MS', 'ECU'])
  })

  it('numbers shots per scene when the model omits numbers', () => {
    const shots = normalizeSkeleton([
      { scene_heading: 'INT. A - DAY', action: 'a' },
      { scene_heading: 'INT. A - DAY', action: 'b' },
      { scene_heading: 'EXT. B - NIGHT', action: 'c' },
    ])
    expect(shots.map((s) => s.shot_number)).toEqual([1, 2, 1])
    expect(shots[0].scene_id).toBe(shots[1].scene_id)
    expect(shots[2].scene_id).not.toBe(shots[0].scene_id)
  })

  it('accepts camelCase and prose keys from drifting models', () => {
    const item: SkeletonItem = {
      sceneHeading: 'EXT. DOCK - DAWN',
      shotNumber: 3,
      action: 'Fog rolls in',
      cameraSize: 'WS',
      cameraMovement: 'CRANE',
      characterName: 'Boatswain',
    }
    const [shot] = normalizeSkeleton([item])
    expect(shot.scene_heading).toBe('EXT. DOCK - DAWN')
    expect(shot.shot_number).toBe(3)
    expect(shot.size).toBe('WS')
    expect(shot.movement).toBe('CRANE')
    expect(shot.character).toBe('BOATSWAIN')
    expect(parseShot(shot)).not.toBeNull()
  })

  it('assigns stable order and grid positions', () => {
    const shots = normalizeSkeleton([{ action: 'a' }, { action: 'b' }, { action: 'c' }])
    expect(shots.map((s) => s.order)).toEqual([0, 1, 2])
    expect(shots[1].position_on_board.x).toBeGreaterThan(shots[0].position_on_board.x)
    const ids = new Set(shots.map((s) => s.id))
    expect(ids.size).toBe(3)
  })

  it('filters junk elements', () => {
    const shots = normalizeSkeleton([{}, { action: 'real' }, { irrelevant: true }])
    expect(shots).toHaveLength(1)
    expect(shots[0].action).toBe('real')
  })

  it('produces zod-valid shots for every element', () => {
    const shots = normalizeSkeleton([
      {
        scene_heading: 'INT. LAB - NIGHT',
        shot_number: '1A',
        action: 'Bubbling flasks',
        size: 'insert',
        lens: 50,
        movement: 'dolly in',
        notes: 'practical fog',
      },
    ])
    expect(shots).toHaveLength(1)
    expect(shots[0].shot_number).toBe(1)
    expect(shots[0].lens).toBe('50')
    expect(shots[0].movement).toBe('DOLLY')
    expect(parseShot(shots[0])).not.toBeNull()
  })
})
