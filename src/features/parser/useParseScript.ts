import { useState } from 'react'
import { autoLinkByLocation, LLMError, shootGroups, type Shot } from '@/kernel'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import { extractSkeletonArray, ParseError } from './repair'
import { normalizeSkeleton } from './normalize'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts'

export type ParseStatus = 'idle' | 'parsing' | 'error'

export interface ParseResult {
  status: ParseStatus
  error: string | null
  parse: (scriptText: string) => Promise<Shot[] | null>
  cancel: () => void
}

function deriveTitle(scriptText: string): string {
  const firstLine = scriptText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return 'Untitled production'
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}

/**
 * Parse pipeline (claim 1): raw script → BYOK gateway → JSON repair →
 * normalize → store command → (debounced) IndexedDB. No server of ours.
 */
export function useParseScript(): ParseResult {
  const [status, setStatus] = useState<ParseStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState<AbortController | null>(null)

  async function parse(scriptText: string): Promise<Shot[] | null> {
    const text = scriptText.trim()
    if (!text) {
      setError('Paste some screenplay text first.')
      setStatus('error')
      return null
    }

    const store = useAppStore.getState()
    const { settings } = store
    // Routing on a missing key is the caller's job — this hook only parses.
    if (!settings.api_key.trim()) {
      setError('Add your API key to parse (BYOK).')
      setStatus('error')
      return null
    }

    const abort = new AbortController()
    setController(abort)
    setStatus('parsing')
    setError(null)

    try {
      const raw = await getServices().llm.chat(
        {
          provider: settings.provider,
          api_key: settings.api_key,
          model: settings.model,
          base_url: settings.base_url,
        },
        { system: SYSTEM_PROMPT, user: buildUserPrompt(text), signal: abort.signal },
      )

      const skeleton = extractSkeletonArray(raw)
      const shots = normalizeSkeleton(skeleton)
      if (shots.length === 0) {
        throw new ParseError('The model returned an empty shot list.')
      }

      // Always start a NEW project — previous scripts stay in History.
      store.newProject(deriveTitle(text), text)
      // Guide threads only in Fastest mode; Default/Custom lay out plain cards.
      const guides = settings.board_mode === 'fast'
      store.setShots(guides ? autoLinkByLocation(shots) : shots)
      const scenes = new Set(shots.map((s) => s.scene_id)).size
      const setups = shootGroups(shots).length
      store.pushToast(
        guides
          ? `Parsed ${shots.length} shots across ${scenes} scenes · grouped into ${setups} setups.`
          : `Parsed ${shots.length} shots across ${scenes} scenes.`,
        'ok',
      )
      setStatus('idle')
      return shots
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setStatus('idle')
        return null
      }
      const message =
        cause instanceof LLMError || cause instanceof ParseError
          ? cause.message
          : cause instanceof Error
            ? `Unexpected error: ${cause.message}`
            : 'Unknown error while parsing.'
      setError(message)
      setStatus('error')
      useAppStore.getState().pushToast(message, 'error')
      return null
    } finally {
      setController(null)
    }
  }

  function cancel(): void {
    controller?.abort()
  }

  return { status, error, parse, cancel }
}
