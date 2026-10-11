import type { LocalMutation, Project, Settings, Shot } from '@/kernel'
import { entityKey } from '@/kernel'
import { useAppStore } from '../store'
import type { AppState } from '../types'

/**
 * The sync-aware mutation layer (ADR 0005, spec §12).
 *
 * Every mutation in this app already funnels through the single store —
 * commands, drags, checklist ticks, import, undo/redo, and the project
 * lifecycle all end in `setState`. So instead of instrumenting each call site
 * (and inevitably missing one), the tap diffs the store like
 * `persistence.ts` and `history.ts` already do, and turns deltas into
 * `LocalMutation`s in the kernel's vocabulary.
 *
 * Coverage:
 *   • edits            → update ops (one per changed record)
 *   • creates/deletes  → create/delete ops (delete keeps a tombstone version)
 *   • drags/typing     → coalesced into ONE op per entity per burst window
 *   • undo/redo        → ordinary state changes, so they are recorded too
 *   • import           → setProject/setShots land here like any other change
 *   • assets           → asset_refs live on the Shot, so they ride the shot op
 *   • settings         → ONLY the synced slice (board_mode). `api_key`,
 *                        provider, model, base_url and viewport are device-local
 *                        and never leave the device (spec §14).
 *
 * Safety:
 *   • remote-applied changes are wrapped in `runWithoutRecording` so they never
 *     echo back as new local ops (infinite loop) or enter undo history
 *   • hydration and vault lock/reset drop state instead of inventing ops
 *   • the first observation after hydration only seeds the baseline, so opening
 *     an existing workspace never replays it as “new” data
 */

/** Guard shared by the tap and the remote-apply helper below it. */
let applyingRemote = false

/**
 * Run `apply` without recording sync operations. The sync engine wraps every
 * remote change in this *and* `runWithoutHistory`, so a paired device can
 * never create new outgoing ops or phantom undo steps.
 */
export function runWithoutRecording(apply: () => void): void {
  const previous = applyingRemote
  applyingRemote = true
  try {
    apply()
  } finally {
    applyingRemote = previous
  }
}

export function isRecordingSuppressed(): boolean {
  return applyingRemote
}

/** Where the tap pushes batches. Implemented by the journal. */
export interface TapSink {
  record(mutations: readonly LocalMutation[]): Promise<void>
}

export interface TapOptions {
  /**
   * Burst window. A card drag fires dozens of `moveShot` calls and typing in a
   * note fires one per keystroke; the tap keeps only the latest state per
   * entity and flushes once the burst settles.
   */
  windowMs?: number
  onError?: (cause: unknown) => void
}

export interface TapSnapshot {
  projectId: string | null
  project: Project | null
  shots: Shot[]
  boardMode: Settings['board_mode']
}

export function captureSnapshot(state: AppState): TapSnapshot {
  return {
    projectId: state.project?.id ?? null,
    project: state.project,
    shots: state.shots,
    boardMode: state.settings.board_mode,
  }
}

export function samePosition(a: Shot['position_on_board'], b: Shot['position_on_board']): boolean {
  return a.x === b.x && a.y === b.y
}

/** Field-by-field, because unchanged records are returned by reference. */
export function shotEquals(a: Shot, b: Shot): boolean {
  return (
    a.scene_id === b.scene_id &&
    a.scene_heading === b.scene_heading &&
    a.shot_number === b.shot_number &&
    a.character === b.character &&
    a.action === b.action &&
    a.size === b.size &&
    a.lens === b.lens &&
    a.movement === b.movement &&
    a.is_completed === b.is_completed &&
    a.order === b.order &&
    a.notes === b.notes &&
    samePosition(a.position_on_board, b.position_on_board) &&
    a.asset_refs.length === b.asset_refs.length &&
    a.asset_refs.every((key, i) => key === b.asset_refs[i]) &&
    JSON.stringify(a.links ?? []) === JSON.stringify(b.links ?? [])
  )
}

