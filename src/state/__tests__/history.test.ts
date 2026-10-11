import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Shot } from '@/kernel'
import { canRedo, canUndo, clearHistory, initHistory, redo, undo } from '../history'
import { resetAppState, useAppStore } from '../store'

// Mirror main.tsx boot: recording only happens while initialized.
initHistory()

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

/** Enter the hydrated state without recording an undo step. */
function baseline(shots: Shot[]): void {
  useAppStore.setState({ hydrated: true, vault_state: 'off', shots, project: null })
}

describe('undo / redo history', () => {
  beforeEach(() => {
    resetAppState()
    clearHistory()
  })

  it('undoes and redoes a shot change roundtrip', () => {
    const a = makeShot({ id: 'a' })
    const b = makeShot({ id: 'b', order: 1 })
    baseline([a])
    expect(canUndo()).toBe(false)

    useAppStore.setState({ shots: [a, b] })
    expect(canUndo()).toBe(true)

    expect(undo()).toBe(true)
    expect(useAppStore.getState().shots).toEqual([a])
    expect(canRedo()).toBe(true)
    expect(undo()).toBe(false) // baseline itself is not an undo step

    expect(redo()).toBe(true)
    expect(useAppStore.getState().shots).toEqual([a, b])
    expect(canRedo()).toBe(false)
  })

  it('coalesces a rapid burst (drag / typing) into one undo step', () => {
    vi.useFakeTimers()
    try {
      const a = makeShot({ id: 'a' })
      const b = makeShot({ id: 'b', order: 1 })
      const c = makeShot({ id: 'c', order: 2 })

      vi.setSystemTime(1_000)
      baseline([a])
      vi.setSystemTime(1_050)
      useAppStore.setState({ shots: [a, b] })
      vi.setSystemTime(1_100)
      useAppStore.setState({ shots: [a, b, c] })

      expect(undo()).toBe(true)
      expect(useAppStore.getState().shots).toEqual([a]) // straight back past the burst
      expect(undo()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a later, separate change is its own undo step', () => {
    vi.useFakeTimers()
    try {
      const a = makeShot({ id: 'a' })
      const b = makeShot({ id: 'b', order: 1 })

      vi.setSystemTime(2_000)
      baseline([a])
      vi.setSystemTime(2_100)
      useAppStore.setState({ shots: [a, b] })
      vi.setSystemTime(3_000) // beyond the coalesce window
      useAppStore.setState({ shots: [b] })

      expect(undo()).toBe(true)
      expect(useAppStore.getState().shots).toEqual([a, b])
      expect(undo()).toBe(true)
      expect(useAppStore.getState().shots).toEqual([a])
    } finally {
      vi.useRealTimers()
    }
  })

  it('vault lock/reset wipes the stacks (no pre-lock states via undo)', () => {
    const a = makeShot({ id: 'a' })
    const b = makeShot({ id: 'b', order: 1 })
    baseline([a])
    useAppStore.setState({ shots: [a, b] })
    expect(canUndo()).toBe(true)

    resetAppState() // hydrated true → false
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(false)
    expect(undo()).toBe(false)
  })

  it('refuses to undo while the vault is locked', () => {
    const a = makeShot({ id: 'a' })
    baseline([a])
    useAppStore.setState({ shots: [a, makeShot({ id: 'b', order: 1 })] })
    useAppStore.setState({ vault_state: 'locked' })
    expect(undo()).toBe(false)
  })
})
