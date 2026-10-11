# ADR 0005: Local-network device sync (no cloud, no server)

**Status:** accepted · 2026-10-10 · implemented incrementally (see *Build state*)

## Context

The app is local-first: every project, shot and asset lives in the browser's
IndexedDB on the device that created it. Two devices therefore hold two
unrelated databases, and Export/Import is the only way to move data today.

We want a PC and a phone on the same Wi-Fi to synchronise directly, with **no
RecBay-operated backend, no cloud database, and no internet requirement** while
both devices are on the same LAN.

## Decision

**WebRTC DataChannels, peer to peer, signalled without any server.**

```
PC IndexedDB → state/sync (journal + tap) → adapters/sync-webrtc → DataChannel
                                                       ↕
Phone IndexedDB ← state/sync (journal + tap) ← adapters/sync-webrtc
```

Where each piece lives — chosen so the dependency law still holds:

| Concern | Section | Why there |
| --- | --- | --- |
| Vocabulary, version/conflict rules, protocol, pairing codes | `kernel/sync/` | pure, DOM-free, shared by every layer and testable in isolation |
| Transport + signalling ports (`WebRtcPort`, `SignalingCarrier`, `LanBridgePort`) | `kernel/ports/sync.ts` | adapters implement them; nothing else may touch `RTCPeerConnection` |
| Change-log tap, journal, identity, device registry | `state/sync/` | they orchestrate the store and the ports; features never see them |
| Op-log persistence | `adapters/storage-indexeddb` (`synclog`, DB v2) | IndexedDB stays confined to adapters |
| WebRTC transport, LAN bridge | `adapters/sync-webrtc` (built); `adapters/sync-lan-bridge` (designed, not built) | infrastructure only |
| QR picture and camera scanner | `features/sync/qr.ts`, `features/sync/scanner.ts`, `features/sync/QrScanner.tsx` | a feature may not import an adapter, and the payload format is fixed by the kernel, so the QR is a feature concern built on `jsqr`/`qrcode-generator` |
| Pairing link route | `app/pairingRoute.ts` | reading `location` is an app-shell concern, and only the app may compose state + kernel |

### Conflict rule (deterministic, no wall clocks)

Every local mutation advances a persisted logical clock and is stamped with
`{ counter, deviceId }`. Ordering is `counter` first, `deviceId` lexicographic
as the tie-break — a total order, so every device independently picks the same
winner no matter what order messages arrive in. Deletions write **tombstones**
carrying their version, so a stale update that arrives late can never resurrect
a deleted record; an explicit newer edit can, and that is the documented way
back. No CRDT, because the model (one writer per record between syncs) does not
need one.

### First sync vs later syncs

* **First pairing** exchanges manifests, then a full snapshot in batches, then
  asset bytes in 16 KiB chunks, then verifies (SHA-256) and ACKs.
* **Later syncs** exchange cursors only: each side sends the ops the other's
  cursor says it is missing — `opsSince(log, cursors)`. Editing one record
  sends exactly that record.
* **Offline** work needs no connection: ops are appended to the local log and
  stay pending until a peer acknowledges them. Reconnecting drains the queue.

## The unavoidable limitation: signalling

A browser cannot listen on a LAN socket, and there is no browser API to browse
or advertise on the local network. WebRTC also needs *both* directions
(offer **and** answer, plus ICE) before a DataChannel opens, and neither the
DTLS fingerprints nor the ICE `ufrag`/`pwd` can be pinned or reused across
sessions through the `RTCPeerConnection` API.

Consequences, stated plainly:

1. **A one-scan handshake is not possible with browser-only signalling.** The
   PC's offer would fit in a QR code, but the phone's *answer* still has to get
   back. With no server, that return path is a second optical step (phone shows
   a compact answer payload; PC camera scans it) or a pasted code. The QR
   carrier therefore supports both, and the paste fallback exists for machines
   without a webcam.

### One payload, two forms (`kernel/sync/payload.ts`)

The payload is one versioned schema, and it has exactly two accepted forms with
one canonical output, so generation and parsing can never drift apart:

```
bare   recbay-sync-v1.<base64url>          what goes over the wire
link   https://<app>/#pair=recbay-sync-v1.<…>   what goes in the QR code
```

