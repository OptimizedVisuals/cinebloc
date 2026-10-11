import { Toggle } from '@/ui'
import { useAppStore } from '@/state/store'
import type { Shot } from '@/kernel'

/**
 * High-friction touch target (claim 4): flips is_completed on the shared
 * store — the row dims/strikethroughs and sinks, instantly, on any layout.
 */
export function CompleteToggle({ shot }: { shot: Shot }) {
  const toggleShot = useAppStore((s) => s.toggleShot)
  return (
    <Toggle
      checked={shot.is_completed}
      onChange={() => toggleShot(shot.id)}
      label={`Mark shot ${shot.shot_number} of ${shot.scene_heading} ${
        shot.is_completed ? 'incomplete' : 'complete'
      }`}
    />
  )
}
