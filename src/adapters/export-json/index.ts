import { projectSchema, shotSchema, type ExportPort, type SnapshotInput, type StoragePort } from '@/kernel'
import { z } from 'zod'

/**
 * Full local backup: one JSON file containing project, shots and every asset
 * blob as a data URL. This is the mitigation for IndexedDB not syncing across
 * devices — users export on one machine and import on another.
 */

const assetEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.string(),
  data: z.string(),
})

const snapshotSchema = z.object({
  cinebloc_snapshot: z.literal(1),
  schema_version: z.number(),
  exported_at: z.number(),
  project: projectSchema,
  shots: z.array(shotSchema),
  assets: z.array(assetEntrySchema),
})

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  const base64 = btoa(binary)
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`
}

function dataUrlToBytes(dataUrl: string): { type: string; bytes: Uint8Array<ArrayBuffer> } {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const mime = /data:([^;,]*)/.exec(header)?.[1] ?? 'application/octet-stream'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { type: mime, bytes }
}

function baseName(key: string): string {
  const last = key.split('/').pop() ?? key
  return last.replace(/^[0-9a-f-]{36}-/i, '')
}

export function createSnapshotPort(storage: StoragePort): ExportPort {
  return {
    async exportAll({ project, shots }: SnapshotInput): Promise<Blob> {
      const keys = [...new Set(shots.flatMap((s) => s.asset_refs))]
      const assets: z.infer<typeof assetEntrySchema>[] = []
      for (const key of keys) {
        const blob = await storage.getBlob(key)
        if (blob) {
          assets.push({ key, name: baseName(key), type: blob.type, data: await blobToDataUrl(blob) })
        }
      }
      const snapshot = {
        cinebloc_snapshot: 1 as const,
        schema_version: project.schema_version,
        exported_at: Date.now(),
        project,
        shots,
        assets,
      }
      return new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    },

    async importFile(file: File): Promise<SnapshotInput> {
      const raw: unknown = JSON.parse(await file.text())
      const snapshot = snapshotSchema.parse(raw)
      for (const asset of snapshot.assets) {
        const { type, bytes } = dataUrlToBytes(asset.data)
        await storage.putBlob(asset.key, new Blob([bytes], { type: asset.type || type }))
      }
      return { project: snapshot.project, shots: snapshot.shots }
    },
  }
}
