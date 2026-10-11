import * as cmd from '@/kernel'
import type { GetState, SetState, ShotsSlice } from '../types'

/**
 * All mutations flow through kernel commands — the same functions for both
 * layouts, which is what makes updates symmetric (claim 5).
 */
export function createShotsSlice(set: SetState, _get: GetState): ShotsSlice {
  return {
    shots: [],

    setShots(shots) {
      set(() => ({ shots }))
    },

    editShot(id, patch) {
      set((state) => ({ shots: cmd.editShot(state.shots, id, patch) }))
    },

    moveShot(id, position) {
      set((state) => ({ shots: cmd.moveShot(state.shots, id, position) }))
    },

    toggleShot(id) {
      set((state) => ({ shots: cmd.toggleShot(state.shots, id) }))
    },

    deleteShot(id) {
      set((state) => ({ shots: cmd.deleteShot(state.shots, id) }))
    },

    addAssetRef(id, key) {
      set((state) => ({ shots: cmd.addAssetRef(state.shots, id, key) }))
    },

    removeAssetRef(id, key) {
      set((state) => ({ shots: cmd.removeAssetRef(state.shots, id, key) }))
    },

    addLink(fromId, link) {
      set((state) => ({ shots: cmd.addLink(state.shots, fromId, link) }))
    },

    removeLink(fromId, linkId) {
      set((state) => ({ shots: cmd.removeLink(state.shots, fromId, linkId) }))
    },

    rotateLinkEnd(fromId, linkId, end) {
      set((state) => ({ shots: cmd.rotateLinkEnd(state.shots, fromId, linkId, end) }))
    },
  }
}
