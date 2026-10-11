import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  SYNC_PROTOCOL_VERSION,
  formatPairingCode,
  pairingLink,
  type KnownDevice,
  type SyncProgress,
} from '@/kernel'
import {
  PAIRING_EXPIRED_MESSAGE,
  acceptAnswer,
  cancelPairing,
  createInvitation,
  currentInvitationExpired,
  disconnectSync,
  forgetDevice,
  joinWithInvitation,
  pairingSecondsRemaining,
  pairingState,
  renamePairedDevice,
  renameThisDevice,
  sortKnownDevices,
  subscribeToPairing,
} from '@/state/sync'
import { useAppStore } from '@/state/store'
import { Button, Field, Input, Textarea, Toggle } from '@/ui'
import { QrScanner } from './QrScanner'
import { qrSvgDataUrl } from './qr'
import { cameraUnavailableReason, detectScannerEnvironment } from './scanner'
import styles from './sync.module.css'

/**
 * Settings → Devices & Sync (spec §7).
 *
 * This is the user-facing half of ADR 0005. Every control here is wired to the
 * live runtime: the toggle moves the real sync status, "show my pairing code"
 * creates a real WebRTC offer, the scanner feeds the real join path, and the
 * device rows read the real registry. Nothing is a decorative button and no
 * state is faked — including the states this product genuinely cannot reach.
 *
 * Two honesties are load-bearing and appear in the copy, not just the code:
 *
 *   • **There is no background sync.** A browser cannot reconnect on its own,
 *     so "Sync now" starts a fresh session that the other device must answer.
 *     The UI never claims otherwise.
 *   • **The code is compared by a human.** Both payloads derive the same six
 *     digits; if they differ, the session is refused rather than trusted.
 *
 * The QR code carries a RecBay *link* (`…#pair=…`) so the phone's own camera
 * app can open the app and resume pairing with no navigation (defect 2). When a
 * payload is too long for a link QR the fallback is stated in words instead of
 * silently downgrading to a scan-only code.
 */

type ScanTarget = 'invitation' | 'reply'

/** Where this app is deployed — the base a pairing link must point back at. */
function appBaseUrl(): string {
  if (typeof globalThis.location === 'undefined') return ''
  return `${globalThis.location.origin}${globalThis.location.pathname}`
}

interface PairingQr {
  src: string
  /** False when only the bare payload fitted, so the code needs the in-app scanner. */
  routed: boolean
}

function pairingQr(link: string, payload: string | null): PairingQr | null {
  if (payload === null) return null
  // Prefer the link: it is what makes a scan come back into the app. Fall back
  // to the bare payload only at the size margin, and say so in the UI.
  const linked = qrSvgDataUrl(link)
  if (linked !== null) return { src: linked, routed: true }
  const bare = qrSvgDataUrl(payload)
  return bare === null ? null : { src: bare, routed: false }
}

function formatWhen(at: number | undefined | null): string {
  if (at === undefined || at === null || at === 0) return 'never'
  return new Date(at).toLocaleString()
}

