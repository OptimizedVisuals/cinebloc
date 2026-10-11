import {
  PAIRING_TTL_MS,
  pairingExpired,
  pairingSecondsLeft,
  type DeviceIdentity,
  type SyncHandshake,
  type SyncProgress,
  type SyncStatus,
} from '@/kernel'
import { getServices } from '../services'
import { useAppStore } from '../store'
import { toKnownDevice } from './devices'
import { SyncSession } from './engine'
import { getJournal, refreshPending } from './runtime'
import { flushSyncTap } from './tap'

/**
 * Manual pairing, end to end (ADR 0005).
 *
 * Signalling is out-of-band by design: this device shows one opaque payload,
 * the user carries it to the other device (QR image, AirDrop, a message to
 * themselves — the transport is the user's choice), and the other device shows
 * its payload back. Nothing here talks to a server.
 *
 * The pairing code is the integrity check on that exchange: both devices derive
 * it from the same two payloads, so if the user's payloads did not come from
 * these two devices, the session refuses to start rather than syncing with a
 * stranger.
 *
 * Automatic reconnection is deliberately absent — a fresh session always needs
 * a fresh offer/answer, and no copy in this module may suggest otherwise.
 */

export type PairingPhase = 'idle' | 'payload' | 'connecting' | 'syncing' | 'done' | 'error'

export interface PairingState {
  phase: PairingPhase
  role: 'host' | 'guest' | null
  /** Payload to hand to the other device: the offer when hosting, the answer when joining. */
  payload: string | null
  /** Code both screens must show identically; null until both payloads are known. */
  code: string | null
  createdAt: number | null
  message: string
}

export const PAIRING_EXPIRED_MESSAGE = 'This invitation expired — create a new one on the other device.'
export const PAIRING_IDLE_MESSAGE = 'Not paired yet'
export const PAIRING_TTL_MS_EXPORTED = PAIRING_TTL_MS

let state: PairingState = {
  phase: 'idle',
  role: null,
  payload: null,
  code: null,
  createdAt: null,
  message: PAIRING_IDLE_MESSAGE,
}

const listeners = new Set<() => void>()

