import { clearHistory } from './history'
import { flushPersistence } from './persistence'
import { getServices } from './services'
import { useAppStore } from './store'
import { runViewChange } from './viewChanges'

/**
 * Switch the live workspace to another stored project. Shared by the
 * history modal and the empty-board project list, so both paths flush
 * pending edits, load, and toast identically.
 */
export async function openProject(id: string): Promise<boolean> {
  try {
    // Flush pending edits into the CURRENT project before switching away.
    await flushPersistence()
    const { storage } = getServices()
    const [project, shots] = await Promise.all([
      storage.loadProject(id),
      storage.listShots(id),
    ])
    if (!project) {
      useAppStore.getState().pushToast('That project no longer exists.', 'error')
      return false
    }
    const state = useAppStore.getState()
    // Opening a project is a *view* change: the records already exist in
    // IndexedDB. Recording it would mint create-ops for every shot each time a
    // project is opened, and would make Ctrl+Z look like a project deletion.
    runViewChange(() => {
      state.setProject(project)
      state.setShots(shots)
    })
    state.pushToast(`Opened “${project.title}” — ${shots.length} shots.`, 'ok')
    return true
  } catch (cause) {
    console.error('open project failed', cause)
    useAppStore.getState().pushToast('Could not open that project.', 'error')
    return false
  }
}

/**
 * Close the live workspace and land on Home. Pending edits are flushed into
 * the project first; `active_project_id` is left intact so Home can still
 * offer "Continue" for it. Undo history is dropped — snapshots of a closed
 * project must not reappear over the homepage.
 */
export async function goHome(): Promise<void> {
  const state = useAppStore.getState()
  if (!state.project) return
  await flushPersistence()
  clearHistory()
  const live = useAppStore.getState()
  // Closing the workspace must never look like “this project was deleted”.
  runViewChange(() => {
    live.setProject(null)
    live.setShots([])
  })
}