export function SyncPanel() {
  const pairing = useSyncExternalStore(subscribeToPairing, pairingState, pairingState)
  const device = useAppStore((s) => s.sync_device)
  const status = useAppStore((s) => s.sync_status)
  const message = useAppStore((s) => s.sync_message)
  const pending = useAppStore((s) => s.sync_pending)
  const lastAt = useAppStore((s) => s.sync_last_at)
  const progress = useAppStore((s) => s.sync_progress)
  const enabled = useAppStore((s) => s.sync_enabled)
  const devices = useAppStore((s) => s.sync_devices)
  const setSyncEnabled = useAppStore((s) => s.setSyncEnabled)
  const pushToast = useAppStore((s) => s.pushToast)

  const [reply, setReply] = useState('')
  const [invitation, setInvitation] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [scanTarget, setScanTarget] = useState<ScanTarget | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [forgetTarget, setForgetTarget] = useState<string | null>(null)

  const busy = pairing.phase === 'connecting' || pairing.phase === 'syncing'
  const live = busy || pairing.phase === 'payload'
  const expired = currentInvitationExpired()
  const paired = useMemo(() => sortKnownDevices(devices), [devices])
  const cameraProblem = useMemo(() => cameraUnavailableReason(), [])
  const link = useMemo(
    () => (pairing.payload === null ? '' : pairingLink(pairing.payload, appBaseUrl())),
    [pairing.payload],
  )
  const qr = useMemo(() => pairingQr(link, pairing.payload), [link, pairing.payload])

  useEffect(() => {
    if (device) setNameDraft(device.name)
  }, [device])

  // Countdown for the pairing code the user is holding open.
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

  async function copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      pushToast(`${what} copied.`, 'ok')
    } catch {
      pushToast('Could not copy — select the text and copy it manually.', 'error')
    }
  }

  function onScanned(text: string): void {
    const target = scanTarget
    setScanTarget(null)
    if (target === 'reply') void acceptAnswer(text)
    else void joinWithInvitation(text)
  }

  function reset(): void {
    cancelPairing()
    setReply('')
    setInvitation('')
  }

  async function saveThisDeviceName(): Promise<void> {
    try {
      await renameThisDevice(nameDraft)
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : 'Could not rename this device.', 'error')
    }
  }

  function commitPairedRename(): void {
    if (renamingId !== null) renamePairedDevice(renamingId, renameDraft)
    setRenamingId(null)
  }

  async function confirmForget(known: KnownDevice): Promise<void> {
    setForgetTarget(null)
    await forgetDevice(known.deviceId)
  }

  return (
    <div className={styles.panel} data-testid="sync-panel">
      {/* ── This device ─────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>This device</div>

        <div className={styles.nameRow}>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="This device's name"
            data-testid="sync-device-name"
            placeholder="Device name"
          />
          <Button
            onClick={() => void saveThisDeviceName()}
            disabled={device === null || nameDraft.trim() === device.name}
            data-testid="sync-rename-device"
          >
            Rename
          </Button>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span className={styles.settingLabel}>Sync enabled</span>
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
          <p className={styles.helperMono} data-testid="sync-this-device-id">
            {device.platform} · {device.deviceId}
          </p>
        ) : (
          <p className={styles.helper}>
            This device has no syncing identity yet — it needs HTTPS or localhost.
          </p>
        )}

        {pending > 0 ? (
          <p className={styles.helper} data-testid="sync-pending">
            {pending} change{pending === 1 ? '' : 's'} waiting to be acknowledged by the other
            device.
          </p>
        ) : null}

        <p className={styles.helper} data-testid="sync-last">
          Last successful sync: {formatWhen(lastAt)}
        </p>

        {busy ? <ProgressLine progress={progress} /> : null}

        <div className={styles.row}>
          <Button
            variant="primary"
            data-testid="sync-now"
            disabled={!enabled || device === null || live}
            onClick={() => void createInvitation()}
          >
            Sync now
          </Button>
          {live ? (
            <Button variant="ghost" data-testid="sync-disconnect" onClick={() => disconnectSync()}>
              Disconnect
            </Button>
          ) : null}
        </div>
        <p className={styles.helper}>
          A sync session is live only while both devices are open — a browser cannot reconnect on
          its own, so this starts a fresh session the other device must answer.
        </p>
      </section>

      {/* ── Add a device ────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>Add a device</div>

        {pairing.phase === 'idle' ? (
          <>
            <ol className={styles.steps}>
              <li>Put both devices on the same Wi-Fi.</li>
              <li>Keep RecBay open on both — the pairing code is one session only.</li>
              <li>Compare the six digits, then let them sync.</li>
            </ol>

            <div className={styles.row}>
              <Button
                variant="primary"
                data-testid="sync-create"
                onClick={() => void createInvitation()}
                disabled={!enabled || device === null}
              >
                Show my pairing code
              </Button>
              <Button
                data-testid="sync-scan-invitation"
                onClick={() => setScanTarget('invitation')}
                disabled={!enabled || device === null || cameraProblem !== null}
              >
                Scan a code
              </Button>
            </div>

            {cameraProblem !== null ? (
              <p className={styles.helper} data-testid="sync-camera-note">
                {cameraProblem}
              </p>
            ) : null}

            <p className={styles.helper}>Or enter the code shown on the other device:</p>
            <Field label="Pairing code from the other device">
              <Textarea
                rows={3}
                value={invitation}
                onChange={(e) => setInvitation(e.target.value)}
                placeholder="Paste the code, or the link the other device copied"
                data-testid="sync-invitation"
              />
            </Field>
            <div className={styles.row}>
              <Button
                data-testid="sync-join"
                onClick={() => void joinWithInvitation(invitation)}
                disabled={!enabled || invitation.trim().length === 0}
              >
                Use this code
              </Button>
            </div>
          </>
        ) : null}

        {pairing.phase === 'payload' ? (
          <>
            <p className={styles.helper} data-testid="sync-pairing-message">
              {pairing.role === 'host'
                ? 'Show this code to the other device, then scan or enter its reply.'
                : 'Show this reply to the device that invited you — it connects as soon as it has it.'}
            </p>

            {qr !== null ? (
              <img
                className={styles.qr}
                src={qr.src}
                alt="Pairing code QR"
                data-testid="sync-qr"
              />
            ) : (
              <p className={styles.error}>
                This code is too long to draw as a QR symbol — copy the link below instead.
              </p>
            )}
            {qr !== null && !qr.routed ? (
              <p className={styles.helper} data-testid="sync-qr-note">
                Too large for the camera app: scan this one from RecBay → Sync → Scan a code, or
                copy the link.
              </p>
            ) : null}

            <div className={styles.row}>
              <Button data-testid="sync-copy-link" onClick={() => void copy(link, 'Pairing link')}>
                Copy link
              </Button>
              {pairing.code !== null ? (
                <span className={styles.code} data-testid="sync-code">
                  Code {formatPairingCode(pairing.code)}
                </span>
              ) : (
                <span className={styles.helper}>The code appears once both codes have crossed.</span>
              )}
            </div>

            <Field label={pairing.role === 'host' ? 'Your code' : 'Your reply'}>
              <Textarea
                rows={3}
                readOnly
                value={pairing.payload ?? ''}
                className={styles.payload}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="sync-payload"
              />
            </Field>

            {pairing.role === 'host' ? (
              <>
                <p className={styles.helper}>
                  Then scan or enter the reply from the other device
                  {secondsLeft > 0 ? ` — expires in ${secondsLeft}s` : ''}
                  {expired ? ` — ${PAIRING_EXPIRED_MESSAGE}` : ''}
                </p>
                <Field label="Reply from the other device">
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
                    data-testid="sync-scan-reply"
                    onClick={() => setScanTarget('reply')}
                    disabled={cameraProblem !== null}
                  >
                    Scan reply code
                  </Button>
                </div>
              </>
            ) : (
              <p className={styles.helper}>
                Waiting for the other device to connect
                {secondsLeft > 0 ? ` — this code expires in ${secondsLeft}s` : ''}.
              </p>
            )}

            <div className={styles.row}>
              <Button variant="ghost" data-testid="sync-cancel" onClick={reset}>
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {busy || pairing.phase === 'done' ? (
          <>
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
                {pairing.phase === 'done' ? 'Pair another device' : 'Stop'}
              </Button>
            </div>
          </>
        ) : null}

        {pairing.phase === 'error' ? (
          <>
            <p className={styles.error} role="alert" data-testid="sync-error">
              {pairing.message}
            </p>
            <div className={styles.row}>
              <Button variant="primary" data-testid="sync-start-over" onClick={reset}>
                Start over
              </Button>
            </div>
          </>
        ) : null}
      </section>

      {/* ── Paired devices ─────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>Paired devices</div>
        {pairing.phase === 'done' ? (
          <p className={styles.helper} data-testid="sync-done">
            {pairing.message}
          </p>
        ) : null}

        {paired.length === 0 ? (
          <p className={styles.helper} data-testid="sync-no-devices">
            No devices paired yet. Pairing is the only way a device gets access.
          </p>
        ) : (
          <ul className={styles.deviceList}>
            {paired.map((known) => (
              <li key={known.deviceId} className={styles.deviceRow} data-testid="sync-device">
                <div className={styles.deviceMain}>
                  {renamingId === known.deviceId ? (
                    <div className={styles.nameRow}>
                      <Input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        aria-label={`Rename ${known.name}`}
                        data-testid="sync-device-rename-input"
                      />
                      <Button onClick={commitPairedRename} data-testid="sync-device-rename-save">
                        Save
                      </Button>
                    </div>
                  ) : (
                    <span className={styles.deviceName}>{known.name}</span>
                  )}
                  <span className={styles.deviceMeta}>
                    {known.platform} · {known.trusted ? 'trusted' : 'not trusted'} · last sync{' '}
                    {formatWhen(known.lastSyncAt)}
                  </span>
                  <span className={styles.deviceMeta}>Last seen {formatWhen(known.lastSeenAt)}</span>
                </div>

                {forgetTarget === known.deviceId ? (
                  <div className={styles.deviceActions}>
                    <span className={styles.warn}>
                      Forget {known.name}? It keeps its own data and must pair again to sync.
                    </span>
                    <div className={styles.row}>
                      <Button
                        variant="danger"
                        data-testid="sync-device-forget-confirm"
                        onClick={() => void confirmForget(known)}
                      >
                        Forget
                      </Button>
                      <Button onClick={() => setForgetTarget(null)} data-testid="sync-device-keep">
                        Keep
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.deviceActions}>
                    <Button
                      data-testid="sync-device-rename"
                      onClick={() => {
                        setRenamingId(known.deviceId)
                        setRenameDraft(known.name)
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="danger"
                      data-testid="sync-device-forget"
                      onClick={() => setForgetTarget(known.deviceId)}
                    >
                      Forget
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.helper}>
          Forgetting revokes access only — it never deletes your projects or images.
        </p>
      </section>

      {/* ── Diagnostics ────────────────────────────────────────────── */}
      <details className={styles.diag}>
        <summary className={styles.diagSummary} data-testid="sync-diagnostics-toggle">
          Diagnostics
        </summary>
        <dl className={styles.diagList}>
          <dt>State</dt>
          <dd>
            {status} — {message}
          </dd>
          <dt>This device</dt>
          <dd>{device ? `${device.name} · ${device.platform}` : 'no identity'}</dd>
          <dt>Trusted peers</dt>
          <dd>{paired.map((d) => d.name).join(', ') || 'none'}</dd>
          <dt>Pending changes</dt>
          <dd>{pending}</dd>
          <dt>Protocol version</dt>
          <dd>{SYNC_PROTOCOL_VERSION}</dd>
          <dt>Secure context</dt>
          <dd>
            {detectScannerEnvironment()?.secureContext === true
              ? 'yes — camera, Web Crypto and device identity available'
              : 'no — use HTTPS or localhost'}
          </dd>
          <dt>Camera</dt>
          <dd>{cameraProblem ?? 'available'}</dd>
          <dt>Transfer progress</dt>
          <dd>
            {progress.phase} · {progress.label || 'idle'}
          </dd>
          <dt>Never leaves this device</dt>
          <dd>API key, provider, model, base URL and viewport are device-local by design.</dd>
        </dl>
      </details>

      {scanTarget !== null ? (
        <QrScanner
          hint={
            scanTarget === 'invitation'
              ? 'Point the camera at the pairing code on the other device.'
              : 'Point the camera at the reply code on the other device.'
          }
          onDetected={onScanned}
          onCancel={() => setScanTarget(null)}
        />
      ) : null}
    </div>
  )
}

function ProgressLine({ progress }: { progress: SyncProgress }) {
  if (progress.phase === 'idle') return null
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
