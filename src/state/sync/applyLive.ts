import { useAppStore } from '../store'
import { runViewChange } from '../viewChanges'
import type { RemoteApplyResult } from './applyOps'

/**
 * Write an applied remote batch into the live store.
 *
 * Everything here is a *view* change from this device's point of view, so it
 * goes through `runViewChange`:
 *   • no new local ops — otherwise the tap would re-log the peer's change and
 *     the two devices would ping-pong operations forever;
 *   • no undo entries — otherwise Ctrl+Z here would “undo” an edit that
 *     happened on the other device.
 *
 * The records themselves were already written to IndexedDB by `applyRemoteOps`,
 * so this only refreshes what the user is currently looking at.
 */
export function applyRemoteToStore(
  result: Pick<RemoteApplyResult, 'liveProject' | 'liveShots' | 'liveSettings'>,
): void {
  const touchesLive =
    result.liveProject !== undefined || result.liveShots !== undefined || result.liveSettings !== undefined
  if (!touchesLive) return

  runViewChange(() => {
    const state = useAppStore.getState()
    if (result.liveProject !== undefined) state.setProject(result.liveProject)
    if (result.liveShots !== undefined) state.setShots(result.liveShots)
    if (result.liveSettings) state.setSettings(result.liveSettings)
  })
}
