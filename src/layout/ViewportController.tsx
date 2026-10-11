import { CanvasBoard } from '@/features/canvas'
import { SetChecklist } from '@/features/checklist'
import { useSettings } from '@/state/select'
import { DESKTOP_BREAKPOINT_PX } from './breakpoints'
import { useBreakpoint } from './useBreakpoint'

/**
 * Dynamic responsive viewport controller (claim 1): projects the SAME store
 * data into mutually exclusive layouts based on device screen dimensions.
 * Exactly one layout is mounted — on mobile the infinite canvas is stripped
 * from the DOM entirely, not hidden (claims 3 & 4).
 */
export function useViewportMode(): 'desktop' | 'mobile' {
  const settings = useSettings()
  const isWide = useBreakpoint(DESKTOP_BREAKPOINT_PX)

  return settings.viewport !== 'auto' ? settings.viewport : isWide ? 'desktop' : 'mobile'
}

export function ViewportController() {
  const mode = useViewportMode()

  return mode === 'desktop' ? <CanvasBoard /> : <SetChecklist />
}
