import { SCHEMA_VERSION } from '@/kernel'
import type { GetState, ProjectSlice, SetState } from '../types'

export function createProjectSlice(_set: SetState, _get: GetState): ProjectSlice {
  return {
    project: null,

    setProject(project) {
      _set(() => ({ project }))
    },

    patchProject(patch) {
      _set((state) =>
        state.project ? { project: { ...state.project, ...patch, updated_at: Date.now() } } : {},
      )
    },

    newProject(title, script_text) {
      const now = Date.now()
      const project = {
        id: crypto.randomUUID(),
        title,
        script_text,
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      }
      _set(() => ({ project }))
      return project
    },
  }
}
