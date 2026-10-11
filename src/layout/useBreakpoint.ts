import { useEffect, useState } from 'react'

/** Reactive matchMedia listener for the desktop/mobile boundary. */
export function useBreakpoint(minWidthPx: number): boolean {
  const query = `(min-width: ${minWidthPx}px)`
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
