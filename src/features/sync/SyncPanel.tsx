import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { formatPairingCode, type SyncProgress } from '@/kernel'
import {
  PAIRING_EXPIRED_MESSAGE,
  acceptAnswer,
  cancelPairing,
  createInvitation,
  currentInvitationExpired,
  joinWithInvitation,
  pairingSecondsRemaining,
  pairingState,
  subscribeToPairing,
} from '@/state/sync'
import { useAppStore } from '@/state/store'
import { Button, Field, Textarea, Toggle } from '@/ui'
import { qrSvgDataUrl } from './qr'
import { startQrScanner, type QrScanSession } from './scanner'
import styles from './sync.module.css'

/**
 * Device sync — the minimal diagnostic surface for ADR 0005 pairing.
 *
 * This panel exists because the engine has to be verifiable on real devices:
 * it shows what the local runtime is doing (status, pending changes, progress)
 * and drives the manual signalling exchange the protocol requires — one
 * invitation payload out, one reply payload in, the six-digit code both
 * screens must match. It deliberately does NOT grow a device list, rename
 * flows or automatic reconnection: those belong to the Devices & Sync UI of a
 * later increment, and pretending otherwise here would be the dishonesty this
 * panel's status display exists to avoid.
 *
 * Copy/paste always works; the QR code and the camera are the convenience
 * path over the same payloads (both directions: scan the invitation to join,
 * scan the reply to connect).
 */
