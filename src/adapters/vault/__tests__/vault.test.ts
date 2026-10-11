import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Project, Shot, SyncOperation } from '@/kernel'
import { createIdbStorage } from '../../storage-indexeddb'
import { createVaultedStorage } from '../index'
import { isJsonEnvelope } from '../crypto'

/**
 * Sequential lifecycle: passthrough → setup/migration → wrong password →
 * lock/unlock → destructive erase. Uses a raw (undecorated) handle to
 * inspect what is actually sitting in IndexedDB at rest.
 */

const raw = createIdbStorage()

const project: Project = {
  id: 'p-vault',
  title: 'Secret Feature',
  script_text: 'INT. BUNKER - NIGHT The package stays hidden.',
  schema_version: 1,
  created_at: 1,
  updated_at: 1,
}

const shot: Shot = {
  id: 's-vault',
  scene_id: 'int-bunker-night',
  scene_heading: 'INT. BUNKER - NIGHT',
  shot_number: 1,
  character: null,
  action: 'The package stays hidden',
  size: 'MS',
  lens: null,
  movement: null,
  position_on_board: { x: 64, y: 64 },
  is_completed: false,
  order: 0,
  asset_refs: ['s-vault/plot.png'],
  notes: 'classified',
}

const syncOp: SyncOperation = {
  id: 'op-vault',
  seq: 1,
  deviceId: 'pc-vault',
  entity: 'shot',
  entityId: 's-vault',
  operation: 'update',
  data: { notes: 'plain' },
  version: { counter: 1, deviceId: 'pc-vault' },
  timestamp: 1,
}

const { storage, vault } = await createVaultedStorage(raw)

describe('local password vault', () => {
  it('starts in off mode with plaintext passthrough', async () => {
    expect(vault.status()).toBe('off')
    await storage.saveProject(project)
    await storage.saveShots(project.id, [shot])
    await storage.setMeta('settings', { provider: 'gemini', api_key: 'sk-local-secret' })
    await storage.putBlob('s-vault/plot.png', new Blob([new Uint8Array([1, 2, 3])]))
    await storage.appendSyncOps([syncOp])

    // raw handle sees plaintext while off
    const seen = await raw.loadProject('p-vault')
    expect(seen?.script_text).toContain('BUNKER')
    expect((await raw.listSyncOps())[0].data).toEqual({ notes: 'plain' })
  })

  it('refuses a short password before setup', async () => {
    expect(vault.status()).toBe('off')
    await expect(vault.setup('short')).rejects.toThrow(/8 characters/)
    expect(vault.status()).toBe('off') // failed setup leaves no trace
  })

  it('setup migrates every record to ciphertext at rest', async () => {
    await vault.setup('correct-horse-9')

    expect(vault.status()).toBe('unlocked')

    // what actually sits in IndexedDB now:
    const rawProject = (await raw.loadProject('p-vault')) as unknown as Record<string, unknown>
    expect(rawProject['script_text']).toBeUndefined()
    expect(isJsonEnvelope(rawProject['enc'])).toBe(true)
    expect(JSON.stringify(rawProject)).not.toContain('BUNKER')

    const rawSettings = await raw.getMeta<unknown>('settings')
    expect(isJsonEnvelope(rawSettings)).toBe(true)

    const rawBlob = await raw.getBlob('s-vault/plot.png')
    const magic = new Uint8Array(await rawBlob!.slice(0, 4).arrayBuffer())
    expect(new TextDecoder().decode(magic)).toBe('CVLT')

    // the change log is encrypted in place too (same id → no duplicate rows)
    const rawOps = (await raw.listSyncOps()) as unknown as Record<string, unknown>[]
    expect(rawOps).toHaveLength(1)
    expect(isJsonEnvelope(rawOps[0]['enc'])).toBe(true)
    expect(JSON.stringify(rawOps)).not.toContain('plain')

    // …and the decorator still serves plaintext while unlocked
    const readable = await storage.loadProject('p-vault')
    expect(readable?.script_text).toContain('BUNKER')
    const shots = await storage.listShots('p-vault')
    expect(shots).toHaveLength(1)
    expect(shots[0].action).toBe('The package stays hidden')
  })

  it('rejects a wrong password without unlocking', async () => {
    vault.lock()
    expect(vault.status()).toBe('locked')
    expect(await vault.unlock('wrong-password')).toBe(false)
    expect(vault.status()).toBe('locked')
    await expect(storage.loadProject('p-vault')).rejects.toThrow(/locked/)
  })

  it('locks out all data access until the right password arrives', async () => {
    expect(await vault.unlock('correct-horse-9')).toBe(true)
    expect(vault.status()).toBe('unlocked')

    const settings = await storage.getMeta<{ api_key: string }>('settings')
    expect(settings?.api_key).toBe('sk-local-secret')

    const blob = await storage.getBlob('s-vault/plot.png')
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    // …and so does the change log once unlocked
    const ops = await storage.listSyncOps()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ id: 'op-vault', entityId: 's-vault' })
  })

  it('cannot run setup twice', async () => {
    await expect(vault.setup('another-password')).rejects.toThrow(/already set up/)
  })

  it('erase wipes the entire local database and returns to off', async () => {
    await vault.eraseLocalData()
    expect(vault.status()).toBe('off')
    expect(await raw.listProjects()).toEqual([])
    expect(await raw.getMeta('settings')).toBeNull()
    expect(await raw.listBlobKeys()).toEqual([])
    expect(await raw.listSyncOps()).toEqual([])
    // fresh passthrough works again
    await storage.setMeta('settings', { provider: 'openai', api_key: '' })
    expect(await raw.getMeta('settings')).toEqual({ provider: 'openai', api_key: '' })
  })
})
