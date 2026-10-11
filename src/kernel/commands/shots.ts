import type { EdgeSide, Position, Shot, ShotLink } from '../model/shot'
import { shootGroups } from '../selectors/shootOrder'

/**
 * Pure mutation functions (commands). Never mutate inputs — always return
 * new arrays so Zustand can detect change and persist. Both layouts dispatch
 * these same commands, which is what makes updates bidirectional (claim 5).
 */

export function editShot(shots: Shot[], id: string, patch: Partial<Shot>): Shot[] {
  return shots.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s))
}

export function moveShot(shots: Shot[], id: string, position: Position): Shot[] {
  return editShot(shots, id, { position_on_board: position })
}

export function toggleShot(shots: Shot[], id: string): Shot[] {
  return shots.map((s) => (s.id === id ? { ...s, is_completed: !s.is_completed } : s))
}

export function deleteShot(shots: Shot[], id: string): Shot[] {
  return shots
    .filter((s) => s.id !== id)
    .map((s) =>
      s.links?.some((l) => l.to === id)
        ? { ...s, links: s.links.filter((l) => l.to !== id) }
        : s,
    )
}

/**
 * Connection commands (canvas graph). Links live ON the source shot, so
 * persistence, export and sync come for free with the shots array.
 */

/** Create or re-target a thread (one link per target shot). */
export function addLink(shots: Shot[], fromId: string, link: ShotLink): Shot[] {
  return shots.map((s) => {
    if (s.id !== fromId) return s
    const others = (s.links ?? []).filter((l) => l.to !== link.to && l.to !== fromId)
    return { ...s, links: [...others, link] }
  })
}

export function removeLink(shots: Shot[], fromId: string, linkId: string): Shot[] {
  return shots.map((s) =>
    s.id === fromId ? { ...s, links: (s.links ?? []).filter((l) => l.id !== linkId) } : s,
  )
}

const NEXT_SIDE: Record<EdgeSide, EdgeSide> = {
  top: 'right',
  right: 'bottom',
  bottom: 'left',
  left: 'top',
}

/** Rotate which edge of the card a thread attaches to (keep boards tidy). */
export function rotateLinkEnd(
  shots: Shot[],
  fromId: string,
  linkId: string,
  end: 'from' | 'to',
): Shot[] {
  return shots.map((s) => {
    if (s.id !== fromId) return s
    return {
      ...s,
      links: (s.links ?? []).map((l) => {
        if (l.id !== linkId) return l
        return end === 'from'
          ? { ...l, from_side: NEXT_SIDE[l.from_side] }
          : { ...l, to_side: NEXT_SIDE[l.to_side] }
      }),
    }
  })
}

/**
 * Nearest facing edges between two card positions — shortest connection
 * without crossing back over either card.
 */
export function bestSides(a: Shot, b: Shot): [EdgeSide, EdgeSide] {
  const dx = b.position_on_board.x - a.position_on_board.x
  const dy = b.position_on_board.y - a.position_on_board.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  }
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/**
 * AI same-setup linking: chain consecutive shots inside every location
 * group so the board shows the fastest shoot order (fewest re-rigs).
 * Regenerating replaces only `origin: 'ai'` links — manual threads stay.
 */
export function autoLinkByLocation(shots: Shot[]): Shot[] {
  let out = shots.map((s) =>
    s.links?.some((l) => l.origin === 'ai')
      ? { ...s, links: s.links.filter((l) => l.origin !== 'ai') }
      : s,
  )
  const byId = new Map(out.map((s) => [s.id, s]))

  for (const group of shootGroups(shots)) {
    for (let i = 0; i + 1 < group.shots.length; i++) {
      const a = byId.get(group.shots[i].id)
      const b = byId.get(group.shots[i + 1].id)
      if (!a || !b) continue
      const [from_side, to_side] = bestSides(a, b)
      const link: ShotLink = {
        id: crypto.randomUUID(),
        to: b.id,
        from_side,
        to_side,
        origin: 'ai',
      }
      out = out.map((s) => (s.id === a.id ? { ...s, links: [...(s.links ?? []), link] } : s))
      byId.set(a.id, out.find((s) => s.id === a.id)!)
    }
  }
  return out
}

export function addAssetRef(shots: Shot[], id: string, key: string): Shot[] {
  return shots.map((s) =>
    s.id === id && !s.asset_refs.includes(key) ? { ...s, asset_refs: [...s.asset_refs, key] } : s,
  )
}

export function removeAssetRef(shots: Shot[], id: string, key: string): Shot[] {
  return shots.map((s) =>
    s.id === id ? { ...s, asset_refs: s.asset_refs.filter((k) => k !== key) } : s,
  )
}

export function nextShotNumber(shots: Shot[], sceneId: string): number {
  const scene = shots.filter((s) => s.scene_id === sceneId)
  if (scene.length === 0) return 1
  return Math.max(...scene.map((s) => s.shot_number)) + 1
}
