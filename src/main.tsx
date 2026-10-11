import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createSnapshotPort } from '@/adapters/export-json'
import { llmGateway } from '@/adapters/llm'
import { createIdbStorage } from '@/adapters/storage-indexeddb'
import { createWebRtcPort } from '@/adapters/sync-webrtc'
import { createVaultedStorage } from '@/adapters/vault'
import { hydrate, initPersistence } from '@/state/persistence'
import { initHistory } from '@/state/history'
import { installSyncRuntime } from '@/state/sync'
import { setServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import App from './app/App'
import { seedDemoIfRequested } from './dev/seed'
import './styles/global.css'

/** Composition root: inject adapter implementations behind kernel ports. */
async function boot(): Promise<void> {
  const raw = createIdbStorage()
  const { storage, vault } = await createVaultedStorage(raw)
  // The WebRTC port is wired here like every other adapter: the state layer
  // starts paired sessions without ever touching RTCPeerConnection itself.
  setServices({
    storage,
    vault,
    llm: llmGateway,
    snapshot: createSnapshotPort(storage),
    rtc: createWebRtcPort(),
  })
  initPersistence()
  initHistory()
  // Device sync (ADR 0005): identity + change log exist from boot; a peer is
  // only ever involved once a transport lands, so this stays local-only here.
  installSyncRuntime()

  const status = vault.status()
  useAppStore.getState().setVaultState(status)

  if (status === 'off') {
    // No password configured: hydrate straight into the workspace.
    await hydrate().catch((cause: unknown) => {
      console.error('hydrate failed', cause)
      useAppStore.setState(() => ({ hydrated: true }))
    })
    seedDemoIfRequested()
  }
  // 'locked' → LockScreen renders; hydrate happens after a successful unlock.
}

void boot()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
