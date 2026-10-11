import { decodeQrPixels } from './qr'

/**
 * Camera QR scanning for manual signalling (ADR 0005).
 *
 * The payload crosses devices by whatever means the user has: a QR code when
 * two cameras are available, copy/paste when they are not. Every failure here
 * therefore ends in a message that points at the paste fallback — a scanner
 * that reports "error" and does nothing would strand the pairing.
 *
 * The video element is kept off-screen rather than `display: none`, which can
 * pause playback in some browsers, and every track is stopped the moment a
 * payload is read or the caller gives up: the camera must not stay live after
 * the panel is gone.
 */

export interface QrScanSession {
  /** Stop scanning and release the camera. Safe to call more than once. */
  stop(): void
}

function describeCameraFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was denied — paste the payload instead.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera on this device — paste the payload instead.'
  }
  return 'Could not open the camera — paste the payload instead.'
}

/**
 * Start scanning frames for a QR payload. Resolves once the camera is live;
 * `onPayload` fires at most once, after which the camera is released.
 */
export async function startQrScanner(onPayload: (text: string) => void): Promise<QrScanSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot scan QR codes — paste the payload instead.')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    })
  } catch (cause) {
    throw new Error(describeCameraFailure(cause))
  }

  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.autoplay = true
  video.setAttribute('aria-hidden', 'true')
  Object.assign(video.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })
  video.srcObject = stream
  document.body.appendChild(video)
  await video.play().catch(() => undefined)

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  let stopped = false
  let frame = 0
  let lastAttempt = 0

  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    for (const track of stream.getTracks()) track.stop()
    video.remove()
  }

  const loop = (now: number): void => {
    if (stopped) return
    // ~6 reads per second: plenty for a human holding a code, cheap enough
    // that decoding never competes with the pairing UI.
    if (context && video.readyState >= 2 && video.videoWidth > 0 && now - lastAttempt > 150) {
      lastAttempt = now
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const text = decodeQrPixels(image.data, image.width, image.height)
      if (text !== null) {
        stop()
        onPayload(text)
        return
      }
    }
    frame = requestAnimationFrame(loop)
  }

  frame = requestAnimationFrame(loop)
  return { stop }
}
