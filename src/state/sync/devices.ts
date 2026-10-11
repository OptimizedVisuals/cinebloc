import type { DeviceIdentity, KnownDevice, StoragePort } from '@/kernel'

/**
 * KnownDeviceRegistry (ADR 0005, spec §16–§17).
 *
 * The durable record of which devices this installation has paired with. It is
 * the source of truth for “do we recognise this peer?” — trust lives here, not
 * in a token, so forgetting a device simply removes the row and a future
 * connection attempt from it is treated as an unknown device that must be
 * paired again.
 *
 * Forgetting never touches projects: it removes a relationship, not data.
 */

const DEVICES_KEY = 'sync_devices'

/**
 * Fold a peer we have just talked to into the registry.
 *
 * A peer we meet is not always a peer we already know: the first successful
 * session *is* the pairing ceremony and adds the row. For a known device the
 * local facts — when it was first paired and when it last completed a sync —
 * are carried over, because re-deriving them from "now" on every session would
 * make "last sync" meaningless and quietly reset "paired since".
 */
export function mergeKnownDevice(
  existing: KnownDevice | undefined,
  identity: DeviceIdentity,
  now: number = Date.now(),
): KnownDevice {
  const base: KnownDevice =
    existing ??
    ({
      deviceId: identity.deviceId,
      name: identity.name,
      platform: identity.platform,
      addedAt: now,
      lastSeenAt: now,
      trusted: true,
    } satisfies KnownDevice)
  return {
    ...base,
    // The live identity wins for name/platform: a rename on the other device is
    // the truth about that device.
    name: identity.name,
    platform: identity.platform,
    lastSeenAt: now,
    trusted: true,
  }
}

export async function loadKnownDevices(storage: StoragePort): Promise<KnownDevice[]> {
  const stored = await storage.getMeta<unknown>(DEVICES_KEY)
  if (!Array.isArray(stored)) return []
  return stored.filter(isKnownDevice)
}

export async function saveKnownDevices(
  storage: StoragePort,
  devices: readonly KnownDevice[],
): Promise<void> {
  await storage.setMeta(DEVICES_KEY, devices)
}

function isKnownDevice(value: unknown): value is KnownDevice {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw['deviceId'] === 'string' &&
    raw['deviceId'].length > 0 &&
    typeof raw['name'] === 'string' &&
    (raw['platform'] === 'desktop' || raw['platform'] === 'mobile' || raw['platform'] === 'tablet') &&
    typeof raw['addedAt'] === 'number'
  )
}

export function isTrusted(devices: readonly KnownDevice[], deviceId: string): boolean {
  return devices.some((device) => device.deviceId === deviceId && device.trusted)
}

export function trustedDeviceIds(devices: readonly KnownDevice[]): string[] {
  return devices.filter((device) => device.trusted).map((device) => device.deviceId)
}

/** Newest activity first, so the device list reads like a recency list. */
export function sortKnownDevices(devices: readonly KnownDevice[]): KnownDevice[] {
  return [...devices].sort((a, b) => {
    const aAt = a.lastSyncAt ?? a.lastSeenAt
    const bAt = b.lastSyncAt ?? b.lastSeenAt
    return bAt - aAt
  })
}
