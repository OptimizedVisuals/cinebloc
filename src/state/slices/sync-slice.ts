import { EMPTY_SYNC_PROGRESS } from '@/kernel'
import type { GetState, SetState, SyncSlice } from '../types'

/**
 * Device-sync state (ADR 0005). Purely presentational for now: the journal and
 * the tap own the data, and this slice is what the UI will read. Nothing here
 * claims a connection that does not exist — `sync_status` starts at 'off' and
 * only the (not yet built) transport is allowed to move it to 'connected'.
 */
export function createSyncSlice(set: SetState, _get: GetState): SyncSlice {
  return {
    sync_enabled: false,
    sync_device: null,
    sync_devices: [],
    sync_status: 'off',
    sync_message: 'Not paired yet',
    sync_pending: 0,
    sync_last_at: null,
    sync_progress: EMPTY_SYNC_PROGRESS,

    setSyncEnabled(enabled) {
      set((state) => ({
        sync_enabled: enabled,
        sync_status: enabled ? 'idle' : 'off',
        sync_message: enabled
          ? state.sync_devices.length > 0
            ? 'Waiting for a known device'
            : 'No devices paired yet'
          : 'Sync is off',
      }))
    },

    setSyncDevice(device) {
      set(() => ({ sync_device: device }))
    },

    upsertSyncDevice(device) {
      set((state) => {
        const known = state.sync_devices.some((d) => d.deviceId === device.deviceId)
        return {
          sync_devices: known
            ? state.sync_devices.map((d) => (d.deviceId === device.deviceId ? { ...d, ...device } : d))
            : [...state.sync_devices, device],
        }
      })
    },

    removeSyncDevice(deviceId) {
      set((state) => ({
        sync_devices: state.sync_devices.filter((d) => d.deviceId !== deviceId),
      }))
    },

    setSyncStatus(status, message) {
      set((state) => ({
        sync_status: status,
        sync_message: message ?? state.sync_message,
      }))
    },

    setSyncPending(pending) {
      set(() => ({ sync_pending: Math.max(0, pending) }))
    },

    setSyncProgress(progress) {
      set(() => ({ sync_progress: progress }))
    },

    setSyncLastAt(at) {
      set(() => ({ sync_last_at: at }))
    },
  }
}
