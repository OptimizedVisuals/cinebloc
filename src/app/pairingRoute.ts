import { extractPairingPayload } from '@/kernel'
import { joinWithInvitation } from '@/state/sync'
import { useAppStore } from '@/state/store'

/**
 * The in-app pairing route (spec §3).
 *
 * A pairing QR carries a RecBay link so the phone's own camera app can open the
 * app instead of offering a web search — the raw opaque payload had no URL for
 * any reader to route, and nothing on this side consumed one (defect 2). The
 * payload is in the *fragment*: fragments are never sent to a server, never
 * appear in a `Referer`, and cannot land in an access log.
 *
 * Two rules keep this safe and honest:
 *
 *   1. **Nothing is navigated to.** The link's origin is irrelevant; only the
 *      `pair` field is read, and its value must validate as a RecBay payload.
 *      An arbitrary scanned URL is simply not a pairing link.
 *   2. **It is consumed exactly once, immediately.** The material is one-time
 *      and short-lived, so the fragment is cleared from the address bar as soon
 *      as it is read — a refresh must not re-run a half-finished pairing, and a
 *      copied URL must not stay usable after it was used.
 *
 * The join itself waits for the app to be able to perform it (unlocked, runtime
 * booted) rather than failing while the user is still typing a password.
 */

/** Held between reading the link and the app being ready to use it. */
let pending: string | null = null

/**
 * Read a pairing link from a URL. Returns the canonical bare payload, or null
 * when this URL is not a RecBay pairing link.
 */
export function pairingPayloadInUrl(href: string): string | null {
  if (!href.includes('pair=')) return null
  return extractPairingPayload(href)
}

/**
 * Take a pairing link out of the address bar, if there is one.
 *
 * Returns true when the URL was a pairing link. The fragment is cleared in the
 * same breath, so a refresh or a re-render cannot replay it.
 */
export function consumePairingUrl(win: Window = globalThis.window): boolean {
  if (typeof win === 'undefined') return false
  const payload = pairingPayloadInUrl(win.location.href)
  if (payload === null) return false
  win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`)
  pending = payload
  void resumePendingPairing()
  return true
}

/**
 * Start the pending join once the app can actually perform it, and keep holding
 * it otherwise.
 *
 * A locked vault or a still-booting runtime is not a failure — the payload only
 * exists on the user's other screen, so dropping it would mean asking them to
 * scan again. It is therefore retained until the app is ready.
 */
export async function resumePendingPairing(): Promise<void> {
  if (pending === null) return
  const store = useAppStore.getState()
  if (store.vault_state === 'locked' || store.sync_device === null) return

  const payload = pending
  pending = null
  // A scan is an explicit "pair now": turn sync on and put the user on the
  // surface that is doing the work, so nobody has to go hunting for the flow
  // they just triggered.
  store.setSyncEnabled(true)
  store.setActiveModal('sync')
  await joinWithInvitation(payload)
}

/** Tests only: drop the held payload between cases. */
export function resetPairingRouteForTests(): void {
  pending = null
}
