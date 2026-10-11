import type { ProviderId } from '../ports/llm'

/**
 * How the board presents a parsed script.
 * - 'default' — the canvas mode: cards + visible edge nodes so the user
 *   can draw threads; no guide lines, no badges, no planner. (Lowest
 *   friction: a clean, empty board.)
 * - 'fast' — setup-grouped guides: AI threads, S-badges, ⚡ shoot order.
 *   The only mode that shows its status as a live strip.
 * - 'custom' — minimal: just the cards with their own threads; no AI
 *   guides, no badges, no planner. Activates once the user draws the
 *   first thread.
 * - 'blend' — the user's own threads merged over the AI guides, so the
 *   board shows both tiers at once.
 */
export type BoardMode = 'default' | 'fast' | 'custom' | 'blend'

/** Local device settings — never synced, never sent anywhere but providers. */
export interface Settings {
  provider: ProviderId
  /** User-supplied BYOK token; stored in local browser storage only. */
  api_key: string
  model: string
  base_url: string | null
  /** Viewport layout override for testing; 'auto' follows the breakpoint. */
  viewport: 'auto' | 'desktop' | 'mobile'
  /** Board presentation mode (parse entry, Settings, mobile switch). */
  board_mode: BoardMode
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  api_key: '',
  model: 'gemini-2.5-flash',
  base_url: null,
  viewport: 'auto',
  board_mode: 'fast',
}

/** Mode catalogue shared by parse entry, Settings, the planner and mobile. */
export const BOARD_MODES: ReadonlyArray<{ id: BoardMode; label: string; hint: string }> = [
  {
    id: 'default',
    label: 'Default',
    hint: 'Cards with edge nodes — draw your own threads.',
  },
  {
    id: 'fast',
    label: 'Fastest',
    hint: 'AI guide threads, S-badges and the shoot-order planner.',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Your own threads only — no AI guides or badges.',
  },
  {
    id: 'blend',
    label: 'Blend',
    hint: 'Your threads on top of the AI guides.',
  },
]

/** Minimal "mode" card shown on the board instead of the full mode name. */
export function modeLabel(boardMode: BoardMode): string {
  return boardMode === 'blend' ? 'Blend' : boardMode === 'custom' ? 'Cust' : boardMode === 'fast' ? 'Fast' : 'Default'
}

export const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
}