function update(patch: Partial<PairingState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function pairingState(): PairingState {
  return state
}

export function subscribeToPairing(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let handshake: SyncHandshake | null = null
let session: SyncSession | null = null

/** Seconds before the invitation stops being usable (for the UI countdown). */
export function pairingSecondsRemaining(now: number = Date.now()): number {
  return state.createdAt === null ? 0 : pairingSecondsLeft(state.createdAt, now)
}

export function currentInvitationExpired(now: number = Date.now()): boolean {
  return state.createdAt !== null && pairingExpired(state.createdAt, now)
}

function describe(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback
}

function fail(message: string): void {
  update({ phase: 'error', message })
  useAppStore.getState().setSyncStatus('error', message)
}

/** The journal and this device's identity — both required before pairing. */
async function context(): Promise<{ device: DeviceIdentity; journal: NonNullJournal }> {
  const journal = getJournal()
  const device = useAppStore.getState().sync_device
  if (!journal || !device) {
    throw new Error('Device sync is not ready on this device yet.')
  }
  return { device, journal }
}

type NonNullJournal = NonNullable<ReturnType<typeof getJournal>>

/** Host: create the invitation payload the other device will answer. */
export async function createInvitation(): Promise<PairingState> {
  cancelPairing()
  try {
    const { device } = await context()
    // Any change made a moment ago must be in the log BEFORE the peer is told
    // what we hold, or the manifest under-reports and the change waits a session.
    await flushSyncTap()
    const created = await getServices().rtc.host(device)
    handshake = created
    update({
      phase: 'payload',
      role: 'host',
      payload: created.payload(),
      code: created.code(),
      createdAt: Date.now(),
      message: 'Show this to the other device, then paste its reply here.',
    })
  } catch (cause) {
    fail(describe(cause, 'Could not create an invitation on this device.'))
  }
  return state
}

/** Guest: consume the host's offer and produce the answer to hand back. */
export async function joinWithInvitation(invitation: string): Promise<PairingState> {
  cancelPairing()
  const trimmed = invitation.trim()
  if (trimmed.length === 0) {
    fail('Paste the invitation from the other device first.')
    return state
  }
  try {
    const { device } = await context()
    await flushSyncTap()
    const created = await getServices().rtc.guest(device, trimmed)
    handshake = created
    update({
      phase: 'payload',
      role: 'guest',
      payload: created.payload(),
      code: created.code(),
      createdAt: Date.now(),
      message: 'Show this reply to the other device to finish pairing.',
    })
    // The guest cannot connect until the host accepts the answer, so it waits
    // here rather than making the user press anything a second time.
    useAppStore.getState().setSyncStatus('connecting', 'Waiting for the other device to connect…')
    void whenReady(created)
  } catch (cause) {
    fail(describe(cause, 'That invitation could not be read.'))
  }
  return state
}

/** Host: ingest the guest's answer and connect. */
export async function acceptAnswer(answer: string): Promise<void> {
  const created = handshake
  if (!created || created.role !== 'host') {
    fail('Create an invitation first.')
    return
  }
  if (currentInvitationExpired()) {
    fail(PAIRING_EXPIRED_MESSAGE)
    return
  }
  const trimmed = answer.trim()
  if (trimmed.length === 0) {
    fail('Paste the reply from the other device first.')
    return
  }
  try {
    await created.accept(trimmed)
    update({
      phase: 'connecting',
      code: created.code(),
      message: 'Connecting to the other device…',
    })
    useAppStore.getState().setSyncStatus('connecting', 'Connecting to the other device…')
    void whenReady(created)
  } catch (cause) {
    fail(describe(cause, 'That reply could not be read.'))
  }
}

/** Wait for the channel, then run the session. One session per pairing. */
async function whenReady(created: SyncHandshake): Promise<void> {
  try {
    const transport = await created.ready()
    if (handshake !== created) {
      // A newer pairing (or a cancel) superseded this one.
      transport.close()
      return
    }
    const { device, journal } = await context()

    update({ phase: 'syncing', message: 'Syncing…' })
    const running = new SyncSession({
      identity: device,
      journal,
      storage: getServices().storage,
      role: created.role,
      code: created.code(),
      isBlocked: () => useAppStore.getState().vault_state === 'locked',
      activeProjectId: () => useAppStore.getState().project?.id ?? null,
      readSettings: () => ({ board_mode: useAppStore.getState().settings.board_mode }),
      onStatus: (status: SyncStatus, message: string) => {
        useAppStore.getState().setSyncStatus(status, message)
      },
      onProgress: (progress: SyncProgress) => {
        useAppStore.getState().setSyncProgress(progress)
      },
      onPeer: (peer) => {
        useAppStore.getState().upsertSyncDevice(toKnownDevice(peer))
        refreshPending()
      },
    })
    session = running
    const result = await running.start(transport)
    if (session === running) session = null

    if (result.status === 'done') {
      useAppStore.getState().setSyncLastAt(Date.now())
      refreshPending()
      update({
        phase: 'done',
        code: created.code(),
        message: `Up to date with ${result.peer?.name ?? 'the other device'}.`,
      })
      return
    }
    fail(result.message)
  } catch (cause) {
    fail(describe(cause, 'Pairing failed. Start again and retry.'))
  }
}

/** Abandon the current pairing and release the connection. */
export function cancelPairing(): void {
  session?.close()
  session = null
  handshake?.close()
  handshake = null
  update({
    phase: 'idle',
    role: null,
    payload: null,
    code: null,
    createdAt: null,
    message: PAIRING_IDLE_MESSAGE,
  })
  const store = useAppStore.getState()
  if (store.sync_status === 'syncing' || store.sync_status === 'connecting') {
    store.setSyncStatus(store.sync_enabled ? 'idle' : 'off', 'Not paired yet')
  }
}

/** Tests only: drop module state between cases. */
export function resetPairingForTests(): void {
  session?.close()
  session = null
  handshake?.close()
  handshake = null
  listeners.clear()
  state = {
    phase: 'idle',
    role: null,
    payload: null,
    code: null,
    createdAt: null,
    message: PAIRING_IDLE_MESSAGE,
  }
}
