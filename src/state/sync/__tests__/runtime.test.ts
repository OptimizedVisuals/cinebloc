import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetAppState, useAppStore } from '../../store'
import { flushSyncTap, resetSyncTapForTests } from '../tap'
import { installSyncRuntime } from '../runtime'
import { installFakeServices } from './fake-services'
import { createMemoryStorage, makeProject, makeShot, type MemoryStorage } from './memory-storage'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await sleep(10)
  }
  throw new Error('condition never became true')
}

let dispose: (() => void) | null = null

describe('sync runtime', () => {
  beforeEach(() => {
    resetSyncTapForTests()
    resetAppState()
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    resetSyncTapForTests()
    resetAppState()
  })

  it('starts after hydration, publishes the device and records a change end to end', async () => {
    const storage = installFakeServices()
    useAppStore.setState({ hydrated: false })

    dispose = installSyncRuntime()
    useAppStore.setState({ hydrated: true, vault_state: 'off' })
    await waitFor(() => useAppStore.getState().sync_device !== null)

    const device = useAppStore.getState().sync_device!
    expect(device.name.length).toBeGreaterThan(0)
    expect(await storage.getMeta('sync_identity')).toMatchObject({ deviceId: device.deviceId })

    useAppStore.setState({ project: makeProject('p-1'), shots: [makeShot('s-1', 0)] })
    useAppStore.getState().editShot('s-1', { notes: 'recorded by the runtime' })
    await flushSyncTap()

    const log = await storage.listSyncOps()
    const shotOp = log.find((op) => op.entity === 'shot' && op.entityId === 's-1')
    expect(shotOp).toBeDefined()
    expect(shotOp!.deviceId).toBe(device.deviceId)

    // The journal persisted its clock, so a reload continues instead of replaying.
    expect(await storage.getMeta('sync_state')).toMatchObject({ seq: expect.any(Number) })
    expect(useAppStore.getState().sync_status).not.toBe('error')
  })

  it('keeps a change made before the journal was ready and writes it after boot', async () => {
    const slow: MemoryStorage = createMemoryStorage()
    const realGetMeta = slow.getMeta.bind(slow)
    // A deliberately slow first read widens the pre-boot window.
    slow.getMeta = async <T,>(key: string): Promise<T | null> => {
      await sleep(100)
      return realGetMeta<T>(key)
    }
    installFakeServices(slow)
    useAppStore.setState({ hydrated: false })

    dispose = installSyncRuntime()
    useAppStore.setState({ hydrated: true, vault_state: 'off' })
    // Two changes land while the identity + journal are still loading.
    useAppStore.setState({ project: makeProject('p-1'), shots: [makeShot('s-1', 0)] })
    useAppStore.getState().editShot('s-1', { notes: 'made before boot finished' })
    await flushSyncTap()

    await waitFor(async () => (await slow.listSyncOps()).length > 0)
    const log = await slow.listSyncOps()
    expect(log.map((op) => op.entityId)).toContain('s-1')
    expect(useAppStore.getState().sync_device).not.toBeNull()
  })

  it('does not start while the vault is locked, then starts after unlock', async () => {
    installFakeServices()
    useAppStore.setState({ hydrated: true, vault_state: 'locked' })

    dispose = installSyncRuntime()
    await sleep(40)
    expect(useAppStore.getState().sync_device).toBeNull()
    // Nothing is recorded while locked (the tap also refuses to diff).
    useAppStore.getState().editShot('s-1', { notes: 'while locked' })
    await flushSyncTap()

    // Unlock restores the workspace and the runtime comes up.
    useAppStore.setState({ vault_state: 'off' })
    await waitFor(() => useAppStore.getState().sync_device !== null)
  })

  it('reports an honest status and stops buffering when sync cannot run', async () => {
    const storage = installFakeServices()
    useAppStore.setState({ hydrated: false })

    const original = globalThis.crypto
    // Simulate a non-secure context: the browser withholds randomUUID.
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: original.getRandomValues.bind(original) },
      configurable: true,
    })
    try {
      dispose = installSyncRuntime()
      useAppStore.setState({ hydrated: true, vault_state: 'off' })
      await waitFor(() => useAppStore.getState().sync_status === 'error')
      expect(useAppStore.getState().sync_message).toMatch(/HTTPS or localhost/)

      useAppStore.getState().editShot('s-1', { notes: 'no identity' })
      await flushSyncTap()
      expect(await storage.listSyncOps()).toEqual([])
      expect(await storage.getMeta('sync_identity')).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })
})
