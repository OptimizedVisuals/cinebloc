# RecBay architecture

**This document is why this project won't fall apart.** It is the software map:
every file, every boundary, every rule. If you change a section, you should not
have to touch any other section — and the tooling below makes that enforceable
rather than aspirational.

## The one rule

Sections never import each other's internals. Sections communicate through
exactly two channels:

1. **the kernel** — types, pure commands, derived selectors, ports (interfaces)
2. **the single store** — one Zustand store that both layouts project from

```
app (composition root — only place that knows every section)
 ├─► layout/ViewportController   breakpoint → mounts exactly ONE layout
 │      ├─► features/canvas      desktop spatial board
 │      └─► features/checklist   mobile set controller
 │             BOTH read/write only ↓
 ├─► state/   single Zustand store = source of truth (bidirectional sync)
 │              persists through ↓
 ├─► adapters/storage-indexeddb  JSON records + binary blobs
 ├─► adapters/export-json        snapshot backup/restore
 ├─► adapters/llm                openai │ anthropic │ gemini (BYOK)
 └─► kernel/   TYPES + PORTS ONLY — imports nothing in src/
```

## The dependency law

| Section  | May import                                              |
| -------- | ------------------------------------------------------- |
| `kernel` | nothing in `src/` (only `zod`)                          |
| `ui`     | nothing in `src/` (dumb, dependency-free)               |
| `adapters` | `kernel`                                              |
| `state`  | `kernel`                                                |
| `media`  | `kernel`, `state`, `ui`                                 |
| `features` | `kernel`, `state`, `ui`, `media`, **itself only**     |
| `layout` | `kernel`, `state`, `ui`, feature **barrels**            |
| `app`/`main` | anything, but features **only via barrels**         |

Convention: cross-section imports ALWAYS use the `@/` alias; imports within the
same section are relative. That makes the fences mechanical.

**Enforcement (two independent layers):**

- `eslint.config.js` — `no-restricted-imports` patterns fence every section at
  authoring time. A feature importing another feature is an error.
- `src/__tests__/architecture.test.ts` — resolves *every* import (including
  relative ones) and asserts the whole matrix, plus barrel-only access. This is
  the backstop for anything a pattern can't see.

Both run in `npm run lint` / `npm test`. If either reports a boundary
violation, the change is wrong — move the shared logic into `kernel` or
`media` instead of reaching across.

## File map

