import type { ExportPort, LLMPort, VaultPort, WebRtcPort } from '@/kernel'
import { setServices } from '../../services'
import { createMemoryStorage, type MemoryStorage } from './memory-storage'

/**
 * Wire an in-memory StoragePort into the services registry. Tests that exercise
 * the journal and the tap need `getServices().storage` to resolve, and nothing
 * else — the LLM, snapshot, vault and WebRTC ports are stubbed to fail loudly
 * if a test accidentally depends on them.
 */
export function installFakeServices(
  storage: MemoryStorage = createMemoryStorage(),
  rtc: WebRtcPort = fakeRtcPort(),
): MemoryStorage {
  const llm: LLMPort = {
    async chat() {
      throw new Error('LLM port is not used by device-sync tests')
    },
  }
  const snapshot: ExportPort = {
    async exportAll() {
      throw new Error('snapshot port is not used by device-sync tests')
    },
    async importFile() {
      throw new Error('snapshot port is not used by device-sync tests')
    },
  }
  const vault: VaultPort = {
    status: () => 'off',
    setup: async () => undefined,
    unlock: async () => false,
    lock: () => undefined,
    eraseLocalData: async () => undefined,
  }
  setServices({ storage, llm, snapshot, vault, rtc })
  return storage
}

/**
 * A WebRTC port that refuses to be used. Pairing tests inject a real fake
 * instead; anything else must never silently reach a peer connection.
 */
export function fakeRtcPort(): WebRtcPort {
  const refuse = (): never => {
    throw new Error('WebRTC port is not used by this test')
  }
  return { host: refuse, guest: refuse }
}
