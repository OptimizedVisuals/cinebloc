import { beforeEach, describe, expect, it } from 'vitest'
import { defaultDeviceName, detectPlatform, loadOrCreateIdentity, renameIdentity } from '../identity'
import { createMemoryStorage, type MemoryStorage } from './memory-storage'

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', maxTouchPoints: 5 }
const ANDROID_TABLET = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 Tablet Safari', maxTouchPoints: 10 }
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 }
const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', maxTouchPoints: 0 }

describe('device identity', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it('detects the platform from navigator hints', () => {
    expect(detectPlatform(IPHONE)).toBe('mobile')
    expect(detectPlatform(ANDROID_TABLET)).toBe('tablet')
    // iPadOS masquerades as a Mac; touch points reveal it.
    expect(detectPlatform(IPAD)).toBe('tablet')
    expect(detectPlatform(WINDOWS)).toBe('desktop')
  })

  it('gives each platform a readable default name', () => {
    expect(defaultDeviceName('mobile', IPHONE)).toBe('My iPhone')
    expect(defaultDeviceName('tablet', ANDROID_TABLET)).toBe('My Tablet')
    expect(defaultDeviceName('desktop', WINDOWS)).toBe('My PC')
  })

  it('creates an identity once and reuses it across restarts', async () => {
    const first = await loadOrCreateIdentity(storage, { hints: WINDOWS })
    const second = await loadOrCreateIdentity(storage, { hints: IPHONE })

    expect(first.deviceId).toMatch(/[0-9a-f-]{20,}/)
    expect(second.deviceId).toBe(first.deviceId)
    expect(second.createdAt).toBe(first.createdAt)
    expect(first.platform).toBe('desktop')
  })

  it('keeps the id when the device is renamed, so peers still recognise it', async () => {
    const identity = await loadOrCreateIdentity(storage, { hints: WINDOWS })
    const renamed = await renameIdentity(storage, identity, "  Titan's PC  ")

    expect(renamed.name).toBe("Titan's PC")
    expect(renamed.deviceId).toBe(identity.deviceId)
    expect(await loadOrCreateIdentity(storage, { hints: WINDOWS })).toEqual(renamed)
  })

  it('ignores an empty rename rather than leaving a nameless device', async () => {
    const identity = await loadOrCreateIdentity(storage, { hints: WINDOWS })
    expect((await renameIdentity(storage, identity, '   ')).name).toBe(identity.name)
  })

  it('gives two installations different ids', async () => {
    const other = createMemoryStorage()
    const a = await loadOrCreateIdentity(storage, { hints: WINDOWS })
    const b = await loadOrCreateIdentity(other, { hints: IPHONE })
    expect(a.deviceId).not.toBe(b.deviceId)
  })
})
