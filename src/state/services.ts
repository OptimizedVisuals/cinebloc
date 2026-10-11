import type { ExportPort, LLMPort, StoragePort, VaultPort, WebRtcPort } from '@/kernel'

/**
 * Port registry (hexagonal wiring): kernel port interfaces, adapter
 * implementations injected once by app/main.tsx. State and features see
 * only these interfaces — they can never depend on adapter internals.
 */
export interface Services {
  storage: StoragePort
  llm: LLMPort
  snapshot: ExportPort
  vault: VaultPort
  /**
   * Peer-to-peer transport (ADR 0005). Injected like every other port so the
   * state layer can start a session without importing `RTCPeerConnection`
   * (which only the adapter may touch).
   */
  rtc: WebRtcPort
}

let registry: Services | null = null

export function setServices(services: Services): void {
  registry = services
}

export function getServices(): Services {
  if (!registry) throw new Error('Services not wired — call setServices() at boot first.')
  return registry
}
