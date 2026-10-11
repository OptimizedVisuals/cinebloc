import { decodeQrPixels } from './qr'

/**
 * Camera QR scanning (ADR 0005, spec §2).
 *
 * One rule shapes this module: **the camera is never opened invisibly.** The
 * previous version created its own 1×1 px, zero-opacity `<video>` and decoded
 * from it, so `getUserMedia` succeeded and the phone showed its camera
 * indicator while the user saw nothing at all — no preview, no frame, no way to
 * cancel, and no explanation when it failed (defect 1). The stream now attaches
 * to a video element the UI actually renders, and this module owns only the
 * lifecycle around it: permission, playback, the decode loop, and release.
 *
 * Failure handling is part of the interface, not an afterthought. Every failure
 * path ends in a sentence the user can act on, and every one of them names the
 * paste fallback, because a scanner that says "error" strands the pairing.
 *
 * The camera is opened by the caller's explicit gesture, the secure-context and
 * `mediaDevices` preconditions are checked *before* asking, decoding pauses
 * while the tab is hidden, a code is delivered at most once, and every track is
 * stopped when the session ends — including when the component unmounts.
 */

export interface QrScannerEnvironment {
  /** Plain `http://<lan-ip>` is not a secure context: no camera, no Web Crypto. */
  secureContext: boolean
  hasGetUserMedia: boolean
}

/** Read the live browser environment; null when there is no DOM (tests, node). */
export function detectScannerEnvironment(): QrScannerEnvironment | null {
  if (typeof navigator === 'undefined' || typeof globalThis.window === 'undefined') return null
  return {
    secureContext: globalThis.window.isSecureContext === true,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
  }
}

/**
 * Why this device cannot scan right now, in words the user can act on — or null
 * when the camera is available. Pure, so the copy is unit-testable without a
 * camera, and checked *before* permission is requested.
 */
export function cameraUnavailableReason(
  env: QrScannerEnvironment | null = detectScannerEnvironment(),
): string | null {
  if (env === null) {
    return 'Camera scanning is unavailable in this browser — paste the payload instead.'
  }
  if (!env.secureContext) {
    return 'Camera scanning needs HTTPS or localhost on this device — paste the payload instead.'
  }
  if (!env.hasGetUserMedia) {
    return 'This browser cannot scan QR codes — paste the payload instead.'
  }
  return null
}

/** Map a camera or playback failure onto an actionable sentence. */
export function describeCameraFailure(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied. Allow the camera for this site, or paste the payload instead.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No usable camera on this device — paste the payload instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy — another app may be using it. Paste the payload instead.'
    case 'AbortError':
      return 'The camera stopped before it started — try again, or paste the payload instead.'
    default:
      return 'Could not open the camera — paste the payload instead.'
  }
}

export interface QrScanSession {
  /** Stop scanning and release the camera. Safe to call more than once. */
  stop(): void
  /** True once the stream is attached and playing — drives the UI's own state. */
  playing(): boolean
}

export interface QrScanOptions {
  /** The visible preview the stream is attached to. Owned by the caller. */
  video: HTMLVideoElement
  /** Fires at most once, with the decoded text. The camera is released first. */
  onDetected: (text: string) => void
  /** The camera died after a successful start (another app claimed it, unplugged). */
  onInterrupted?: (message: string) => void
  /** Decode attempts per second. 8 is plenty for a human holding a code still. */
  maxScansPerSecond?: number
}

/**
 * The same code must not be reported twice, in case the component stays mounted
 * for a moment after detection or a caller restarts the scanner while the code
 * is still in frame (spec §2: repeated detections).
 */
const DEDUPE_WINDOW_MS = 2_000

/** Start scanning frames for a QR payload. Resolves once the camera is live. */
export async function startQrScanner(options: QrScanOptions): Promise<QrScanSession> {
  const unsupported = cameraUnavailableReason()
  if (unsupported !== null) throw new Error(unsupported)

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    })
  } catch (cause) {
    throw new Error(describeCameraFailure(cause))
  }

  const { video } = options
  const interval = 1000 / (options.maxScansPerSecond ?? 8)
  video.playsInline = true
  video.muted = true
  video.autoplay = true
  video.setAttribute('playsinline', '')
  video.setAttribute('aria-label', 'QR code camera preview')
  video.srcObject = stream

  let playing = false
  try {
    await video.play()
    playing = true
  } catch (cause) {
    // The stream exists but the browser refused playback (autoplay policy, or a
    // camera that never produced frames). Release it rather than leaving a live
    // camera behind an error message.
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
    const name = cause instanceof Error ? cause.name : ''
    throw new Error(
      name === 'NotAllowedError'
        ? 'This browser blocked the preview — tap the frame to start the camera, or paste the payload instead.'
        : describeCameraFailure(cause),
    )
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  let stopped = false
  let frame = 0
  let lastAttempt = 0
  let lastText: string | null = null
  let lastTextAt = 0

  const onVisibility = (): void => {
    // Coming back from a hidden tab, the first frame would otherwise decode
    // against a stale timestamp and ignore the throttle.
    lastAttempt = 0
  }
  document.addEventListener('visibilitychange', onVisibility)

  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', onVisibility)
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  const track = stream.getVideoTracks()[0]
  track?.addEventListener('ended', () => {
    if (stopped) return
    stop()
    options.onInterrupted?.('The camera stopped — it may have been taken by another app.')
  })

  const loop = (now: number): void => {
    if (stopped) return
    // Hidden tabs are not scanned: `requestAnimationFrame` already throttles,
    // but a phone left face-down must not keep the camera hot either.
    if (!document.hidden && context && video.readyState >= 2 && video.videoWidth > 0) {
      if (now - lastAttempt >= interval) {
        lastAttempt = now
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context.drawImage(video, 0, 0)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const text = decodeQrPixels(image.data, image.width, image.height)
        if (text !== null) {
          const repeat = lastText === text && now - lastTextAt < DEDUPE_WINDOW_MS
          lastText = text
          lastTextAt = now
          if (!repeat) {
            stop()
            options.onDetected(text)
            return
          }
        }
      }
    }
    frame = requestAnimationFrame(loop)
  }

  frame = requestAnimationFrame(loop)

  return {
    stop,
    playing: () => playing,
  }
}
