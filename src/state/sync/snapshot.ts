import {
  collectAssetMetas,
  parseProject,
  parseShot,
  syncedSettingsSchema,
  type Project,
  type Settings,
  type Shot,
  type StoragePort,
} from '@/kernel'

/**
 * Initial full sync (ADR 0005).
 *
 * The op log is the normal path — a reconnecting device asks for the gap and
 * gets exactly that. A snapshot exists for the case the log cannot cover: a
 * device whose library predates its own journal (or a different device's
 * library entirely) has records that never generated an operation, so nothing
 * would ever be sent for them.
 *
 * A snapshot is therefore sent **only when the peer holds nothing at all**
 * (see the engine's greeting step). Two libraries that both contain records
 * are not merged here: doing so needs a project-level diff that this increment
 * does not have, and silently overwriting one library with the other would be
 * worse than saying so. That limitation is documented in the ADR, and
 * Export/Import remains the supported path for it.
 */

export interface SnapshotData {
  projects: Project[]
  /** Flat list, for asset keys and byte totals. */
  shots: Shot[]
  /**
   * Shots grouped by owning project. A Shot carries no project id and storage
   * is keyed by project, so the grouping has to be captured while reading —
   * reconstructing it later from the flat list would be guesswork.
   */
  byProject: { projectId: string; shots: Shot[] }[]
  /** Blob keys referenced by any shot, for the asset pass that follows. */
  assetKeys: string[]
  /** Total asset bytes, so both sides can show real progress up front. */
  bytes: number
}

/** Read the whole local library. Storage is the source of truth, not the store. */
export async function collectSnapshot(storage: StoragePort): Promise<SnapshotData> {
  const projects = await storage.listProjects()
  const byProject: { projectId: string; shots: Shot[] }[] = []
  const shots: Shot[] = []
  for (const project of projects) {
    const projectShots = await storage.listShots(project.id)
    byProject.push({ projectId: project.id, shots: projectShots })
    shots.push(...projectShots)
  }
  const assetKeys = collectAssetMetas(shots)
  let bytes = 0
  for (const key of assetKeys) {
    const blob = await storage.getBlob(key)
    if (blob) bytes += blob.size
  }
  return { projects, shots, byProject, assetKeys, bytes }
}

export interface SnapshotApplyResult {
  /** Present only when the batch touched the *open* project. */
  liveProject?: Project
  liveShots?: Shot[]
  liveSettings?: Partial<Settings>
  projectsWritten: number
  shotsWritten: number
  rejected: number
}

/**
 * Write one snapshot batch. Incoming records are the peer's data, so they are
 * re-validated here — a malformed project must be dropped, not stored.
 *
 * Merges per record instead of replacing the project: a snapshot arrives in
 * several messages, and a batch that arrives after a local edit must not erase
 * it. Deletions are never inferred from absence.
 */
export async function applySnapshotProjects(input: {
  projects: readonly unknown[]
  storage: StoragePort
  activeProjectId: string | null
}): Promise<SnapshotApplyResult> {
  const result: SnapshotApplyResult = { projectsWritten: 0, shotsWritten: 0, rejected: 0 }
  for (const raw of input.projects) {
    const project = parseProject(raw)
    if (!project) {
      result.rejected += 1
      continue
    }
    await input.storage.saveProject(project)
    result.projectsWritten += 1
    if (project.id === input.activeProjectId) result.liveProject = project
  }
  return result
}

export async function applySnapshotShots(input: {
  projectId: string
  shots: readonly unknown[]
  storage: StoragePort
  activeProjectId: string | null
}): Promise<SnapshotApplyResult> {
  const result: SnapshotApplyResult = { projectsWritten: 0, shotsWritten: 0, rejected: 0 }
  const existing = await input.storage.listShots(input.projectId)
  const byId = new Map(existing.map((shot) => [shot.id, shot]))
  let touched = false

  for (const raw of input.shots) {
    const shot = parseShot(raw)
    if (!shot) {
      result.rejected += 1
      continue
    }
    byId.set(shot.id, shot)
    result.shotsWritten += 1
    touched = true
  }

  if (!touched) return result
  const next = [...byId.values()].sort((a, b) => a.order - b.order)
  await input.storage.saveShots(input.projectId, next)
  if (input.projectId === input.activeProjectId) result.liveShots = next
  return result
}

/** The only settings a snapshot may carry — same whitelist as every other path. */
export function applySnapshotSettings(settings: unknown): Partial<Settings> | null {
  const parsed = syncedSettingsSchema.safeParse(settings)
  if (!parsed.success) return null
  return { board_mode: parsed.data.board_mode }
}
