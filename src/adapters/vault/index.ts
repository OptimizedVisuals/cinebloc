import type { JsonEnvelope } from './crypto'
import type { Shot, StoragePort, SyncOperation, VaultPort, VaultStatus } from '@/kernel'
import { closeAndDeleteDB } from '../storage-indexeddb/db'
import {
  b64ToBytes,
  bytesToB64,
  decryptBlob,
  decryptJson,
  deriveKey,
  encryptBlob,
  encryptJson,
  isJsonEnvelope,
  randomBytes,
} from './crypto'

/**
 * The local password vault as an encrypting decorator over StoragePort
 * (claim 2 stays intact — same port, encrypted at rest).
 *
 *   off      → plaintext passthrough (no password configured)
 *   locked   → salt + verifier stored; every data operation throws
 *   unlocked → AES-GCM key held in memory only; encrypt-on-write, decrypt-on-read
 *
 * vault_* meta keys (salt, verifier) are always stored raw — they are needed
 * to unlock and leak nothing without the password.
 */

const SALT_META = 'vault_salt'
const VERIFIER_META = 'vault_verifier'
const SALT_BYTES = 16
const VERIFIER_PLAINTEXT = 'cinebloc-vault-v1'

interface SaltRecord {
  salt: string
}

/** Record wrappers preserve the IndexedDB keyPath alongside the envelope. */
interface EncProject {
  id: string
  enc: JsonEnvelope
}
interface EncShotList {
  project_id: string
  enc: JsonEnvelope
}
/** Change-log rows keep their keyPath id outside the envelope (ADR 0005). */
interface EncSyncOp {
  id: string
  enc: JsonEnvelope
}

function isVaultMetaKey(key: string): boolean {
  return key.startsWith('vault_')
}

function isEncProject(value: unknown): value is EncProject {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v['id'] === 'string' && isJsonEnvelope(v['enc'])
}

function isEncShotList(value: unknown): value is EncShotList {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v['project_id'] === 'string' && isJsonEnvelope(v['enc'])
}

function isEncSyncOp(value: unknown): value is EncSyncOp {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v['id'] === 'string' && isJsonEnvelope(v['enc'])
}

function locked(): never {
  throw new Error('Vault is locked — unlock before accessing local data.')
}

export interface VaultedStorage {
  storage: StoragePort
  vault: VaultPort
}

