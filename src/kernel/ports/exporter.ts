import type { Project } from '../model/project'
import type { Shot } from '../model/shot'

export interface SnapshotInput {
  project: Project
  shots: Shot[]
}

/**
 * Full local backup (records + embedded asset blobs) for device transfer.
 * Implemented by adapters/export-json; consumed by the settings feature.
 * This is the mitigation for IndexedDB not syncing across devices.
 */
export interface ExportPort {
  exportAll(input: SnapshotInput): Promise<Blob>
  importFile(file: File): Promise<SnapshotInput>
}
