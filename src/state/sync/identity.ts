import type { DeviceIdentity, DevicePlatform, StoragePort } from '@/kernel'

/**
 * Persistent device identity (ADR 0005, spec §8).
 *
 * Generated once on the device, stored locally, and reused forever: it is the
 * `deviceId` half of every logical version and the key peers use to recognise
 * a trusted device. It is deliberately NOT derived from anything network- or
 * account-related, so two installations can never collide.
 *
 * Stored in IndexedDB meta (encrypted at rest when the vault is on), which
 * means an “erase local data” wipe also forgets the identity — a wiped device
 * presents itself as a new device and must pair again.
 */

const IDENTITY_KEY = 'sync_identity'

/** Identity creation needs secure-context crypto (see the ADR): HTTPS or localhost. */
export function hasSecureCrypto(): boolean {
  return typeof globalThis.crypto?.randomUUID === 'function'
}

export class IdentityUnavailableError extends Error {
  constructor() {
    super(
      'Device sync needs a secure context (HTTPS or localhost) for device identity.',
    )
    this.name = 'IdentityUnavailableError'
  }
}

export interface NavigatorHints {
  userAgent: string
  maxTouchPoints?: number
}

/** iPadOS reports itself as a Mac; touch points are the giveaway. */
export function detectPlatform(nav: NavigatorHints): DevicePlatform {
  const ua = nav.userAgent
  const touch = nav.maxTouchPoints ?? 0
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1)) return 'tablet'
  if (/Android|iPhone|iPod|Mobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function defaultDeviceName(platform: DevicePlatform, nav: NavigatorHints): string {
  const ua = nav.userAgent
  if (platform === 'tablet') return 'My Tablet'
  if (platform === 'mobile') return /iPhone/i.test(ua) ? 'My iPhone' : 'My Phone'
  if (/Macintosh/i.test(ua)) return 'My Mac'
  if (/Windows/i.test(ua)) return 'My PC'
  if (/Linux/i.test(ua)) return 'My Linux PC'
  return 'My Computer'
}

export async function loadIdentity(storage: StoragePort): Promise<DeviceIdentity | null> {
  const stored = await storage.getMeta<DeviceIdentity>(IDENTITY_KEY)
  if (!stored || typeof stored.deviceId !== 'string' || stored.deviceId.length === 0) return null
  return stored
}

export interface IdentityOptions {
  /** Overridable for tests; defaults to the real navigator. */
  hints?: NavigatorHints
  name?: string
}

export async function loadOrCreateIdentity(
  storage: StoragePort,
  options: IdentityOptions = {},
): Promise<DeviceIdentity> {
  const existing = await loadIdentity(storage)
  if (existing) return existing
  if (!hasSecureCrypto()) throw new IdentityUnavailableError()

  const hints = options.hints ?? {
    userAgent: globalThis.navigator?.userAgent ?? '',
    maxTouchPoints: globalThis.navigator?.maxTouchPoints,
  }
  const platform = detectPlatform(hints)
  const identity: DeviceIdentity = {
    deviceId: globalThis.crypto.randomUUID(),
    name: options.name ?? defaultDeviceName(platform, hints),
    platform,
    createdAt: Date.now(),
  }
  await storage.setMeta(IDENTITY_KEY, identity)
  return identity
}

/** Rename keeps the id — peers keep recognising the device (spec §17). */
export async function renameIdentity(
  storage: StoragePort,
  identity: DeviceIdentity,
  name: string,
): Promise<DeviceIdentity> {
  const trimmed = name.trim()
  const next: DeviceIdentity = { ...identity, name: trimmed.length > 0 ? trimmed : identity.name }
  await storage.setMeta(IDENTITY_KEY, next)
  return next
}
