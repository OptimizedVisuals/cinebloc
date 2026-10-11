import { useEffect, useRef, useState } from 'react'
import { Button } from '@/ui'
import { startQrScanner, type QrScanSession } from './scanner'
import styles from './sync.module.css'

/**
 * The visible QR scanner (spec §2).
 *
 * This is the surface that was missing: a live preview the user can actually
 * point at a code, a scanning frame, a permission/loading state, a cancel
 * control, and an actionable error card. It is a full-screen sheet rather than
 * a panel inside the sync modal because the preview must never sit behind a
 * dialog or a scrim — the camera view is the whole point of the screen.
 *
 * The camera is opened only when this component mounts, which only happens
 * after the user asked to scan. When it unmounts, the stream is released.
 */

export interface QrScannerProps {
  /** Instruction under the frame, phrased for what is being scanned. */
  hint: string
  /** Fires once, with the decoded text. */
  onDetected: (text: string) => void
  /** Close without a result (also the "paste instead" path on failure). */
  onCancel: () => void
}

type Phase = 'starting' | 'scanning' | 'error'

export function QrScanner({ hint, onDetected, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<QrScanSession | null>(null)
  const deliveredRef = useRef(false)
  const onDetectedRef = useRef(onDetected)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState<string | null>(null)

  // Kept in a ref so a parent re-render can never restart the camera.
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    let cancelled = false
    setPhase('starting')

    void startQrScanner({
      video,
      onDetected: (text) => {
        if (cancelled || deliveredRef.current) return
        deliveredRef.current = true
        onDetectedRef.current(text)
      },
      onInterrupted: (text) => {
        if (cancelled) return
        sessionRef.current = null
        setPhase('error')
        setMessage(text)
      },
    })
      .then((session) => {
        if (cancelled) {
          session.stop()
          return
        }
        sessionRef.current = session
        setPhase('scanning')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        sessionRef.current = null
        setPhase('error')
        setMessage(cause instanceof Error ? cause.message : 'Could not open the camera.')
      })

    return () => {
      cancelled = true
      sessionRef.current?.stop()
      sessionRef.current = null
    }
  }, [attempt])

  function retry(): void {
    setPhase('starting')
    setMessage(null)
    setAttempt((n) => n + 1)
  }

  return (
    <div
      className={styles.scanSheet}
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR code"
      data-testid="qr-scanner"
    >
      <div className={styles.scanBar}>
        <span className={styles.scanTitle}>Scan QR code</span>
        <button
          type="button"
          className={styles.scanClose}
          onClick={onCancel}
          aria-label="Cancel scanning"
          data-testid="qr-scanner-cancel"
        >
          ✕
        </button>
      </div>

      <div className={styles.scanStage}>
        {/* Always mounted: the effect needs the element on the retry pass, and
            the preview must never be `display:none` (some browsers pause it). */}
        <video
          ref={videoRef}
          className={[styles.scanVideo, phase === 'error' ? styles.scanVideoIdle : '']
            .filter(Boolean)
            .join(' ')}
          playsInline
          muted
          autoPlay
        />
        <div
          className={[styles.scanFrame, phase === 'scanning' ? styles.scanFrameLive : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          <span className={styles.scanCorner} />
          <span className={`${styles.scanCorner} ${styles.scanCornerTr}`} />
          <span className={`${styles.scanCorner} ${styles.scanCornerBl}`} />
          <span className={`${styles.scanCorner} ${styles.scanCornerBr}`} />
          {phase === 'scanning' ? <span className={styles.scanLine} /> : null}
        </div>
        {phase === 'starting' ? (
          <div className={styles.scanStatus} data-testid="qr-scanner-status" role="status">
            Starting the camera…
          </div>
        ) : null}
      </div>

      <div className={styles.scanFooter}>
        {phase === 'error' ? (
          <>
            <p className={styles.error} role="alert" data-testid="qr-scanner-error">
              {message}
            </p>
            <div className={styles.row}>
              <Button variant="primary" onClick={retry} data-testid="qr-scanner-retry">
                Try again
              </Button>
              <Button variant="ghost" onClick={onCancel} data-testid="qr-scanner-paste">
                Enter it by hand
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.scanHint} data-testid="qr-scanner-hint">
              {hint}
            </p>
            <Button variant="ghost" onClick={onCancel} data-testid="qr-scanner-cancel-footer">
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
