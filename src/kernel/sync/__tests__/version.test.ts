import { describe, expect, it } from 'vitest'
import { advance, compareVersions, isNewerThan, maxVersion, mergeClock, sameVersion } from '../version'

describe('logical versions (ADR 0005 conflict rule)', () => {
  it('advances the clock monotonically and never reuses a counter', () => {
    const first = advance(0, 'pc')
    const second = advance(first.clock, 'pc')
    expect(first.version).toEqual({ counter: 1, deviceId: 'pc' })
    expect(second.version).toEqual({ counter: 2, deviceId: 'pc' })
    expect(isNewerThan(second.version, first.version)).toBe(true)
  })

  it('folds remote counters into the local clock so later local edits win', () => {
    // The phone saw a counter-7 op from the PC while offline.
    const clock = mergeClock(2, [{ counter: 7, deviceId: 'pc' }])
    expect(clock).toBe(7)
    const { version } = advance(clock, 'phone')
    expect(isNewerThan(version, { counter: 7, deviceId: 'pc' })).toBe(true)
  })

  it('breaks counter ties deterministically by device id', () => {
    const a = { counter: 4, deviceId: 'aaa' }
    const b = { counter: 4, deviceId: 'bbb' }
    expect(compareVersions(a, b)).toBeLessThan(0)
    expect(compareVersions(b, a)).toBeGreaterThan(0)
    expect(compareVersions(a, a)).toBe(0)
    expect(isNewerThan(b, a)).toBe(true)
    expect(isNewerThan(a, b)).toBe(false)
  })

  it('is antisymmetric and transitive, so every device picks the same winner', () => {
    const versions = [
      { counter: 1, deviceId: 'z' },
      { counter: 9, deviceId: 'a' },
      { counter: 9, deviceId: 'b' },
      { counter: 3, deviceId: 'm' },
    ]
    const shuffled = [...versions].reverse()
    expect(maxVersion(versions)).toEqual({ counter: 9, deviceId: 'b' })
    expect(maxVersion(shuffled)).toEqual({ counter: 9, deviceId: 'b' })
    expect(sameVersion(maxVersion(shuffled)!, { counter: 9, deviceId: 'b' })).toBe(true)
  })

  it('treats a missing current version as older than anything', () => {
    expect(isNewerThan({ counter: 1, deviceId: 'x' }, undefined)).toBe(true)
  })
})
