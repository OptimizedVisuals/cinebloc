import { useShallow } from 'zustand/react/shallow'
import {
  completionProgress,
  findShot,
  groupByScene,
  shootOrderList,
  sortedShots,
  type Progress,
  type SceneGroup,
  type Settings,
  type Shot,
} from '@/kernel'
import { useAppStore } from './store'

/** Raw shots (canvas uses this directly — order + spatial coordinates). */
export function useShots(): Shot[] {
  return useAppStore((s) => s.shots)
}

/** Checklist projection: active first, completed sunk to the bottom (derived). */
export function useSortedShots(): Shot[] {
  return useAppStore(useShallow((s) => sortedShots(s.shots)))
}

/**
 * Checklist order follows the board mode (feedback round): Fastest lists by
 * setup group, Default/Custom stay chronological. Completed rows sink in
 * both — the underlying array is never reordered.
 */
export function useChecklistShots(): Shot[] {
  return useAppStore(
    useShallow((s) =>
      s.settings.board_mode === 'fast' ? shootOrderList(s.shots) : sortedShots(s.shots),
    ),
  )
}

export function useProgress(): Progress {
  return useAppStore(useShallow((s) => completionProgress(s.shots)))
}

export function useSceneGroups(): SceneGroup[] {
  return useAppStore(useShallow((s) => groupByScene(s.shots)))
}

export function useShot(id: string | null): Shot | undefined {
  return useAppStore((s) => (id ? findShot(s.shots, id) : undefined))
}

export function useSettings(): Settings {
  return useAppStore((s) => s.settings)
}

/** Device-sync status surface (ADR 0005). Safe to render when sync is off. */
export function useSyncState() {
  return useAppStore(
    useShallow((s) => ({
      enabled: s.sync_enabled,
      status: s.sync_status,
      message: s.sync_message,
      pending: s.sync_pending,
      lastAt: s.sync_last_at,
      progress: s.sync_progress,
      device: s.sync_device,
      devices: s.sync_devices,
    })),
  )
}
