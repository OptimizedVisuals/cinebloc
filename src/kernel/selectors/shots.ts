import type { Shot } from '../model/shot'

/**
 * Derived views over the shots array. The mobile checklist NEVER reorders
 * the underlying data — it reads sortedShots, so completion tracking and
 * canvas spatial order can't fight each other (claim 5).
 */

/** Active shots first; completed sink to the bottom. Stable within groups. */
export function sortedShots(shots: Shot[]): Shot[] {
  return [...shots]
    .map((s, index) => ({ s, index }))
    .sort((a, b) => {
      if (a.s.is_completed !== b.s.is_completed) return a.s.is_completed ? 1 : -1
      if (a.s.order !== b.s.order) return a.s.order - b.s.order
      return a.index - b.index
    })
    .map(({ s }) => s)
}

export interface SceneGroup {
  scene_id: string
  scene_heading: string
  shots: Shot[]
}

/** Groups in first-appearance order, shots in canonical order. */
export function groupByScene(shots: Shot[]): SceneGroup[] {
  const groups: SceneGroup[] = []
  const seen = new Map<string, SceneGroup>()
  for (const s of [...shots].sort((a, b) => a.order - b.order)) {
    let g = seen.get(s.scene_id)
    if (!g) {
      g = { scene_id: s.scene_id, scene_heading: s.scene_heading, shots: [] }
      seen.set(s.scene_id, g)
      groups.push(g)
    }
    g.shots.push(s)
  }
  return groups
}

export interface Progress {
  completed: number
  total: number
  percent: number
}

export function completionProgress(shots: Shot[]): Progress {
  const total = shots.length
  const completed = shots.filter((s) => s.is_completed).length
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}

export function findShot(shots: Shot[], id: string): Shot | undefined {
  return shots.find((s) => s.id === id)
}
