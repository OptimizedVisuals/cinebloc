import { create } from 'zustand'
import { createProjectSlice } from './slices/project-slice'
import { createSettingsSlice } from './slices/settings-slice'
import { createShotsSlice } from './slices/shots-slice'
import { createSyncSlice } from './slices/sync-slice'
import { createUiSlice } from './slices/ui-slice'
import type { AppState, GetState, SetState } from './types'

/**
 * The single local data model wrapper (claim 5): both the desktop canvas and
 * the mobile checklist read and write THIS store, so any change made in one
 * layout is instantly reflected in the other — no server involved.
 */
export function initializeState(set: SetState, get: GetState): AppState {
  return {
    ...createProjectSlice(set, get),
    ...createShotsSlice(set, get),
    ...createUiSlice(set, get),
    ...createSettingsSlice(set, get),
    ...createSyncSlice(set, get),
  }
}

export const useAppStore = create<AppState>()((set, get) => initializeState(set, get))

/** Fresh isolated store for tests. */
export const createTestStore = () =>
  create<AppState>()((set, get) => initializeState(set, get))

/**
 * Reset to a clean state (used on lock and on vault erase so no plaintext
 * stays resident in memory while the vault is locked).
 */
export function resetAppState(): void {
  useAppStore.setState(
    initializeState(useAppStore.setState, useAppStore.getState),
    true,
  )
}
