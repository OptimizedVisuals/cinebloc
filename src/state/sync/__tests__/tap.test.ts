import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalMutation } from '@/kernel'
import { canUndo, clearHistory, initHistory, redo, undo } from '../../history'
import { openProject } from '../../projectActions'
import { resetAppState, useAppStore } from '../../store'
import { flushSyncTap, initSyncTap, resetSyncTapForTests, runWithoutRecording } from '../tap'
import { installFakeServices } from './fake-services'
import { makeProject, makeShot } from './memory-storage'

let batches: LocalMutation[][]
let stop: (() => void) | null = null
let stopHistory: (() => void) | null = null

const SHOTS = [makeShot('s-a', 0), makeShot('s-b', 1), makeShot('s-c', 2)]

/** One state write, so the tap seeds its baseline without recording anything. */
function seedWorkspace(): void {
  useAppStore.setState({ project: makeProject('p-1'), shots: SHOTS })
}

function install(): void {
  batches = []
  stop = initSyncTap(
    {
      record: async (mutations) => {
        batches.push(structuredClone(mutations as LocalMutation[]))
      },
    },
    { windowMs: 5 },
  )
}

function ops(): LocalMutation[] {
  return batches.flat()
}

describe('change-log tap', () => {
  beforeEach(() => {
    batches = []
    resetSyncTapForTests()
    resetAppState()
    useAppStore.setState({ hydrated: true, onboarding_done: true })
  })

  afterEach(() => {
    stop?.()
    stop = null
    stopHistory?.()
    stopHistory = null
    clearHistory()
    resetSyncTapForTests()
    resetAppState()
  })

  it('records exactly one update op for an edited record, with the new data', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    useAppStore.getState().editShot('s-b', { lens: '85mm', notes: 'golden hour' })
    await flushSyncTap()

    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entity: 'shot', entityId: 's-b', operation: 'update', parentId: 'p-1' })
    expect((ops()[0].data as { lens: string }).lens).toBe('85mm')
  })

  it('coalesces a burst into a single op carrying the final state', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    const state = useAppStore.getState()
    for (let i = 0; i < 25; i++) state.moveShot('s-a', { x: i, y: i })
    await flushSyncTap()

    expect(ops()).toHaveLength(1)
    expect((ops()[0].data as { position_on_board: { x: number } }).position_on_board.x).toBe(24)
  })

  it('records creates and deletes, and a delete carries no payload', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    useAppStore.getState().setShots([...SHOTS, makeShot('s-new', 3)])
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entityId: 's-new', operation: 'create' })

    batches = []
    useAppStore.getState().deleteShot('s-c')
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entityId: 's-c', operation: 'delete' })
    expect(ops()[0].data).toBeUndefined()
  })

  it('records an asset attach as part of the shot it belongs to', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    useAppStore.getState().addAssetRef('s-a', 's-a/plot.png')
    await flushSyncTap()

    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entityId: 's-a', operation: 'update' })
    expect((ops()[0].data as { asset_refs: string[] }).asset_refs).toEqual(['s-a/plot.png'])
  })

  it('records undo and redo, because they are real state changes', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()
    // History starts after the workspace exists, so the only undo step is the
    // edit below — exactly what a user would experience.
    stopHistory = initHistory()

    useAppStore.getState().editShot('s-a', { action: 'changed' })
    await flushSyncTap()
    expect(ops()).toHaveLength(1)

    batches = []
    expect(undo()).toBe(true)
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect((ops()[0].data as { action: string }).action).toBe('Action s-a')

    batches = []
    expect(redo()).toBe(true)
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect((ops()[0].data as { action: string }).action).toBe('changed')
  })

  it('syncs only the whitelisted settings slice — never the API key', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    useAppStore.getState().setSettings({ board_mode: 'default' })
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entity: 'settings', operation: 'update' })
    expect(ops()[0].data).toEqual({ board_mode: 'default' })

    batches = []
    useAppStore
      .getState()
      .setSettings({ api_key: 'sk-super-secret', provider: 'openai', model: 'gpt-4o', viewport: 'mobile' })
    await flushSyncTap()
    expect(ops()).toHaveLength(0)
    expect(JSON.stringify(batches)).not.toContain('sk-super-secret')
  })

  it('records an import as a new project plus its shots', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    const imported = makeProject('p-imported', 'Imported Feature')
    const importedShots = [makeShot('i-1', 0), makeShot('i-2', 1)]
    const state = useAppStore.getState()
    // DataImport replaces the workspace with a snapshot: a normal local change,
    // so the tap must record it exactly like any other edit.
    state.setProject(imported)
    state.setShots(importedShots)
    await flushSyncTap()

    const flat = ops()
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'project', entityId: 'p-1', operation: 'delete' }),
        expect.objectContaining({ entity: 'project', entityId: 'p-imported', operation: 'create' }),
        expect.objectContaining({ entity: 'shot', entityId: 'i-1', operation: 'create' }),
      ]),
    )
    // The imported payload itself must be carried, not a stub.
    expect((flat.find((m) => m.entityId === 'p-imported')?.data as { title: string }).title).toBe(
      'Imported Feature',
    )
  })

  it('ignores remote-applied changes entirely (no echo, no duplicates)', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    runWithoutRecording(() => {
      useAppStore.getState().setShots([makeShot('s-remote', 0)])
      useAppStore.getState().setProject(makeProject('p-remote'))
    })
    await flushSyncTap()

    expect(ops()).toHaveLength(0)
  })

  it('produces nothing while data is not hydrated, and nothing after a lock reset', async () => {
    install()
    seedWorkspace()
    await flushSyncTap()

    // Vault lock wipes the workspace (hydrated false) and clears state.
    resetAppState()
    await flushSyncTap()
    expect(ops()).toHaveLength(0)

    // Unlock restores a workspace: that is a load, not a mutation.
    useAppStore.setState({ hydrated: true })
    useAppStore.setState({ project: makeProject('p-1'), shots: SHOTS })
    await flushSyncTap()
    expect(ops()).toHaveLength(0)

    // …and a real edit afterwards is still recorded.
    useAppStore.getState().editShot('s-a', { notes: 'after unlock' })
    await flushSyncTap()
    expect(ops()).toHaveLength(1)
    expect(ops()[0]).toMatchObject({ entityId: 's-a' })
  })

  it('closing the workspace is not a deletion', async () => {
    installFakeServices()
    install()
    seedWorkspace()
    await flushSyncTap()

    const { goHome } = await import('../../projectActions')
    await goHome()
    await flushSyncTap()

    expect(ops()).toHaveLength(0)
  })

  it('opening a stored project records nothing and adds no undo step', async () => {
    const storage = installFakeServices()
    await storage.saveProject(makeProject('p-1'))
    await storage.saveShots('p-1', [makeShot('s-a', 0), makeShot('s-b', 1)])

    stopHistory = initHistory()
    install()

    expect(await openProject('p-1')).toBe(true)
    await flushSyncTap()

    expect(ops()).toHaveLength(0)
    expect(canUndo()).toBe(false)
    expect(useAppStore.getState().shots).toHaveLength(2)
  })

  it('never loses a change when the journal write fails, and delivers it on retry', async () => {
    const seen: LocalMutation[][] = []
    let fail = true
    const stopTap = initSyncTap(
      {
        record: async (mutations) => {
          if (fail) throw new Error('storage unavailable')
          seen.push(structuredClone(mutations as LocalMutation[]))
        },
      },
      { windowMs: 5, onError: () => undefined },
    )

    seedWorkspace()
    await flushSyncTap()
    useAppStore.getState().editShot('s-a', { notes: 'x' })
    await flushSyncTap()
    expect(seen).toHaveLength(0) // still failing — the change stays queued

    fail = false
    await flushSyncTap()
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toMatchObject({ entityId: 's-a' })
    stopTap()
  })

  it('flushes when asked, without waiting for the burst window', async () => {
    batches = []
    const spy = vi.fn(async (mutations: readonly LocalMutation[]) => {
      batches.push(structuredClone(mutations as LocalMutation[]))
    })
    stop = initSyncTap({ record: spy }, { windowMs: 60_000 })
    seedWorkspace()
    useAppStore.getState().editShot('s-a', { notes: 'urgent' })
    await flushSyncTap()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(ops()).toHaveLength(1)
  })
})
