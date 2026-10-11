import { runWithoutHistory } from './history'
import { runWithoutRecording } from './sync/tap'

/**
 * A *view* change: loading a project, closing the workspace, adopting a peer's
 * records. None of these is an edit by this user, so none of them may
 *   • become an undo step (Ctrl+Z must never “undo” an open or a peer's edit), or
 *   • mint sync operations (that would look like creates or deletes to peers).
 *
 * Both guards must travel together — that pairing is the whole rule, so it
 * lives in one place instead of being repeated (and eventually mis-typed).
 */
export function runViewChange(apply: () => void): void {
  runWithoutRecording(() => runWithoutHistory(apply))
}
