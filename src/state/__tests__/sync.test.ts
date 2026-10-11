import { describe, expect, it } from 'vitest'
import { completionProgress, sortedShots, type Shot } from '@/kernel'
import { createTestStore } from '../store'

/**
 * Claim 5 verification: both layouts are projections of one store. A change
 * made "in the checklist" is immediately visible to the canvas projection
 * and vice versa — with no reload and no server.
 */

function seed(): Shot[] {
  return [0, 1, 2].map((i) => ({
    id: `shot-${i}`,
    scene_id: 'int-diner-night',
    scene_heading: 'INT. DINER - NIGHT',
    shot_number: i + 1,
    character: null,
    action: `Action ${i}`,
    size: 'MS' as const,
    lens: null,
    movement: null,
    position_on_board: { x: 64 + i * 360, y: 64 },
    is_completed: false,
    order: i,
    asset_refs: [],
    notes: '',
  }))
}

describe('bidirectional sync between layouts (claim 5)', () => {
  it('a checklist toggle is instantly visible to the canvas projection', () => {
    const store = createTestStore()
    store.setState({ shots: seed() })

    // checklist dispatches the toggle
    store.getState().toggleShot('shot-1')

    // canvas reads state.shots directly
    const canvasView = store.getState().shots.find((s) => s.id === 'shot-1')
    expect(canvasView?.is_completed).toBe(true)

    // checklist reads sortedShots — completed sunk to bottom
    const checklistView = sortedShots(store.getState().shots)
    expect(checklistView[checklistView.length - 1].id).toBe('shot-1')
  })

  it('a canvas drag is visible to the checklist without disturbing order', () => {
    const store = createTestStore()
    store.setState({ shots: seed() })
    const orderBefore = sortedShots(store.getState().shots).map((s) => s.id)

    // canvas dispatches the drag
    store.getState().moveShot('shot-2', { x: 999, y: 555 })

    // canvas projection shows new coordinates
    expect(store.getState().shots.find((s) => s.id === 'shot-2')?.position_on_board).toEqual({
      x: 999,
      y: 555,
    })

    // checklist projection still renders the same sequence (order untouched)
    expect(sortedShots(store.getState().shots).map((s) => s.id)).toEqual(orderBefore)
  })

  it('completion progress agrees across every read path', () => {
    const store = createTestStore()
    store.setState({ shots: seed() })

    store.getState().toggleShot('shot-0')
    store.getState().toggleShot('shot-2')

    expect(completionProgress(store.getState().shots)).toEqual({
      completed: 2,
      total: 3,
      percent: 67,
    })
    const sorted = sortedShots(store.getState().shots)
    // exactly one active row remains, and it comes first; both completed sink
    expect(sorted[0]).toMatchObject({ id: 'shot-1', is_completed: false })
    expect(sorted.slice(1).every((s) => s.is_completed)).toBe(true)
  })

  it('field edits from either side land on the same record', () => {
    const store = createTestStore()
    store.setState({ shots: seed() })

    store.getState().editShot('shot-0', { size: 'ECU', lens: '85mm', notes: 'golden hour' })
    const record = store.getState().shots[0]
    expect(record.size).toBe('ECU')
    expect(record.lens).toBe('85mm')
    expect(record.notes).toBe('golden hour')

    store.getState().toggleShot('shot-0')
    expect(store.getState().shots[0]).toMatchObject({ size: 'ECU', is_completed: true })
  })
})