export function SyncPanel() {
  const pairing = useSyncExternalStore(subscribeToPairing, pairingState, pairingState)
  const device = useAppStore((s) => s.sync_device)
  const status = useAppStore((s) => s.sync_status)
  const message = useAppStore((s) => s.sync_message)
  const pending = useAppStore((s) => s.sync_pending)
  const lastAt = useAppStore((s) => s.sync_last_at)
  const progress = useAppStore((s) => s.sync_progress)
  const enabled = useAppStore((s) => s.sync_enabled)
  const knownDevices = useAppStore((s) => s.sync_devices)
  const setSyncEnabled = useAppStore((s) => s.setSyncEnabled)
  const pushToast = useAppStore((s) => s.pushToast)

  const [reply, setReply] = useState('')
  const [invitation, setInvitation] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanRef = useRef<QrScanSession | null>(null)

  const busy = pairing.phase === 'connecting' || pairing.phase === 'syncing'
  const expired = currentInvitationExpired()

  // Countdown for the invitation the user is holding open.
  useEffect(() => {
    if (pairing.phase !== 'payload' || pairing.createdAt === null) {
      setSecondsLeft(0)
      return
    }
    const tick = () => setSecondsLeft(pairingSecondsRemaining())
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [pairing.phase, pairing.createdAt])

  // The camera must die with the panel.
  useEffect(() => () => scanRef.current?.stop(), [])

  const qr = useMemo(
    () => (pairing.payload === null ? null : qrSvgDataUrl(pairing.payload)),
    [pairing.payload],
  )

  async function copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      pushToast(`${what} copied.`, 'ok')
    } catch {
      pushToast('Could not copy — select the text and copy it manually.', 'error')
    }
  }

  async function scan(target: 'invitation' | 'reply'): Promise<void> {
    setScanError(null)
    try {
      scanRef.current = await startQrScanner((text) => {
        scanRef.current = null
        if (target === 'invitation') {
          setInvitation(text)
          void joinWithInvitation(text)
        } else {
          setReply(text)
          void acceptAnswer(text)
        }
      })
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : 'Could not open the camera.')
    }
  }

  function reset(): void {
    cancelPairing()
    setReply('')
    setInvitation('')
    setScanError(null)
  }

  return (
    <div className={styles.panel} data-testid="sync-panel">
      {/* ── What this device is doing right now ─────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>This device</div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span className={styles.settingLabel}>{device?.name ?? 'Starting…'}</span>
            <span className={styles.helper} data-testid="sync-status">
              {message}
            </span>
          </div>
          <Toggle
            checked={enabled}
            onChange={() => setSyncEnabled(!enabled)}
            label="Sync enabled"
          />
        </div>
        {device ? (
          <p className={styles.helperMono}>
            {device.platform} · {device.deviceId}
          </p>
        ) : null}
        {pending > 0 ? (
          <p className={styles.helper} data-testid="sync-pending">
            {pending} change{pending === 1 ? '' : 's'} waiting to be acknowledged by the other
            device.
          </p>
        ) : null}
        {lastAt !== null ? (
          <p className={styles.helper}>
            Last sync: {new Date(lastAt).toLocaleString()}
          </p>
        ) : null}
        {status === 'syncing' || status === 'connecting' ? (
          <ProgressLine progress={progress} />
        ) : null}
        {knownDevices.length > 0 ? (
          <p className={styles.helper}>
            Paired with {knownDevices.map((d) => d.name).join(', ')}
          </p>
        ) : null}
      </section>

      {/* ── Pairing ─────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>Pair with another device</div>

        {pairing.phase === 'error' ? (
          <div className={styles.stack}>
            <p className={styles.error} role="alert" data-testid="sync-error">
              {pairing.message}
            </p>
            <div className={styles.row}>
              <Button variant="ghost" data-testid="sync-start-over" onClick={reset}>
                Start over
              </Button>
            </div>
          </div>
        ) : null}

        {pairing.phase === 'idle' ? (
          <div className={styles.stack}>
            <Button
              variant="primary"
              data-testid="sync-create"
              onClick={() => void createInvitation()}
              disabled={!enabled}
            >
              Create invitation (host)
            </Button>
            {!enabled ? (
              <p className={styles.helper}>Turn sync on above to pair a device.</p>
            ) : null}
            <p className={styles.helper}>Or join an invitation shown on the other device:</p>
            <Field label="Invitation payload">
              <Textarea
                rows={3}
                value={invitation}
                onChange={(e) => setInvitation(e.target.value)}
                placeholder="Paste the payload the other device is showing"
                data-testid="sync-invitation"
              />
            </Field>
            <div className={styles.row}>
              <Button
                data-testid="sync-join"
                onClick={() => void joinWithInvitation(invitation)}
                disabled={!enabled}
              >
                Use invitation
              </Button>
              <Button
                variant="ghost"
                data-testid="sync-scan-invitation"
                onClick={() => void scan('invitation')}
                disabled={!enabled}
              >
                Scan QR
              </Button>
            </div>
            {scanError ? (
              <p className={styles.error} role="alert">
                {scanError}
              </p>
            ) : null}
          </div>
        ) : null}

        {pairing.phase === 'payload' ? (
          <div className={styles.stack}>
            <p className={styles.helper} data-testid="sync-pairing-message">
              {pairing.role === 'host'
                ? 'Step 1: show this payload to the other device.'
                : 'Show this reply to the device that invited you — it connects as soon as it pastes it.'}
            </p>

            {qr !== null ? (
              <img className={styles.qr} src={qr} alt="Pairing payload QR code" />
            ) : (
              <p className={styles.error}>
                This payload is too long for a QR code — use copy/paste below.
              </p>
            )}

            <Field label={pairing.role === 'host' ? 'Invitation payload' : 'Reply payload'}>
              <Textarea
                rows={3}
                readOnly
                value={pairing.payload ?? ''}
                className={styles.payload}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="sync-payload"
              />
            </Field>
            <div className={styles.row}>
              <Button
                data-testid="sync-copy-payload"
                onClick={() => void copy(pairing.payload ?? '', 'Payload')}
              >
                Copy payload
              </Button>
              {pairing.code !== null ? (
                <span className={styles.code} data-testid="sync-code">
                  Code {formatPairingCode(pairing.code)}
                </span>
              ) : (
                <span className={styles.helper}>
                  Code appears when both payloads have crossed.
                </span>
              )}
            </div>

            {pairing.role === 'host' ? (
              <>
                <p className={styles.helper}>
                  Step 2: paste the reply from the other device
                  {secondsLeft > 0 ? ` (expires in ${secondsLeft}s)` : ''}
                  {expired ? ` — ${PAIRING_EXPIRED_MESSAGE}` : ''}
                </p>
                <Field label="Reply payload">
                  <Textarea
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Paste the reply, or scan its QR code"
                    data-testid="sync-reply"
                  />
                </Field>
                <div className={styles.row}>
                  <Button
                    variant="primary"
                    data-testid="sync-connect"
                    onClick={() => void acceptAnswer(reply)}
                    disabled={expired || reply.trim().length === 0}
                  >
                    Connect
                  </Button>
                  <Button
                    variant="ghost"
                    data-testid="sync-scan-reply"
                    onClick={() => void scan('reply')}
                  >
                    Scan reply QR
                  </Button>
                </div>
              </>
            ) : null}
            {scanError ? (
              <p className={styles.error} role="alert">
                {scanError}
              </p>
            ) : null}
            <div className={styles.row}>
              <Button variant="ghost" data-testid="sync-cancel" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {busy || pairing.phase === 'done' ? (
          <div className={styles.stack}>
            <p className={styles.helper} data-testid="sync-pairing-message">
              {pairing.message}
            </p>
            {pairing.code !== null ? (
              <span className={styles.code} data-testid="sync-code">
                Code {formatPairingCode(pairing.code)}
              </span>
            ) : null}
            <ProgressLine progress={progress} />
            <div className={styles.row}>
              <Button variant="ghost" data-testid="sync-cancel" onClick={reset}>
                {pairing.phase === 'done' ? 'Pair again' : 'Stop'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ProgressLine({ progress }: { progress: SyncProgress }) {
  if (progress.phase === 'idle' || progress.phase === 'done') return null
  const counts =
    progress.itemsTotal > 0 ? ` (${progress.itemsDone}/${progress.itemsTotal})` : ''
  const bytes =
    progress.bytesTotal > 0
      ? ` · ${Math.round(progress.bytesDone / 1024)}/${Math.round(progress.bytesTotal / 1024)} KB`
      : ''
  return (
    <p className={styles.helper} data-testid="sync-progress">
      {progress.label}
      {counts}
      {bytes}
    </p>
  )
}
