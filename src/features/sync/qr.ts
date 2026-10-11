import jsQR from 'jsqr'
import qrcode from 'qrcode-generator'

/**
 * QR rendering and decoding for manual signalling (ADR 0005).
 *
 * The signalling payload is a single base64url line that can reach a couple of
 * kilobytes (it carries a full SDP with all ICE candidates, because manual
 * signalling has no trickle channel). Two facts follow:
 *
 *   • Encoding uses error correction "L" and an automatic symbol size, so the
 *     payload fits whenever any QR symbol can hold it. When it cannot, the
 *     caller gets `null` and must fall back to copy/paste — a silently
 *     truncated code would be worse than no code.
 *   • Decoding is a pure function over pixels, so the QR round trip is proven
 *     by a unit test (encode → rasterize → decode) without a camera.
 *
 * Both functions are dependency-thin wrappers: `qrcode-generator` builds the
 * symbol, `jsQR` reads it. Nothing here knows what a payload means — that is
 * `adapters/sync-webrtc/signal.ts`'s job.
 */

export interface QrGrid {
  /** Side length in modules, finder patterns included. */
  size: number
  dark: (row: number, col: number) => boolean
}

/** EC level L: maximum capacity for a long SDP payload. Read at close range. */
const EC_LEVEL = 'L' as const

/**
 * Build the symbol for `text`, or null when the text is too long for any QR
 * version (the library throws "code length overflow" in that case).
 */
export function qrGrid(text: string): QrGrid | null {
  if (text.length === 0) return null
  try {
    const code = qrcode(0, EC_LEVEL) // 0 = automatic symbol size
    code.addData(text)
    code.make()
    const size = code.getModuleCount()
    return { size, dark: (row, col) => code.isDark(row, col) }
  } catch {
    return null
  }
}

/**
 * The symbol as an SVG data URL for an <img>. SVG rather than canvas so the
 * same code path works in every browser without a rasteriser.
 */
export function qrSvgDataUrl(text: string): string | null {
  if (text.length === 0) return null
  try {
    const code = qrcode(0, EC_LEVEL)
    code.addData(text)
    code.make()
    // 8 px per module with a 4-module quiet zone: sharp at any zoom.
    const svg = code.createSvgTag({ cellSize: 8, margin: 32, scalable: false })
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    return null
  }
}

/**
 * Read one frame of pixels back into text, or null when it holds no QR code.
 * Used by the camera scanner — and by the round-trip test, with the camera
 * replaced by a rasterised grid.
 */
export function decodeQrPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  try {
    const found = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })
    return found === null ? null : found.data
  } catch {
    return null // an unreadable frame is not an error, just a miss
  }
}