```
recbay/
├── eslint.config.js              boundary fences (dependency law)
├── vite.config.ts · tsconfig.json · index.html
├── docs/                         this directory — WHY, not what
│   ├── architecture.md           ← you are here
│   ├── positioning.md            moat + why this team
│   ├── parsing-quality.md        Phase 2 gate records
│   └── decisions/                short ADRs
└── src/
    ├── main.tsx                  boot: wire adapters → ports, hydrate, render
    ├── app/                      composition root
    │   ├── App.tsx               shell: appbar (brand → Home) + view + modals + Lock
    │   ├── Home.tsx              homepage: entry points + local project list + Continue
    │   ├── LockScreen.tsx        vault gate: unlock / destructive erase
    │   ├── Onboarding.tsx        first-run screen (privacy statement #1)
    │   └── app.module.css
    ├── kernel/                   DOMAIN CORE — imports nothing in src/
    │   ├── model/shot.ts         Shot, ShotLink, EdgeSide, camera vocabularies
    │   ├── model/project.ts      Project, SCHEMA_VERSION
    │   ├── model/settings.ts     Settings + defaults (BYOK, viewport, board_mode)
    │   ├── model/skeleton.ts     loose SkeletonItem (raw LLM shape)
    │   ├── ports/storage.ts      StoragePort (records + blobs + meta)
    │   ├── ports/llm.ts          LLMPort + ProviderConfig + LLMError
    │   ├── ports/exporter.ts     ExportPort (snapshot backup/restore)
    │   ├── ports/sync.ts         WebRtcPort · SignalingCarrier · LanBridgePort (ADR 0005)
    │   ├── sync/                 device-sync core: versions + LWW ordering,
    │   │                         reconcile (tombstones/cursors), pairing code,
    │   │                         wire protocol (validated, batched, chunked)
    │   ├── commands/shots.ts     pure mutations: edit/move/toggle/delete/assets/links
    │   ├── selectors/shots.ts    sortedShots, groupByScene, completionProgress
    │   ├── selectors/shootOrder.ts  locationKey/shootGroups → fastest shoot order
    │   ├── board.ts              defaultPosition() initial grid placement
    │   ├── schema.ts             zod schemas + migrations
    │   └── index.ts              the barrel every section consumes
    ├── adapters/                 INFRASTRUCTURE — only place that touches
    │   │                         fetch/IndexedDB; implements kernel ports
│   ├── storage-indexeddb/    DB "cinebloc" v2 (kept for data continuity):
│   │                         projects|shotlists|blobs|meta|synclog
│   ├── vault/                local password vault: encrypting decorator over
│   │                         StoragePort (PBKDF2 + AES-GCM, see ADR 0004)
│   ├── export-json/          JSON snapshot incl. base64 blobs (device transfer)
    │   └── llm/                  base (retry/backoff) + providers/openai,
    │                             providers/anthropic, providers/gemini, index (registry)
    ├── state/                    SINGLE SOURCE OF TRUTH
    │   ├── store.ts              Zustand root + createTestStore() for tests
    │   ├── types.ts              slice interfaces → AppState
    │   ├── slices/               project · shots · ui · settings slices
    │   ├── services.ts           port registry (adapters injected by app)
    │   ├── persistence.ts        debounced store→IndexedDB + hydrate()
    │   ├── history.ts            coalesced undo/redo (shots + project, memory-only)
    │   ├── projectActions.ts     openProject(id) + goHome() — shared entry points
    │   ├── viewChanges.ts        view-change guard: not an edit, not a sync op
    │   ├── sync/                 ADR 0005: identity · journal (op log, versions,
    │   │                         tombstones, cursors) · tap (store → ops) ·
    │   │                         applyOps/applyLive (remote → storage + store)
    │   └── select.ts             typed selector hooks (useShots, useChecklistShots…)
    ├── media/                    shared asset pipeline used by BOTH layouts
    │   ├── useDropAsset.ts       File → Blob → StoragePort → asset_refs
    │   ├── useAssetUrl.ts        blob → object URL with revocation
    │   ├── Lightbox.tsx          tap-to-expand reference overlay (✕ / backdrop / Esc)
    │   └── AssetThumb.tsx        thumb, optionally expandable
    ├── layout/                   RESPONSIVE VIEWPORT CONTROLLER (claim 1)
    │   ├── breakpoints.ts        single constant (900px)
    │   ├── useBreakpoint.ts      matchMedia listener
    │   └── ViewportController.tsx  exactly one layout mounted (claims 3/4)
    ├── features/                 SELF-CONTAINED — public API = index.ts ONLY
    │   ├── parser/               BYOK gateway + script → skeleton (section A)
    │   │   ├── prompts.ts        declarative system instruction (JSON-only contract)
    │   │   ├── repair.ts         fences · envelopes · trailing commas · truncation
    │   │   ├── normalize.ts      tolerant SkeletonItem → strict Shot[]
    │   │   ├── useParseScript.ts payload → LLMPort → repair → normalize → store
    │   │   │                       (autoLinkByLocation only when board_mode = fast)
    │   │   └── ScriptInputPanel.tsx  the screenplay entry: paste + board-mode choice
    │   │                             (parse success closes straight into the new workspace)
    │   ├── history/              project history (section D)
    │   │   └── HistoryPanel.tsx  list · open · delete projects (cascades blobs)
    │   ├── canvas/               desktop spatial board (section B)
    │   │   ├── CanvasBoard.tsx · RadialGrid.tsx (empty state = centered project chooser)
    │   │   ├── ShotCard.tsx      draggable card + edge nodes + notes popover (✕) + done toggle
    │   │   ├── EdgeLayer.tsx     SVG threads: auto-routed curves, rotate/remove handles
    │   │   ├── edgeGeometry.ts   anchors, normals, bezier routing, nearest-side clip
    │   │   ├── ShootOrderModal.tsx  fastest shoot order + board-mode switch + strip AI threads
    │   │   ├── ShotEditorModal.tsx  deep metadata editing + click-to-browse drop zone
    │   │   └── useDragCards.ts   pointer events → moveShot(id,{x,y})
    │   ├── checklist/            mobile set controller (section C)
    │   │   ├── SetChecklist.tsx · ShotRow.tsx · CompleteToggle.tsx
    │   │   └── ShotDetailModal.tsx  offline blob viewer
    │   └── settings/
    │       ├── SettingsPanel.tsx (privacy statement #2) · ApiKeyForm.tsx
    │       ├── VaultPanel.tsx    enable local password lock (ADR 0004)
    │       ├── DataExport.tsx    "Export all data" (JSON snapshot) — Phase 1
    │       └── DataImport.tsx    restore snapshot
    ├── ui/                       dumb primitives: Button · Modal · Field
    │                             · Toggle · ToastStack · PrivacyStatement
    ├── styles/                   tokens.css (design tokens) + global.css
    ├── dev/seed.ts               dev-only demo data (?seed=1, DEV builds only)
    └── __tests__/architecture.test.ts   the dependency law as a test
```

