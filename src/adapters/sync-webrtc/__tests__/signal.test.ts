import { describe, expect, it } from 'vitest'
import {
  PAIRING_TTL_MS,
  canonicalSignal,
  encodeSignal,
  extractPairingPayload,
  pairingLink,
  type DeviceIdentity,
} from '@/kernel'
import { createWebRtcPort } from '../index'
import { FakePeer, asPeer } from './fake-rtc'

/**
 * What the adapter must verify before an `RTCPeerConnection` sees an SDP
 * (spec §3, §8).
 *
 * The first case is defect 2 — a link from a QR scan has to work; the second is
 * one-time material expiring; the third is defect 3, and it is the one that is
 * easy to get wrong: the six-digit code both devices show is a hash of the two
 * payloads, so if either side hashes the string *as it arrived* (line-wrapped
 * by a chat client) instead of its canonical form, two honest devices are told
 * their codes do not match and a valid pairing is refused.
 */

const PC: DeviceIdentity = { deviceId: 'pc-1', name: 'PC', platform: 'desktop', createdAt: 1 }
const PHONE: DeviceIdentity = { deviceId: 'phone-1', name: 'Phone', platform: 'mobile', createdAt: 2 }

function port() {
  return createWebRtcPort({
    createPeer: () => asPeer(new FakePeer()),
    gatherTimeoutMs: 500,
    readyTimeoutMs: 200,
  })
}

describe('pairing payload handling', () => {
  it('joins from the RecBay link that a QR code carries', async () => {
    const host = await port().host(PC)
    const link = pairingLink(host.payload(), 'https://recbay.example/')

    // The link is what the camera app opens; the payload inside is unchanged.
    expect(extractPairingPayload(link)).toBe(canonicalSignal(host.payload()))

    const guest = await port().guest(PHONE, link)
    expect(guest.role).toBe('guest')
    expect(guest.payload().startsWith('recbay-sync-v1.')).toBe(true)
    host.close()
    guest.close()
  })

  it('refuses an attempt that expired, in words the user can act on', async () => {
    const stale = encodeSignal({
      v: 1,
      kind: 'offer',
      sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',
      name: 'PC',
      deviceId: 'pc-1',
      createdAt: Date.now() - PAIRING_TTL_MS - 1_000,
    })
    await expect(port().guest(PHONE, stale)).rejects.toThrow(/expired/i)
  })

  it('still accepts an invitation from a device whose clock runs ahead', async () => {
    const ahead = encodeSignal({
      v: 1,
      kind: 'offer',
      sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',
      name: 'PC',
      deviceId: 'pc-1',
      createdAt: Date.now() + 60_000,
    })
    const guest = await port().guest(PHONE, ahead)
    expect(guest.role).toBe('guest')
    guest.close()
  })

  it('derives the same code on both devices even when the transport mangled the payload', async () => {
    const host = await port().host(PC)
    const offer = host.payload()
    // Exactly what a chat client or a wrapped text field does to a long line.
    const carriedOffer = `${offer.slice(0, 60)}\n  ${offer.slice(60)}`
    const guest = await port().guest(PHONE, carriedOffer)

    const answer = guest.payload()
    await host.accept(`${answer.slice(0, 45)}\r\n${answer.slice(45)}`)

    expect(host.code()).not.toBeNull()
    expect(host.code()).toMatch(/^\d{6}$/)
    expect(guest.code()).toBe(host.code())

    // The mangle was real: normalizing changes the bytes, which is exactly why
    // normalizing is what makes the codes agree.
    expect(carriedOffer).not.toBe(canonicalSignal(carriedOffer))
    host.close()
    guest.close()
  })

  it('refuses an invitation passed where a reply was expected', async () => {
    const invited = await port().host(PC)
    const other = await port().host(PC)
    await expect(other.accept(invited.payload())).rejects.toThrow(/not a reply/i)
    invited.close()
    other.close()
  })
})
