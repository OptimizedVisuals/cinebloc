import { describe, expect, it } from 'vitest'
import {
  PAIRING_TTL_MS,
  formatPairingCode,
  pairingCode,
  pairingExpired,
  pairingSecondsLeft,
} from '../pairing'

const offer = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n...offer...'
const answer = 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n...answer...'

describe('pairing verification', () => {
  it('derives the same six-digit code on both devices regardless of argument order', () => {
    const host = pairingCode(offer, answer)
    const guest = pairingCode(answer, offer)
    expect(host).toBe(guest)
    expect(host).toMatch(/^\d{6}$/)
  })

  it('changes when either payload changes', () => {
    expect(pairingCode(offer, answer)).not.toBe(pairingCode(`${offer}x`, answer))
    expect(pairingCode(offer, answer)).not.toBe(pairingCode(offer, `${answer}y`))
  })

  it('formats for reading out loud', () => {
    expect(formatPairingCode('582941')).toBe('582 941')
    // A code is a number: short input is left-padded, matching pairingCode().
    expect(formatPairingCode('582')).toBe('000 582')
    expect(pairingCode('a', 'b')).toMatch(/^\d{6}$/)
  })

  it('expires pairing sessions so an old QR cannot be reused', () => {
    const created = 1_700_000_000_000
    expect(pairingExpired(created, created + PAIRING_TTL_MS - 1)).toBe(false)
    expect(pairingExpired(created, created + PAIRING_TTL_MS + 1)).toBe(true)
    expect(pairingSecondsLeft(created, created)).toBe(120)
    expect(pairingSecondsLeft(created, created + PAIRING_TTL_MS)).toBe(0)
    expect(pairingSecondsLeft(created, created + PAIRING_TTL_MS * 2)).toBe(0)
  })
})