## Data flow

1. **Parse (claim 1):** script text → `useParseScript` builds the payload with
   the declarative system instruction → provider adapter (user's own key) →
   `repair.extractSkeletonArray` → `normalize.normalizeSkeleton` → `setShots`
   → debounced IndexedDB write. No server of ours exists.
2. **Desktop edit (claim 3):** drag → `moveShot(id,{x,y})` → store → persist.
   The checklist never learns a canvas exists.
3. **Mobile tick (claim 4):** toggle → `toggleShot(id)` → `sortedShots`
   selector sinks completed rows (a *derived view* — `order` is never mutated)
   → CSS dim/strikethrough.
4. **Symmetry (claim 5):** both layouts read/write the same store, so every
   edit in one is instantly visible in the other. Verified by
   `src/state/__tests__/sync.test.ts`.
5. **Assets (claim 2):** image dropped → Blob → IndexedDB (`putBlob`) →
   `asset_refs` on the shot → thumbnails/modals resolve blobs fully offline.
6. **Boot:** `hydrate()` loads settings before first paint — the app opens on
   Home and never auto-resumes a project; `initPersistence()` mirrors every
   change back (debounced, flush on hide).

## Decisions that look odd until you know why

- **`media/` is not a feature.** The asset pipeline is consumed by *both*
  layouts; if it lived under `features/`, one feature would import another —
  the exact coupling this architecture forbids. It sits next to `ui/` as a
  shared capability layer (kernel+state+ui dependencies only).
- **Prompts live in `features/parser/prompts.ts`, not in the adapters.**
  Adapters are dumb transport so features never import them; the prompt is
  product behavior owned by the parser. Swap adapters without touching prompts;
  iterate prompts without touching adapters.
- **Completion never reorders stored data.** `sortedShots` derives the view.
  Mutating `order` on completion would make canvas drag order and checklist
  completion order fight each other — the classic bidirectional-sync bug.
- **The store is always primary; IndexedDB only mirrors it.** One debounced
  writer in `state/persistence.ts`, flushed on tab-hide so a locked phone on
  set never loses a tick.
- **Connection threads live on the Shot, not in a second table.** Canvas
  links (`links: ShotLink[]`) ride inside `shots`, so persistence, export/
  import and the vault came for free — there is no second write path to keep
  in sync.
- **The vault is a decorator, not a concern.** `adapters/vault/` wraps the
  StoragePort, so encryption-at-rest changed zero features — see ADR 0004.
  Boot order: probe salt → lock screen (if set up) → unlock → hydrate.
- **One breakpoint constant** (`layout/breakpoints.ts`), overridable from
  Settings for testing either layout on any device.
- **Board mode is a setting, not a hard-coded layout.** `settings.board_mode`
  (`fast` | `default` | `custom`) is chosen at the parse entry, in Settings or
  on the mobile switch, and projected by every surface: `fast` draws the AI
  guide threads, S-badges and the ⚡ planner; `default` is plain cards;
  `custom` keeps only the threads the user drew. Links are never deleted when
  a mode hides them — switching back restores them.

## Verification

| Check                  | Command           | What it proves                                   |
| ---------------------- | ----------------- | ------------------------------------------------ |
| types                  | `npm run typecheck` | strict TS across all sections                  |
| boundaries             | `npm run lint`      | section fences at authoring time               |
| boundaries (resolved)  | `npm test`          | architecture test resolves every import          |
| behavior               | `npm test`          | commands, selectors, repair/normalize, sync, storage, snapshot, **vault lifecycle**, quality gate |
| production bundle      | `npm run build`     | the app ships                                    |
| UI (manual)            | `npm run dev -- --seed=1` | both layouts with demo data, no API key   |

## Device sync (ADR 0005)

Local-network peer-to-peer sync: `state/sync` records every local mutation as an
operation in the `synclog` store and reconciles incoming operations with a
deterministic last-writer-wins rule over logical versions. No server, no cloud
database, no internet requirement on the same LAN. Wire in the local-first
architecture by *layering* — persistence, commands, undo and Export/Import are
untouched and remain the source of local truth.

Read `docs/decisions/0005-local-p2p-sync.md` before changing it: it documents
the conflict rule, the signalling limitation (no zero-touch reconnection in
browser-only WebRTC), the secure-context requirement, and the deployment and
security model of the optional user-run LAN bridge.
