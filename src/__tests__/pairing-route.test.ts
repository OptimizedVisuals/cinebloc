import { afterEach, describe, expect, it } from 'vitest'
import { encodeSignal, pairingLink, type SyncHandshake, type SyncTransportPort, type WebRtcPort } from '@/kernel'
import { consumePairingUrl, pairingPayloadInUrl, resetPairingRouteForTests, resumePendingPairing } from '@/app/pairingRoute'
import { cancelPairing, pairingState, resetPairingForTests } from '@/state/sync/pairing'
import { installSyncRuntime } from '@/state/sync/runtime'
import { resetSyncTapForTests } from '@/state/sync/tap'
import { resetAppState, useAppStore } from '@/state/store'
import { installFakeServices } from '@/state/sync/__tests__/fake-services'

/**
 * The in-app pairing route (spec §3).
 *
 * A QR scanned by the phone's own camera app arrives as a URL, and the whole
 * point of defect 2's fix is that this URL is *consumed by the app* rather than
 * being searched for or navigated to. Two things must hold: only a real RecBay
 * pairing link is acted on, and the material is used exactly once — never
 * while the app is locked, and never replayed by a refresh or a re-render.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await sleep(5)
  }
  throw new Error('condition never became true')
}

interface FakeWindow {
  win: Window
  cleared: string[]
}

function fakeWindow(href: string): FakeWindow {
  const cleared: string[] = []
  const target = {
    location: { href, pathname: '/', search: '' },
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        cleared.push(url)
        target.location.href = `https://recbay.example${url}`
      },
    },
  }
  return { win: target as unknown as Window, cleared }
}

function offerLink(): string {
  return pairingLink(
    encodeSignal({
      v: 1,
      kind: 'offer',
      sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',
      name: 'My PC',
      deviceId: 'pc-1',
      createdAt: Date.now(),
    }),
    'https://recbay.example/',
  )
}

function stubHandshake(role: 'host' | 'guest', payload: string): SyncHandshake {
  return {
    role,
    payload: () => payload,
    code: () => '123456',
    accept: async () => undefined,
    ready: () => new Promise<SyncTransportPort>(() => undefined),
    close: () => undefined,
  }
}

/** A port that answers any invitation, so the route's join path can be driven. */
function stubRtc(): WebRtcPort {
  return {
    host: async () => stubHandshake('host', 'recbay-sync-v1.offer'),
    guest: async () => stubHandshake('guest', 'recbay-sync-v1.answer'),
  }
}

let dispose: (() => void) | null = null

afterEach(() => {
  cancelPairing()
  dispose?.()
  dispose = null
  resetPairingForTests()
  resetPairingRouteForTests()
  resetSyncTapForTests()
  resetAppState()
})

describe('pairing link detection', () => {
  it('accepts a RecBay pairing link and rejects anything else', () => {
    const link = offerLink()
    expect(pairingPayloadInUrl(link)).not.toBeNull()
    expect(pairingPayloadInUrl('https://example.com/')).toBeNull()
    expect(pairingPayloadInUrl('https://example.com/?q=1')).toBeNull()
    expect(pairingPayloadInUrl('https://example.com/?pair=hello')).toBeNull()
    expect(pairingPayloadInUrl('https://example.com/#pair=recbay-sync-v1....')).toBeNull()
  })

  it('clears the fragment as it consumes it, and leaves other URLs alone', () => {
    const link = fakeWindow(offerLink())
    expect(consumePairingUrl(link.win)).toBe(true)
    expect(link.cleared).toEqual(['/'])

    const unrelated = fakeWindow('https://example.com/?q=1')
    expect(consumePairingUrl(unrelated.win)).toBe(false)
    expect(unrelated.cleared).toEqual([])
  })
})

describe('resuming a scanned link', () => {
  it('holds the payload until the app can join, then joins as the guest', async () => {
    const link = fakeWindow(offerLink())
    consumePairingUrl(link.win)

    // Not ready yet (no identity): nothing is claimed and nothing is lost.
    await resumePendingPairing()
    expect(useAppStore.getState().active_modal).toBeNull()

    installFakeServices(undefined, stubRtc())
    resetSyncTapForTests()
    resetAppState()
    useAppStore.setState({ hydrated: true, vault_state: 'off' })
    dispose = installSyncRuntime()
    await waitFor(() => useAppStore.getState().sync_device !== null)

    await resumePendingPairing()

    const state = useAppStore.getState()
    expect(state.sync_enabled).toBe(true)
    expect(state.active_modal).toBe('sync')
    expect(pairingState().role).toBe('guest')
    expect(pairingState().payload).not.toBeNull()
  })

  it('is consumed once: a second resume does nothing', async () => {
    installFakeServices(undefined, stubRtc())
    resetSyncTapForTests()
    resetAppState()
    useAppStore.setState({ hydrated: true, vault_state: 'off' })
    dispose = installSyncRuntime()
    await waitFor(() => useAppStore.getState().sync_device !== null)

    const link = fakeWindow(offerLink())
    expect(consumePairingUrl(link.win)).toBe(true)
    // `consumePairingUrl` starts the join itself; the payload is taken out of
    // the pending slot synchronously, so this second call must be a no-op.
    await resumePendingPairing()
    await waitFor(() => pairingState().phase === 'payload')
    expect(pairingState().role).toBe('guest')

    cancelPairing()
    resetPairingForTests()
    await resumePendingPairing()
    // The payload was consumed by the first join; a refresh must not replay it.
    expect(pairingState().phase).toBe('idle')
  })

  it('waits while the vault is locked instead of dropping the payload', async () => {
    installFakeServices(undefined, stubRtc())
    resetSyncTapForTests()
    resetAppState()
    useAppStore.setState({ hydrated: true, vault_state: 'off' })
    dispose = installSyncRuntime()
    await waitFor(() => useAppStore.getState().sync_device !== null)

    // The lock screen is up: the payload the user can only get once is kept.
    useAppStore.setState({ vault_state: 'locked' })
    const link = fakeWindow(offerLink())
    consumePairingUrl(link.win)
    await resumePendingPairing()
    expect(pairingState().phase).toBe('idle')
    expect(useAppStore.getState().active_modal).toBeNull()

    useAppStore.setState({ vault_state: 'unlocked' })
    await resumePendingPairing()
    expect(pairingState().role).toBe('guest')
  })
})
