import { migrateSettings, type Project, type Shot } from '@/kernel'
import { getServices } from './services'
import { useAppStore } from './store'

/**
 * Store → IndexedDB bridge. The store is always primary; this layer only
 * mirrors. Debounced single writer, with a synchronous flush on tab hide
 * so no edit is lost when a phone screen locks on set.
 */

const DEBOUNCE_MS = 400

let timer: ReturnType<typeof setTimeout> | null = null
let stop: (() => void) | null = null

async function persistNow(): Promise<void> {
  const state = useAppStore.getState()
  const { storage, vault } = getServices()
  // Never write while locked: would clobber encrypted data with defaults.
  if (vault.status() === 'locked') return
  const writes: Promise<void>[] = [storage.setMeta('settings', state.settings)]
  if (state.onboarding_done) writes.push(storage.setMeta('onboarding_done', true))
  if (state.project) {
    const project: Project = { ...state.project, updated_at: Date.now() }
    const shots: Shot[] = state.shots
    writes.push(storage.saveProject(project))
    writes.push(storage.saveShots(project.id, shots))
    writes.push(storage.setMeta('active_project_id', project.id))
  }
  await Promise.all(writes)
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    persistNow().catch((err: unknown) => console.error('persist failed', err))
  }, DEBOUNCE_MS)
}

function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  persistNow().catch((err: unknown) => console.error('flush failed', err))
}

/** Awaitable flush — called before locking so no edit is lost. */
export async function flushPersistence(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await persistNow().catch((err: unknown) => console.error('flush failed', err))
}

export function initPersistence(): () => void {
  if (stop) return stop
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (
      state.shots !== prev.shots ||
      state.project !== prev.project ||
      state.settings !== prev.settings ||
      state.onboarding_done !== prev.onboarding_done
    ) {
      schedule()
    }
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flush)
  stop = () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', flush)
    stop = null
  }
  return stop
}

/**
 * Load persisted settings into the store before first paint. The app opens
 * on Home every time — the last project stays reachable through
 * `active_project_id` (Home lists it as Continue), so no workspace is
 * auto-resumed behind the homepage.
 */
export async function hydrate(): Promise<void> {
  const { storage } = getServices()
  const [rawSettings, onboarding] = await Promise.all([
    storage.getMeta<unknown>('settings'),
    storage.getMeta<boolean>('onboarding_done'),
  ])
  const settings = migrateSettings(rawSettings)
  useAppStore.setState((state) => ({
    ...state,
    settings: settings ?? state.settings,
    onboarding_done: onboarding === true,
    project: null,
    shots: [],
    hydrated: true,
  }))
}
