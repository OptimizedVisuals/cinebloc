import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Project, Shot } from '@/kernel'
import { createIdbStorage } from '../../storage-indexeddb'
import { createSnapshotPort } from '../index'

const storage = createIdbStorage()
const snapshot = createSnapshotPort(storage)

const project: Project = {
  id: 'p-snap',
  title: 'Rain Diner',
  script_text: 'INT. DINER - NIGHT',
  schema_version: 1,
  created_at: 1,
  updated_at: 2,
}

const shot: Shot = {
  id: 's-snap',
  scene_id: 'int-diner-night',
  scene_heading: 'INT. DINER - NIGHT',
  shot_number: 1,
  character: 'ALICE',
  action: 'Alice slides in',
  size: 'MS',
  lens: '35mm',
  movement: 'STATIC',
  position_on_board: { x: 64, y: 64 },
  is_completed: true,
  order: 0,
  asset_refs: ['s-snap/lighting-plot.png'],
  notes: 'practical neon',
}

describe('snapshot export/import (device transfer)', () => {
  it('exports project + shots + embedded blobs as one JSON file', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    await storage.putBlob('s-snap/lighting-plot.png', png)

    const file = await snapshot.exportAll({ project, shots: [shot] })
    expect(file.type).toBe('application/json')

    const parsed = JSON.parse(await file.text()) as {
      cinebloc_snapshot: number
      project: Project
      shots: Shot[]
      assets: { key: string; data: string }[]
    }
    expect(parsed.cinebloc_snapshot).toBe(1)
    expect(parsed.project.title).toBe('Rain Diner')
    expect(parsed.shots).toHaveLength(1)
    expect(parsed.assets).toHaveLength(1)
    expect(parsed.assets[0].key).toBe('s-snap/lighting-plot.png')
    expect(parsed.assets[0].data.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('imports a snapshot, restoring records and blob bytes', async () => {
    const png = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    await storage.putBlob('s-snap/lighting-plot.png', png)
    const exported = await snapshot.exportAll({ project, shots: [shot] })

    // wipe the blob, then restore from the snapshot
    await storage.deleteBlob('s-snap/lighting-plot.png')
    const asFile = new File([exported], 'backup.json', { type: 'application/json' })
    const restored = await snapshot.importFile(asFile)

    expect(restored.project).toEqual(project)
    expect(restored.shots).toEqual([shot])

    const blob = await storage.getBlob('s-snap/lighting-plot.png')
    expect(blob).not.toBeNull()
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('rejects files that are not RecBay snapshots', async () => {
    const bogus = new File([JSON.stringify({ hello: 'world' })], 'x.json', {
      type: 'application/json',
    })
    await expect(snapshot.importFile(bogus)).rejects.toThrow()
  })
})
