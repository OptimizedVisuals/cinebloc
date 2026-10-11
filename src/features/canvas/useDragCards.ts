import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore } from '@/state/store'

const GRID = 13 // snap to half the dot lattice (26px background)

function snap(n: number): number {
  return Math.round(n / GRID) * GRID
}

/**
 * Drag-and-drop reordering on the spatial canvas (claim 3): pointer events
 * translate screen deltas into position_on_board coordinates, snapped to
 * the dot grid. Writes through the same store the checklist reads (claim 5).
 */
export function useDragCards(shotId: string, origin: { x: number; y: number }) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const originRef = useRef(origin)
  originRef.current = origin

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-drag]')) return

    dragging.current = true
    startX.current = e.clientX
    startY.current = e.clientY
    const from = originRef.current
    const moveShot = useAppStore.getState().moveShot

    const onMove = (ev: globalThis.PointerEvent) => {
      if (!dragging.current) return
      const dx = ev.clientX - startX.current
      const dy = ev.clientY - startY.current
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moveShot(shotId, { x: snap(from.x + dx), y: snap(from.y + dy) })
    }

    const onUp = () => {
      dragging.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return { onPointerDown }
}
