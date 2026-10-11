import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncHandshake, SyncTransportPort, WebRtcPort } from '@/kernel'
import { resetAppState, useAppStore } from '../../store'
import {
  PAIRING_EXPIRED_MESSAGE,
  PAIRING_IDLE_MESSAGE,
  PAIRING_TTL_MS_EXPORTED,
  acceptAnswer,
  cancelPairing,
  createInvitation,
  joinWithInvitation,
  pairingSecondsRemaining,
  pairingState,
  resetPairingForTests,
} from '../pairing'
import { installSyncRuntime } from '../runtime'
import { resetSyncTapForTests } from '../tap'
import { installFakeServices } from './fake-services'

/**
 * The pairing state machine as the panel drives it: what the user sees when
 * an invitation is created, when a payload is wrong, when the two-minute
 * window lapses, and when the exchange fails underneath them. Every message
 * asserted here is a message a real user would read.
 *
 * The WebRTC port is scripted (state tests may not import adapters); the full
 * flow through the real adapter + engine is `src/__tests__/pairing-flow.test.ts`.
 */

/** Mirror of the adapter's SIGNAL_PREFIX — state tests cannot import it. */
const PREFIX = 'recbay-sync-v1.'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await sleep(10)
  }
  throw new Error('condition never became true')
}

function stubHandshake(
  role: 'host' | 'guest',
  payload: string,
  overrides: Partial<SyncHandshake> = {},
): SyncHandshake {
  // Like the real adapter: a host only derives the code once accept() has run.
  let accepted = false
  return {
    role,
    payload: () => payload,
    code: () => (role === 'guest' || accepted ? '123456' : null),
    accept: async () => {
      accepted = true
    },
    ready: () => new Promise<SyncTransportPort>(() => undefined), // stays pending
    close: () => undefined,
    ...overrides,
  }
}

interface RtcOverrides {
  host?: () => Promise<SyncHandshake>
  guest?: (offer: string) => Promise<SyncHandshake>
}

/** A port whose payloads are scripted and whose failures are deliberate. */
function stubRtc(overrides: RtcOverrides = {}): WebRtcPort {
  const defaultGuest = async (offer: string): Promise<SyncHandshake> => {
    if (!offer.startsWith(PREFIX)) {
      throw new Error('That does not look like a RecBay pairing payload.')
    }
    return stubHandshake('guest', `${PREFIX}answer-payload`)
  }
  return {
    host: overrides.host ?? (async () => stubHandshake('host', `${PREFIX}offer-payload`)),
    guest: (_identity, offer) => (overrides.guest ?? defaultGuest)(offer),
  }
}

let dispose: (() => void) | null = null

async function boot(rtc: WebRtcPort): Promise<void> {
  installFakeServices(undefined, rtc)
  resetSyncTapForTests()
  resetAppState()
  useAppStore.setState({ hydrated: true, vault_state: 'off' })
  dispose = installSyncRuntime()
  await waitFor(() => useAppStore.getState().sync_device !== null)
}

beforeEach(() => {
  resetPairingForTests()
})

afterEach(() => {
  vi.useRealTimers()
  cancelPairing()
  dispose?.()
  dispose = null
  resetPairingForTests()
  resetSyncTapForTests()
  resetAppState()
})

