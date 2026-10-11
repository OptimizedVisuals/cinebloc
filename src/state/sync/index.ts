/**
 * Device sync — public surface (ADR 0005).
 *
 * Features and the app shell import from here; the journal, tap, identity and
 * registry stay internal so the wire format and the log remain one decision
 * made in `kernel/sync` + `state/sync`.
 */
export {
  getJournal,
  installSyncRuntime,
  refreshPending,
  startSyncRuntime,
  stopSyncRuntime,
} from './runtime'
export { flushSyncTap, runWithoutRecording } from './tap'
export { applyRemoteOps, type RemoteApplyInput, type RemoteApplyResult } from './applyOps'
export { applyRemoteToStore } from './applyLive'
export {
  SyncSession,
  SYNC_LOCKED_MESSAGE,
  type SyncSessionOptions,
  type SyncSessionResult,
} from './engine'
export {
  PAIRING_EXPIRED_MESSAGE,
  PAIRING_IDLE_MESSAGE,
  PAIRING_TTL_MS_EXPORTED,
  acceptAnswer,
  cancelPairing,
  createInvitation,
  currentInvitationExpired,
  joinWithInvitation,
  pairingSecondsRemaining,
  pairingState,
  subscribeToPairing,
  type PairingPhase,
  type PairingState,
} from './pairing'
export {
  IdentityUnavailableError,
  defaultDeviceName,
  detectPlatform,
  hasSecureCrypto,
  loadIdentity,
  loadOrCreateIdentity,
  renameIdentity,
} from './identity'
export { SyncJournal, SYNC_STATE_KEY, emptyJournalState, type SyncJournalState } from './journal'
export {
  isTrusted,
  loadKnownDevices,
  mergeKnownDevice,
  saveKnownDevices,
  sortKnownDevices,
  trustedDeviceIds,
} from './devices'
export {
  disconnectSync,
  forgetDevice,
  renamePairedDevice,
  renameThisDevice,
} from './manage'
