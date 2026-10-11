import { describe, expect, it } from 'vitest'
import {
  cameraUnavailableReason,
  describeCameraFailure,
  detectScannerEnvironment,
} from '../scanner'

/**
 * The scanner's *decisions* (spec §2), which are the part that can be checked
 * without a camera: whether this device may scan at all, and what the user is
 * told when a specific failure happens. A scanner that reports "error" strands
 * the pairing, so every message here must name the paste fallback.
 */

describe('scanner support detection', () => {
  it('names the secure-context requirement instead of opening the camera and failing', () => {
    const reason = cameraUnavailableReason({ secureContext: false, hasGetUserMedia: true })
    expect(reason).toMatch(/HTTPS or localhost/i)
    expect(reason).toMatch(/paste/i)
  })

  it('reports a browser with no camera API, and says what to do instead', () => {
    const reason = cameraUnavailableReason({ secureContext: true, hasGetUserMedia: false })
    expect(reason).toMatch(/cannot scan QR codes/i)
    expect(reason).toMatch(/paste/i)
  })

  it('stays silent when the camera is usable', () => {
    expect(cameraUnavailableReason({ secureContext: true, hasGetUserMedia: true })).toBeNull()
  })

  it('does not guess when there is no DOM to inspect', () => {
    expect(detectScannerEnvironment()).toBeNull()
    expect(cameraUnavailableReason(null)).toMatch(/unavailable/i)
  })
})

describe('camera failure copy', () => {
  it('turns each failure into an actionable sentence that points at paste', () => {
    const cases: [string, RegExp][] = [
      ['NotAllowedError', /denied/i],
      ['SecurityError', /denied/i],
      ['NotFoundError', /no usable camera/i],
      ['OverconstrainedError', /no usable camera/i],
      ['NotReadableError', /busy/i],
      ['TrackStartError', /busy/i],
      ['AbortError', /stopped before it started/i],
      ['WeirdError', /could not open the camera/i],
    ]
    for (const [name, expected] of cases) {
      const message = describeCameraFailure(new DOMException('failed', name))
      expect(message, name).toMatch(expected)
      expect(message, name).toMatch(/paste/i)
    }
  })

  it('handles a thrown non-error the same way', () => {
    expect(describeCameraFailure('nope')).toMatch(/paste/i)
  })
})
