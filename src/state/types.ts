import type {
  DeviceIdentity,
  KnownDevice,
  Project,
  Settings,
  Shot,
  ShotLink,
  SyncProgress,
  SyncStatus,
  VaultStatus,
} from '@/kernel'

/** Toast feedback (rendered by the app shell, never by kernel/ui code). */
export interface Toast {
  id: string
  text: string
  tone: 'info' | 'ok' | 'error'
}

export interface ProjectSlice {
  project: Project | null
  setProject: (project: Project | null) => void
  patchProject: (patch: Partial<Project>) => void
  newProject: (title: string, script_text: string) => Project
}

export interface ShotsSlice {
  shots: Shot[]
  setShots: (shots: Shot[]) => void
  editShot: (id: string, patch: Partial<Shot>) => void
  moveShot: (id: string, position: { x: number; y: number }) => void
  toggleShot: (id: string) => void
  deleteShot: (id: string) => void
  addAssetRef: (id: string, key: string) => void
  removeAssetRef: (id: string, key: string) => void
  addLink: (fromId: string, link: ShotLink) => void
  removeLink: (fromId: string, linkId: string) => void
  rotateLinkEnd: (fromId: string, linkId: string, end: 'from' | 'to') => void
}

export type ModalKind =
  | 'parse'
  | 'aiconfig'
  | 'settings'
  | 'history'
  | 'dataexport'
  | 'dataimport'
  | 'sync'
  | null

export interface UiSlice {
  hydrated: boolean
  onboarding_done: boolean
  active_modal: ModalKind
  /** Script held while the user configures a key, then parsed automatically. */
  pending_script: string | null
  toasts: Toast[]
  vault_state: VaultStatus
  completeOnboarding: () => void
  setActiveModal: (modal: ModalKind) => void
  setPendingScript: (script: string | null) => void
  setVaultState: (state: VaultStatus) => void
  pushToast: (text: string, tone?: Toast['tone']) => string
  dismissToast: (id: string) => void
}

export interface SettingsSlice {
  settings: Settings
  setSettings: (patch: Partial<Settings>) => void
}

/**
 * Device sync (ADR 0005). The journal and the change-log tap own the data;
 * this slice is the honest status surface the UI reads, so it must never
 * claim 'connected' unless a transport actually says so.
 */
export interface SyncSlice {
  sync_enabled: boolean
  sync_device: DeviceIdentity | null
  sync_devices: KnownDevice[]
  sync_status: SyncStatus
  sync_message: string
  sync_pending: number
  sync_last_at: number | null
  sync_progress: SyncProgress
  setSyncEnabled: (enabled: boolean) => void
  setSyncDevice: (device: DeviceIdentity | null) => void
  upsertSyncDevice: (device: KnownDevice) => void
  renameSyncDevice: (deviceId: string, name: string) => void
  markSyncDeviceSynced: (deviceId: string, at: number) => void
  removeSyncDevice: (deviceId: string) => void
  setSyncStatus: (status: SyncStatus, message?: string) => void
  setSyncPending: (pending: number) => void
  setSyncProgress: (progress: SyncProgress) => void
  setSyncLastAt: (at: number | null) => void
}

export type AppState = ProjectSlice & ShotsSlice & UiSlice & SettingsSlice & SyncSlice

/** Narrowed store signatures shared by every slice initializer. */
export type SetState = (partial: (state: AppState) => Partial<AppState>) => void
export type GetState = () => AppState
