import {
  parseProject,
  parseShot,
  syncedSettingsSchema,
  type Project,
  type Settings,
  type Shot,
  type StoragePort,
  type SyncOperation,
} from '@/kernel'

/**
 * Apply reconciled operations (ADR 0005).
 *
 * Two destinations, deliberately separated:
 *
 *   1. **Storage** — the durable truth for every project, including ones that
 *      are not currently open. This is why a phone that has never opened a
 *      given project still receives it.
 *   2. **The live store** — only the records that belong to the *open*
 *      project (plus the synced settings slice), returned to the caller so it
 *      can apply them inside the no-echo / no-undo guards.
 *
 * Incoming data is re-validated here rather than trusted: a peer is untrusted
 * input, and a malformed record must be dropped without corrupting the store.
 */

export interface RemoteApplyInput {
  ops: readonly SyncOperation[]
  storage: StoragePort
  activeProjectId: string | null
}

export interface RemoteApplyResult {
  /** `undefined` = untouched, `null` = cleared by a remote delete. */
  liveProject?: Project | null
  liveShots?: Shot[]
  liveSettings?: Partial<Settings>
  projectsWritten: number
  shotsWritten: number
  shotsDeleted: number
  /** Ops dropped because their payload failed validation. */
  rejected: number
}

export async function applyRemoteOps(input: RemoteApplyInput): Promise<RemoteApplyResult> {
  const { ops, storage, activeProjectId } = input
  const result: RemoteApplyResult = {
    projectsWritten: 0,
    shotsWritten: 0,
    shotsDeleted: 0,
    rejected: 0,
  }

  // ── settings: whitelisted slice only ──
  for (const op of ops) {
    if (op.entity !== 'settings') continue
    if (op.operation === 'delete') continue
    const parsed = syncedSettingsSchema.safeParse(op.data)
    if (!parsed.success) {
      result.rejected += 1
      continue
    }
    result.liveSettings = { board_mode: parsed.data.board_mode }
  }

  // ── projects ──
  const projectOps = ops.filter((op) => op.entity === 'project')
  for (const op of projectOps) {
    if (op.operation === 'delete') {
      await storage.deleteProject(op.entityId)
      result.projectsWritten += 1
      if (op.entityId === activeProjectId) {
        result.liveProject = null
        result.liveShots = []
      }
      continue
    }
    const project = parseProject(op.data)
    if (!project) {
      result.rejected += 1
      continue
    }
    await storage.saveProject(project)
    result.projectsWritten += 1
    if (project.id === activeProjectId) result.liveProject = project
  }

  // ── shots, grouped per project so each list is written once ──
  const byProject = new Map<string, SyncOperation[]>()
  for (const op of ops) {
    if (op.entity !== 'shot') continue
    const projectId = op.parentId
    if (!projectId) {
      result.rejected += 1
      continue
    }
    const list = byProject.get(projectId)
    if (list) list.push(op)
    else byProject.set(projectId, [op])
  }

  for (const [projectId, projectOps] of byProject) {
    const existing = await storage.listShots(projectId)
    const byId = new Map(existing.map((shot) => [shot.id, shot]))
    let touched = false

    for (const op of projectOps) {
      if (op.operation === 'delete') {
        if (byId.delete(op.entityId)) {
          result.shotsDeleted += 1
          touched = true
        }
        continue
      }
      const shot = parseShot(op.data)
      if (!shot) {
        result.rejected += 1
        continue
      }
      // The shot must belong to the project it was filed under.
      if (op.parentId !== projectId) {
        result.rejected += 1
        continue
      }
      byId.set(shot.id, shot)
      result.shotsWritten += 1
      touched = true
    }

    if (!touched) continue
    const next = [...byId.values()].sort((a, b) => a.order - b.order)
    await storage.saveShots(projectId, next)
    if (projectId === activeProjectId) result.liveShots = next
  }

  return result
}
