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

export function toKnownDevice(identity: DeviceIdentity, trusted = true): KnownDevice {
  const now = Date.now()
  return {
    deviceId: identity.deviceId,
    name: identity.name,
    platform: identity.platform,
    addedAt: now,
    lastSeenAt: now,
    trusted,
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
