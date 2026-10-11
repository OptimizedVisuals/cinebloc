import { describe, expect, it } from 'vitest'
import { decodeQrPixels, qrGrid, qrSvgDataUrl, type QrGrid } from '../qr'

/**
 * The QR round trip the panel relies on, proven without a camera: build the
 * symbol for a payload, rasterise it to pixels exactly as a screen (or a
 * phone camera pointed at one) would present it, and read it back.
 */

/** A payload shaped like a real one: prefix + a long base64url body. */
function signalLikePayload(bodyLength: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let body = ''
  for (let i = 0; i < bodyLength; i++) body += alphabet[i % alphabet.length]
  return `recbay-sync-v1.${body}`
}

/** Modules → grayscale RGBA, with the 4-module quiet zone every QR needs. */
function rasterize(grid: QrGrid, scale = 4, quiet = 4): {
  pixels: Uint8ClampedArray
  width: number
  height: number
} {
  const side = (grid.size + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / scale) - quiet
      const col = Math.floor(x / scale) - quiet
      const dark =
        row >= 0 && col >= 0 && row < grid.size && col < grid.size && grid.dark(row, col)
      const value = dark ? 0 : 255
      const i = (y * side + x) * 4
      pixels[i] = value
      pixels[i + 1] = value
      pixels[i + 2] = value
      pixels[i + 3] = 255
    }
  }
  return { pixels, width: side, height: side }
}

describe('signalling QR codes', () => {
  it('round-trips a realistic payload through encode → pixels → decode', () => {
    const payload = signalLikePayload(1800)
    const grid = qrGrid(payload)
    expect(grid).not.toBeNull()

    const { pixels, width, height } = rasterize(grid!)
    expect(width).toBeGreaterThan(100) // a real symbol, not a stub
    expect(decodeQrPixels(pixels, width, height)).toBe(payload)
  })

  it('still round-trips a payload near the QR byte limit', () => {
    const payload = signalLikePayload(2800)
    const grid = qrGrid(payload)
    expect(grid).not.toBeNull()
    const { pixels, width, height } = rasterize(grid!)
    expect(decodeQrPixels(pixels, width, height)).toBe(payload)
  })

  it('returns null for a payload no QR symbol can carry (the copy/paste fallback)', () => {
    const payload = signalLikePayload(4000)
    expect(qrGrid(payload)).toBeNull()
    expect(qrSvgDataUrl(payload)).toBeNull()
  })

  it('renders an <img>-ready SVG data URL', () => {
    const url = qrSvgDataUrl(signalLikePayload(600))
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(url!)).toContain('<svg')
  })

  it('refuses empty text instead of drawing an empty square', () => {
    expect(qrGrid('')).toBeNull()
    expect(qrSvgDataUrl('')).toBeNull()
  })

  it('reads nothing out of a frame with no code in it', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255)
    expect(decodeQrPixels(blank, 64, 64)).toBeNull()
  })
})