The **link** exists so that a scan can come back into the app. A QR holding an
opaque string is unreadable to the phone's own camera app — which falls back to
a web search — and nothing on the receiving side can route it. With the link,
scanning opens RecBay, whose route (`src/app/pairingRoute.ts`) reads the `pair`
field, joins as the guest, and clears the fragment so a refresh cannot replay
the one-time material. Nothing is ever navigated to: only the `pair` field is
read, and its value must validate as a RecBay payload.

The fragment (not the query) carries the payload: a fragment is never sent to a
server, never appears in a `Referer`, and cannot land in an access log. It does
cost URL length, so the QR falls back to the bare payload when the link does not
fit any symbol — and says so in words instead of silently downgrading.

**Canonicalization is what makes the comparison code work.** Both devices hash
the same two canonical payload strings. A payload that a chat client
line-wrapped is normalised before it is hashed, so two honest devices cannot be
told their codes differ because of a transport artefact.
2. **Automatic reconnection is not implemented, and is not claimed anywhere in
   the UI or copy.** A fresh session always needs a fresh offer/answer, so true
   zero-touch reconnection requires a signalling endpoint. The only acceptable
   endpoint is one the user controls on their own network (below), never a
   hosted service.
3. **STUN/TURN are not used.** On one subnet, host ICE candidates are enough
   (browsers resolve each other's mDNS-obfuscated `*.local` candidates), so
   peers are constructed with `iceServers: []`. That is deliberate: it is what
   makes the feature structurally LAN-only.

### Secure-context requirement

`getUserMedia` (QR camera), `crypto.subtle` (asset hashing) and
`crypto.randomUUID` (device identity) are secure-context-only. Loading the app
from `http://<pc-lan-ip>:port` on a phone silently loses all three. The app
therefore detects this (`hasSecureCrypto()`, `IdentityUnavailableError`) and
reports *“Device sync needs HTTPS or localhost on this device.”* instead of
failing in mysterious ways. The supported deployment is an **installable PWA
served from an HTTPS origin** (or the app opened on `localhost`); the LAN is
only used for the peer-to-peer data path.

## The optional local bridge (LAN carrier)

Not built yet. It is designed here first so its deployment and security model
are fixed before any code exists. It is a *user-controlled local service*, not a
RecBay service: it runs on the user's own machine, binds to the LAN interface,
and only ever relays signalling payloads.

**Deployment model**

* Started explicitly by the user (e.g. `npm run sync-bridge` in the repo, or a
  packaged binary they run on the PC). It is **not** part of the web app, which
  stays a static bundle.
* Binds to the LAN address only, never `0.0.0.0` on a public interface, and
  advertises itself to the app via a loopback origin.
* If it is not running, `LanBridgePort.available()` returns false and the app
  falls back to QR pairing. Nothing else changes: the app must be fully
  functional with the bridge absent.

**Security model**

* **No project data ever passes through the bridge.** It carries only opaque
  SDP/ICE payloads for one session; records and assets go device-to-device over
  the DTLS-encrypted DataChannel.
* **Device authentication.** A payload is published for one specific
  `deviceId` and may only be fetched by that device; the pair must already be
  trusted (present in the local `KnownDeviceRegistry`) for the session to be
  accepted. Unknown devices must pair through the QR flow.
* **Pairing sessions expire** (`PAIRING_TTL_MS`, two minutes) and envelopes are
  consumed once (`consume()`), so a payload cannot be replayed.
* **Transport assumption.** Plain LAN HTTP is not confidential, so the bridge
  is treated as an untrusted carrier: it learns a correlation id and the
  device ids involved, never the data, and it can at worst cause a failed
  handshake.
* **Removals are local.** Forgetting a device deletes the trust row; it never
  deletes projects, and the peer's local data is untouched.

**LAN discovery.** Via the bridge's `announce`/`listNearby` pair, scoped to
trusted device ids. The browser cannot do this by itself (see above), which is
exactly why discovery lives behind an optional port rather than in the app.

**When the PC browser is closed.** The bridge keeps announcing only while the
app page is open and registered. With the PC's browser closed there is no peer
to hand a session to: the phone shows pending changes as *waiting*, and they
sync the next time the PC app is open. That is a property of a browser-only
peer, and the UI copy must match it (never “will sync in the background”).

## Build state (honest inventory)

Implemented and verified: kernel sync core (versions, LWW, tombstones, cursors,
protocol validation, pairing codes); the **versioned payload + link contract**
(`kernel/sync/payload.ts`); DB v2 with the encrypted `synclog`; persistent
device identity and trusted-device registry (rename / forget / revoke); the
change-log tap (edits, creates, deletes, undo/redo, import, assets, whitelisted
settings; guards for remote apply, hydration and vault lock); the journal
(restart recovery, relay to a third device, duplicate rejection);
pending-per-peer counts; the **WebRTC data-channel transport**
(`adapters/sync-webrtc`, LAN-only ICE, mDNS host candidates); **QR and paste
signalling in both directions** with a real camera scanner
(`features/sync/QrScanner.tsx`, visible preview, corner frame, permission and
loading state, cancel, actionable failures, duplicate-detection guard); the
**in-app pairing route** for a scanned link; the **Devices & Sync UI**
(`features/sync/SyncPanel.tsx`: enable/disable, add device, device list with
platform, trust, last seen and last successful sync, rename, disconnect,
forget with a confirmation, sync now, progress, diagnostics, and a clear
“needs HTTPS or localhost” message where the camera cannot run); and the **sync
engine** (`state/sync/engine.ts`: manifest exchange, snapshot in batches,
incremental ops, chunked asset bytes, acknowledgement only after the receiver
has written durably, tombstones, duplicate rejection, disconnect handling,
vault-lock blocking).

Verified end to end in two browser instances on separate origins (separate
`IndexedDB`, a real `RTCPeerConnection`): the first sync moved a project, eight
shots and six PNG assets (636 KB, byte-identical by SHA-256) from a seeded
device to an empty one, and a later session carried one edit in each direction
as operations only — pending counts cleared on acknowledgement and no snapshot
was re-sent. Both devices compared the same six-digit code before syncing.

Also verified in the browser on two live dev-server origins (`localhost:5173`
and `localhost:5174`, therefore two real stores): opening a `#pair=` link on
the second origin made it consume the fragment, turn sync on, open the
Devices & Sync surface and join as the guest with the same six-digit code; a
shot completion made on the first device raised its pending count to 1, and
after the next session both devices held the **same project and shot ids with
identical completion flags**, with the second device's op log containing
operations **authored by both devices**. An unrelated URL pasted as a pairing
code was refused with a specific message and never navigated to.

Not implemented: the LAN bridge and automatic discovery / automatic
reconnection (deliberately out of this increment — a browser-only peer has no
signalling endpoint and cannot connect on its own), and the PWA install.
Nothing in the UI promises background or automatic sync; the copy says the
other device must be open and that “Sync now” starts a fresh session.

Known gaps, stated plainly:

* **No session has run between two separate physical devices.** All browser
  verification used two instances on one machine, which is why host ICE
  candidates and mDNS resolution across a real LAN remain untested. Until that
  is done, the app must not claim real-device sync works.
* **The camera path has never seen a real camera.** The scanner's structure,
  permission/loading/error states, failure copy and duplicate-detection guard
  are covered by tests and the surface was verified rendering with a live
  video element, but no QR has actually been read from a physical camera on a
  phone — the hardware step is unverified.
* **The receiving device does not switch its workspace** to a project that
  arrived by sync. The records are durable immediately and the project is in
  History (verified: opening it renders the received images), but the user
  opens it themselves — auto-opening while someone is editing another project
  is a deliberate non-feature.
* **Pending counts only include recorded operations.** A change still inside
  the tap's flush window is not counted yet, and with no trusted peer known the
  count is zero by definition, so it is not proof that nothing is outstanding.

## Alternatives rejected

* **A hosted signalling server** (the usual answer for WebRTC pairing):
  reintroduces exactly the cloud dependency this product rejects, and is not
  needed on a LAN.
* **STUN/TURN**: unnecessary on one subnet, and a TURN relay would silently
  turn a LAN feature into an internet one.
* **Sync through a shared file / cloud drive**: not peer-to-peer, needs a
  third-party account, and leaks project data to that provider.
* **BroadcastChannel/service-worker tricks for cross-device signalling**:
  same-origin only; they cannot cross devices.
* **CRDTs**: unnecessary for this data model and far more code to get wrong.
