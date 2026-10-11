import { DEFAULT_SETTINGS } from '@/kernel'
import type { GetState, SetState, SettingsSlice } from '../types'

export function createSettingsSlice(set: SetState, _get: GetState): SettingsSlice {
  return {
    settings: DEFAULT_SETTINGS,

    setSettings(patch) {
      set((state) => ({ settings: { ...state.settings, ...patch } }))
    },
  }
}