export async function createVaultedStorage(inner: StoragePort): Promise<VaultedStorage> {
  let mode: { kind: 'off' } | { kind: 'locked' } | { kind: 'unlocked'; key: CryptoKey } = {
    kind: 'off',
  }

  // One-time boot probe: a stored salt means the vault is set up → locked.
  const existingSalt = await inner.getMeta<SaltRecord>(SALT_META)
  if (existingSalt) mode = { kind: 'locked' }

  const assertOpen = () => {
    if (mode.kind === 'locked') locked()
  }
  const keyOr = (): CryptoKey => (mode.kind === 'unlocked' ? mode.key : locked())

  const storage: StoragePort = {
    async listProjects() {
      assertOpen()
      const raw = (await inner.listProjects()) as unknown[]
      const out: unknown[] = []
      for (const value of raw) {
        if (isEncProject(value)) {
          out.push(await decryptJson<never>(keyOr(), value.enc))
        } else {
          out.push(value)
        }
      }
      return out as never
    },

    async saveProject(project) {
      if (mode.kind === 'off') return inner.saveProject(project)
      assertOpen()
      await inner.saveProject({
        id: project.id,
        enc: await encryptJson(keyOr(), project),
      } as never)
    },

    async loadProject(id) {
      assertOpen()
      const raw = await inner.loadProject(id)
      if (!raw) return null
      const record = raw as unknown
      if (isEncProject(record)) return (await decryptJson(keyOr(), record.enc)) as typeof raw
      return raw
    },

    async deleteProject(id) {
      await inner.deleteProject(id)
    },

    async saveShots(projectId, shots) {
      if (mode.kind === 'off') return inner.saveShots(projectId, shots)
      assertOpen()
      await inner.saveShots(projectId, [
        { project_id: projectId, enc: await encryptJson(keyOr(), shots) },
      ] as never)
    },

    async listShots(projectId) {
      assertOpen()
      const raw = (await inner.listShots(projectId)) as unknown[]
      if (raw.length === 1 && isEncShotList(raw[0])) {
        return decryptJson<Shot[]>(keyOr(), (raw[0] as EncShotList).enc)
      }
      return raw as Shot[]
    },

    async putBlob(key, blob) {
      if (mode.kind === 'off') return inner.putBlob(key, blob)
      assertOpen()
      await inner.putBlob(key, await encryptBlob(keyOr(), blob))
    },

    async getBlob(key) {
      assertOpen()
      const raw = await inner.getBlob(key)
      if (!raw) return null
      const head = new Uint8Array(await raw.slice(0, 4).arrayBuffer())
      const isEncrypted = head.length === 4 && head.every((b, i) => b === 'CVLT'[i].charCodeAt(0))
      if (!isEncrypted) return raw // pre-vault blob that migration missed
      return decryptBlob(keyOr(), raw)
    },

    async deleteBlob(key) {
      await inner.deleteBlob(key)
    },

    async listBlobKeys() {
      return inner.listBlobKeys()
    },

    async getMeta<T>(key: string) {
      if (isVaultMetaKey(key)) return inner.getMeta<T>(key)
      assertOpen()
      const raw = await inner.getMeta<unknown>(key)
      if (mode.kind === 'off') return raw as T | null
      if (raw === null || raw === undefined) return null
      if (isJsonEnvelope(raw)) return decryptJson<T>(keyOr(), raw)
      return raw as T
    },

    async setMeta(key: string, value: unknown) {
      if (isVaultMetaKey(key)) return inner.setMeta(key, value)
      if (mode.kind === 'off') return inner.setMeta(key, value)
      assertOpen()
      await inner.setMeta(key, await encryptJson(keyOr(), value))
    },

    // The change log carries project text, so it is encrypted like records.
    async listSyncOps() {
      assertOpen()
      const raw = (await inner.listSyncOps()) as unknown[]
      const out: SyncOperation[] = []
      for (const value of raw) {
        out.push(
          isEncSyncOp(value)
            ? await decryptJson<SyncOperation>(keyOr(), value.enc)
            : (value as SyncOperation),
        )
      }
      return out
    },

    async appendSyncOps(ops) {
      if (mode.kind === 'off') return inner.appendSyncOps(ops)
      assertOpen()
      const wrapped = await Promise.all(
        ops.map(async (op) => ({ id: op.id, enc: await encryptJson(keyOr(), op) })),
      )
      await inner.appendSyncOps(wrapped as never)
    },

    async deleteSyncOps(ids) {
      return inner.deleteSyncOps(ids)
    },
  }

  const vault: VaultPort = {
    status(): VaultStatus {
      return mode.kind
    },

    async setup(password) {
      if (mode.kind !== 'off') throw new Error('Vault is already set up.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters.')

      // Phase 1 — collect plaintext while still in passthrough mode.
      const projects = await inner.listProjects()
      const shotlists: { id: string; shots: Shot[] }[] = []
      for (const project of projects) {
        shotlists.push({ id: project.id, shots: await inner.listShots(project.id) })
      }
      const metas: { key: string; value: unknown }[] = []
      for (const key of ['settings', 'onboarding_done', 'active_project_id']) {
        const value = await inner.getMeta<unknown>(key)
        if (value !== null && value !== undefined) metas.push({ key, value })
      }
      const blobKeys = await inner.listBlobKeys()
      const blobs: { key: string; blob: Blob }[] = []
      for (const key of blobKeys) {
        const blob = await inner.getBlob(key)
        if (blob) blobs.push({ key, blob })
      }
      // Pending sync operations written before the vault existed.
      const syncOps = await inner.listSyncOps()

      // Phase 2 — derive key, persist salt + verifier (raw), flip to unlocked.
      const salt = randomBytes(SALT_BYTES)
      const key = await deriveKey(password, salt)
      const verifier = await encryptJson(key, VERIFIER_PLAINTEXT)
      mode = { kind: 'unlocked', key }
      await inner.setMeta(SALT_META, { salt: bytesToB64(salt) } satisfies SaltRecord)
      await inner.setMeta(VERIFIER_META, verifier)

      // Phase 3 — rewrite everything through the now-encrypting decorator.
      for (const { id, shots } of shotlists) {
        await storage.saveShots(id, shots)
      }
      for (const project of projects) {
        await storage.saveProject(project)
      }
      for (const { key: metaKey, value } of metas) {
        await storage.setMeta(metaKey, value)
      }
      for (const { key: blobKey, blob } of blobs) {
        await storage.putBlob(blobKey, blob)
      }
      // Rewrite the plaintext log through the decorator. Ids are preserved as
      // the store key, so each put() replaces its own plaintext row in place.
      await storage.appendSyncOps(syncOps)
    },

    async unlock(password) {
      if (mode.kind === 'unlocked') return true
      if (mode.kind === 'off') return false
      const saltRecord = await inner.getMeta<SaltRecord>(SALT_META)
      const verifier = await inner.getMeta<JsonEnvelope>(VERIFIER_META)
      if (!saltRecord || !verifier) return false
      try {
        const key = await deriveKey(password, b64ToBytes(saltRecord.salt))
        const check = await decryptJson<string>(key, verifier)
        if (check !== VERIFIER_PLAINTEXT) return false
        mode = { kind: 'unlocked', key }
        return true
      } catch {
        return false // wrong password (AES-GCM auth failure)
      }
    },

    lock() {
      if (mode.kind === 'unlocked') mode = { kind: 'locked' }
    },

    async eraseLocalData() {
      await closeAndDeleteDB()
      mode = { kind: 'off' }
    },
  }

  return { storage, vault }
}