/** Deltas between two store snapshots, in the kernel's mutation vocabulary. */
export function diffSnapshots(prev: TapSnapshot, next: TapSnapshot): LocalMutation[] {
  const out: LocalMutation[] = []

  // ── project: replace-all semantics (the store holds one live project) ──
  if (prev.projectId !== next.projectId) {
    if (prev.project) {
      out.push({ entity: 'project', entityId: prev.project.id, operation: 'delete' })
    }
    if (next.project) {
      out.push({ entity: 'project', entityId: next.project.id, operation: 'create', data: next.project })
    }
  } else if (next.project && prev.project && !sameProject(prev.project, next.project)) {
    out.push({ entity: 'project', entityId: next.project.id, operation: 'update', data: next.project })
  }

  // ── shots: create / update / delete, keyed by id ──
  const before = new Map(prev.shots.map((shot) => [shot.id, shot]))
  const after = new Map(next.shots.map((shot) => [shot.id, shot]))
  for (const [id, shot] of after) {
    const previous = before.get(id)
    if (!previous) {
      out.push({
        entity: 'shot',
        entityId: id,
        parentId: next.projectId ?? undefined,
        operation: 'create',
        data: shot,
      })
    } else if (!shotEquals(previous, shot)) {
      out.push({
        entity: 'shot',
        entityId: id,
        parentId: next.projectId ?? undefined,
        operation: 'update',
        data: shot,
      })
    }
  }
  for (const [id] of before) {
    if (!after.has(id)) {
      out.push({
        entity: 'shot',
        entityId: id,
        parentId: prev.projectId ?? undefined,
        operation: 'delete',
      })
    }
  }

  // ── settings: the whitelisted slice only ──
  if (prev.boardMode !== next.boardMode) {
    out.push({
      entity: 'settings',
      entityId: 'settings',
      operation: 'update',
      data: { board_mode: next.boardMode },
    })
  }

  return out
}

function sameProject(a: Project, b: Project): boolean {
  return (
    a.title === b.title &&
    a.script_text === b.script_text &&
    a.schema_version === b.schema_version &&
    a.updated_at === b.updated_at
  )
}

/** Live view of what the tap has queued but not yet handed to the journal. */
export function initSyncTap(sink: TapSink, options: TapOptions = {}): () => void {
  const windowMs = options.windowMs ?? 600
  const onError = options.onError ?? ((cause: unknown) => console.error('sync tap failed', cause))

  let baseline: TapSnapshot | null = null
  const pending = new Map<string, LocalMutation>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> | null = null

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, windowMs)
  }

  async function flush(): Promise<void> {
    if (flushing) {
      // A write is already in flight: never drop the newer batch, queue again.
      await flushing
      if (pending.size > 0) schedule()
      return
    }
    if (pending.size === 0) return
    const batch = [...pending.values()]
    pending.clear()
    flushing = (async () => {
      try {
        await sink.record(batch)
      } catch (cause) {
        // A transient storage failure must not silently lose a change: keep the
        // batch queued (newer state for the same record still supersedes it)
        // and let the next window retry.
        for (const mutation of batch) {
          const key = entityKey(mutation.entity, mutation.entityId)
          if (!pending.has(key)) pending.set(key, mutation)
        }
        onError(cause)
        if (pending.size > 0) schedule()
      } finally {
        flushing = null
      }
    })()
    await flushing
  }

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    // Hydration / vault lock reset the workspace: never invent ops for it.
    if (!state.hydrated || !prev.hydrated || state.vault_state === 'locked') {
      pending.clear()
      baseline = null
      return
    }
    if (applyingRemote) {
      // A peer's change is now local truth — adopt it as the baseline only.
      baseline = captureSnapshot(state)
      return
    }
    if (!baseline) {
      baseline = captureSnapshot(state)
      return
    }
    const mutations = diffSnapshots(baseline, captureSnapshot(state))
    baseline = captureSnapshot(state)
    if (mutations.length === 0) return
    for (const mutation of mutations) {
      // Latest state wins inside one burst; identity stays stable per entity.
      pending.set(entityKey(mutation.entity, mutation.entityId), mutation)
    }
    schedule()
  })

  /** Awaitable flush — call before locking or before a sync session starts. */
  async function flushNow(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    // Drain, tolerating an in-flight write and one retry after a failure.
    for (let attempt = 0; attempt < 3 && pending.size > 0; attempt++) {
      if (flushing) {
        await flushing
        continue
      }
      await flush()
    }
  }

  function stop(): void {
    if (timer) clearTimeout(timer)
    timer = null
    pending.clear()
    baseline = null
    unsubscribe()
  }

  // Expose the flush to the module-level helper without leaking internals.
  tapFlushers.add(flushNow)
  return () => {
    tapFlushers.delete(flushNow)
    stop()
  }
}

const tapFlushers = new Set<() => Promise<void>>()

/** Drain every active tap (there is one in the app; tests may create several). */
export async function flushSyncTap(): Promise<void> {
  await Promise.all([...tapFlushers].map((flush) => flush()))
}

export function resetSyncTapForTests(): void {
  tapFlushers.clear()
  applyingRemote = false
}