describe('pairing state machine', () => {
  it('creates an invitation with a payload and a visible two-minute window', async () => {
    await boot(stubRtc())
    const state = await createInvitation()

    expect(state.phase).toBe('payload')
    expect(state.role).toBe('host')
    expect(state.payload).toMatch(/^recbay-sync-v1\./)
    // The host only learns the code once the reply payload exists.
    expect(state.code).toBeNull()
    expect(state.createdAt).not.toBeNull()
    expect(pairingSecondsRemaining()).toBeGreaterThan(100)
    expect(pairingSecondsRemaining()).toBeLessThanOrEqual(PAIRING_TTL_MS_EXPORTED / 1000)
    expect(state.message).toMatch(/paste its reply/i)
  })

  it('refuses to join without an invitation, in words a user can act on', async () => {
    await boot(stubRtc())
    const empty = await joinWithInvitation('   ')
    expect(empty.phase).toBe('error')
    expect(empty.message).toBe('Paste the invitation from the other device first.')

    resetPairingForTests()
    const garbage = await joinWithInvitation('not-a-payload')
    expect(garbage.phase).toBe('error')
    expect(garbage.message).toBe('That does not look like a RecBay pairing payload.')
  })

  it('shows the reply payload and the code immediately on the joining device', async () => {
    await boot(stubRtc())
    const state = await joinWithInvitation(`${PREFIX}offer-payload`)

    expect(state.phase).toBe('payload')
    expect(state.role).toBe('guest')
    expect(state.payload).toMatch(/^recbay-sync-v1\./)
    // Both payloads are known here, so the comparison code exists at once.
    expect(state.code).toBe('123456')
    expect(state.message).toMatch(/reply/i)
  })

  it('refuses an answer when no invitation was created, and an empty answer', async () => {
    await boot(stubRtc())
    await acceptAnswer(`${PREFIX}anything`)
    expect(pairingState().phase).toBe('error')
    expect(pairingState().message).toBe('Create an invitation first.')

    resetPairingForTests()
    await createInvitation()
    await acceptAnswer('   ')
    expect(pairingState().phase).toBe('error')
    expect(pairingState().message).toBe('Paste the reply from the other device first.')
  })

  it('expires the invitation after two minutes — an old QR is dead', async () => {
    await boot(stubRtc())
    vi.useFakeTimers({ toFake: ['Date'] })
    await createInvitation()

    vi.setSystemTime(Date.now() + PAIRING_TTL_MS_EXPORTED + 1_000)
    await acceptAnswer(`${PREFIX}answer-payload`)

    const state = pairingState()
    expect(state.phase).toBe('error')
    expect(state.message).toBe(PAIRING_EXPIRED_MESSAGE)
    // The failure is also published to the shared status surface.
    expect(useAppStore.getState().sync_status).toBe('error')
    expect(useAppStore.getState().sync_message).toBe(PAIRING_EXPIRED_MESSAGE)
  })

  it('moves to connecting on a good answer, with the code both screens compare', async () => {
    await boot(stubRtc())
    await createInvitation()
    await acceptAnswer(`${PREFIX}answer-payload`)

    expect(pairingState().phase).toBe('connecting')
    expect(pairingState().code).toBe('123456')
    expect(useAppStore.getState().sync_status).toBe('connecting')
  })

  it('surfaces a transport failure instead of hanging on "connecting"', async () => {
    await boot(
      stubRtc({
        host: async () =>
          stubHandshake('host', `${PREFIX}offer-payload`, {
            ready: async () => {
              throw new Error('The other device never connected.')
            },
          }),
      }),
    )
    await createInvitation()
    await acceptAnswer(`${PREFIX}answer-payload`)

    await waitFor(() => pairingState().phase === 'error')
    expect(pairingState().message).toBe('The other device never connected.')
    expect(useAppStore.getState().sync_status).toBe('error')
  })

  it('cancelling returns to idle and resets the published status', async () => {
    await boot(stubRtc())
    await createInvitation()
    await acceptAnswer(`${PREFIX}answer-payload`)
    expect(pairingState().phase).toBe('connecting')

    cancelPairing()
    const state = pairingState()
    expect(state.phase).toBe('idle')
    expect(state.payload).toBeNull()
    expect(state.code).toBeNull()
    expect(state.createdAt).toBeNull()
    expect(state.message).toBe(PAIRING_IDLE_MESSAGE)
    expect(useAppStore.getState().sync_status).not.toBe('connecting')
    expect(useAppStore.getState().sync_status).not.toBe('error')
  })
})
