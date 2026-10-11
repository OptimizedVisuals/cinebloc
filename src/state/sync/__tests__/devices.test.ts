import { describe, expect, it } from 'vitest'
import type { DeviceIdentity, KnownDevice } from '@/kernel'
import { isTrusted, mergeKnownDevice, sortKnownDevices, trustedDeviceIds } from '../devices'

/**
 * The known-device registry (spec §7–§8). Trust lives in this row and nowhere
 * else, so these three properties matter: a first pairing creates the row, a
 * later session never rewrites local history (when it was paired, when it last
 * synced), and revocation is a removal and nothing more.
 */

function identity(deviceId: string, name: string): DeviceIdentity {
  return { deviceId, name, platform: 'mobile', createdAt: 1 }
}

describe('mergeKnownDevice', () => {
  it('creates the row on the first successful session', () => {
    const merged = mergeKnownDevice(undefined, identity('phone-1', 'My iPhone'), 500)
    expect(merged).toEqual({
      deviceId: 'phone-1',
      name: 'My iPhone',
      platform: 'mobile',
      addedAt: 500,
      lastSeenAt: 500,
      trusted: true,
    })
  })

  it('keeps when the device was paired and when it last synced', () => {
    const existing: KnownDevice = {
      deviceId: 'phone-1',
      name: 'Old name',
      platform: 'mobile',
      addedAt: 100,
      lastSeenAt: 200,
      lastSyncAt: 300,
      trusted: true,
    }
    const merged = mergeKnownDevice(existing, identity('phone-1', 'My iPhone'), 900)
    expect(merged.addedAt).toBe(100) // paired since, not "since now"
    expect(merged.lastSyncAt).toBe(300) // a completed sync is not forgotten
    expect(merged.lastSeenAt).toBe(900)
    // The live identity is the truth about that device's own name.
    expect(merged.name).toBe('My iPhone')
  })

  it('treats a fresh session as a re-trust', () => {
    const revoked: KnownDevice = {
      deviceId: 'phone-1',
      name: 'Phone',
      platform: 'mobile',
      addedAt: 1,
      lastSeenAt: 1,
      trusted: false,
    }
    expect(mergeKnownDevice(revoked, identity('phone-1', 'Phone')).trusted).toBe(true)
  })
})

describe('registry queries', () => {
  const devices: KnownDevice[] = [
    { deviceId: 'a', name: 'A', platform: 'desktop', addedAt: 1, lastSeenAt: 10, trusted: true },
    {
      deviceId: 'b',
      name: 'B',
      platform: 'mobile',
      addedAt: 2,
      lastSeenAt: 20,
      lastSyncAt: 15,
      trusted: false,
    },
    {
      deviceId: 'c',
      name: 'C',
      platform: 'tablet',
      addedAt: 3,
      lastSeenAt: 30,
      lastSyncAt: 40,
      trusted: true,
    },
  ]

  it('counts only trusted devices as peers', () => {
    expect(isTrusted(devices, 'a')).toBe(true)
    expect(isTrusted(devices, 'b')).toBe(false)
    expect(isTrusted(devices, 'missing')).toBe(false)
    expect(trustedDeviceIds(devices)).toEqual(['a', 'c'])
  })

  it('lists the most recently active device first', () => {
    expect(sortKnownDevices(devices).map((d) => d.deviceId)).toEqual(['c', 'b', 'a'])
  })
})
