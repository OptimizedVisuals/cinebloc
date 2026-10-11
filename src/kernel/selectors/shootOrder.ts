import type { Shot } from '../model/shot'
import { sortedShots } from './shots'

/**
 * Setup grouping for the fastest shoot order (feedback round): shots that
 * share a location/setup — "INT. DINER" day or night — are one setup, so
 * the practical schedule shoots every card in a group before moving the
 * truck, instead of re-rigging per story order.
 *
 * Pure derivation over scene headings: the AI already produced those
 * headings during parse; this clusters them locally with zero network.
 */

/** Normalize a slugline to a setup key: INT/EXT + place, time-of-day dropped. */
export function locationKey(heading: string): string {
  const h = heading.trim().toUpperCase()
  const isExt = /^EXT/.test(h)
  const body = h.replace(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E|E\/I)\s*/, '')
  const place = body.split(/\s+-\s+/)[0]
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return `${isExt ? 'ext' : 'int'}|${slug}`
}

export interface ShootGroup {
  key: string
  /** Display label: first heading of the group without its time-of-day. */
  label: string
  shots: Shot[]
}

/** Groups ordered by first appearance; shots in canonical order within. */
export function shootGroups(shots: Shot[]): ShootGroup[] {
  const groups: ShootGroup[] = []
  const seen = new Map<string, ShootGroup>()
  for (const s of [...shots].sort((a, b) => a.order - b.order)) {
    const key = locationKey(s.scene_heading)
    let g = seen.get(key)
    if (!g) {
      g = { key, label: s.scene_heading.split(/\s+-\s+/)[0], shots: [] }
      seen.set(key, g)
      groups.push(g)
    }
    g.shots.push(s)
  }
  return groups
}

/** 1-based setup index per shot id (card badges: S1, S2 …). */
export function setupIndexByShot(shots: Shot[]): Map<string, number> {
  const map = new Map<string, number>()
  shootGroups(shots).forEach((g, i) => {
    for (const s of g.shots) map.set(s.id, i + 1)
  })
  return map
}

/**
 * Fastest-route list for the mobile checklist: setup groups in first-
 * appearance order, completed shots sunk within their own group so the
 * crew always sees the next card of the current setup first.
 */
export function shootOrderList(shots: Shot[]): Shot[] {
  return shootGroups(shots).flatMap((g) => sortedShots(g.shots))
}
