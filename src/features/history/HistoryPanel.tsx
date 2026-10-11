import { useEffect, useState } from 'react'
import type { Project } from '@/kernel'
import { openProject } from '@/state/projectActions'
import { flushPersistence } from '@/state/persistence'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import { Button } from '@/ui'
import styles from './history.module.css'

interface ProjectRow extends Project {
  shot_count: number
}

/**
 * Project history: every parsed/imported script stays in IndexedDB under
 * its own id, so opening a new script never destroys the previous one.
 * Open switches the live workspace; Delete cascades records + image blobs.
 */
export function HistoryPanel() {
  const activeId = useAppStore((s) => s.project?.id ?? null)
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    try {
      const { storage } = getServices()
      const all = await storage.listProjects()
      const counts = await Promise.all(all.map((p) => storage.listShots(p.id)))
      const list = all
        .map((p, i) => ({ ...p, shot_count: counts[i].length }))
        .sort((a, b) => b.updated_at - a.updated_at)
      setRows(list)
    } catch (cause) {
      console.error('list projects failed', cause)
      setRows([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function open(id: string): Promise<void> {
    setBusy(true)
    try {
      if (await openProject(id)) {
        useAppStore.getState().setActiveModal(null)
      } else {
        void refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true)
    setConfirmId(null)
    try {
      // Drain any pending debounced write first so nothing races the delete.
      await flushPersistence()
      const { storage } = getServices()
      const shots = await storage.listShots(id)
      for (const key of shots.flatMap((s) => s.asset_refs)) {
        await storage.deleteBlob(key).catch((cause: unknown) => console.warn('blob cleanup', cause))
      }
      await storage.deleteProject(id)
      // Clear the live workspace only AFTER storage is gone — the empty
      // board then reads an accurate project list, and no pending write can
      // resurrect the record.
      const state = useAppStore.getState()
      if (state.project?.id === id) {
        state.setProject(null)
        state.setShots([])
      }
      state.pushToast('Project deleted.', 'ok')
      await refresh()
    } catch (cause) {
      console.error('delete project failed', cause)
      useAppStore.getState().pushToast('Could not delete that project.', 'error')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.head}>
        <span className={styles.hint}>
          {rows === null
            ? 'Loading projects…'
            : rows.length === 0
              ? 'No saved projects yet.'
              : 'Click a row to open it.'}
        </span>
        <Button
          variant="primary"
          onClick={() => useAppStore.getState().setActiveModal('parse')}
          data-testid="history-new-project"
        >
          + New project
        </Button>
      </div>

      {rows === null ? null : rows.length === 0 ? (
        <p className={styles.empty}>Parse a script to start your first project.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((p) => {
            const isActive = p.id === activeId
            return (
              <li key={p.id} className={isActive ? `${styles.row} ${styles.rowActive}` : styles.row}>
                <button
                  type="button"
                  className={styles.main}
                  onClick={() => void open(p.id)}
                  disabled={isActive || busy}
                  aria-label={`Open ${p.title}`}
                  data-testid="open-project"
                >
                  <span className={styles.title}>
                    <span className={styles.titleText}>{p.title}</span>
                    {isActive ? <span className={styles.badge}>OPEN</span> : null}
                  </span>
                  <span className={styles.meta}>
                    {p.shot_count} shot{p.shot_count === 1 ? '' : 's'} · updated{' '}
                    {new Date(p.updated_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </button>
                <div className={styles.rowActions}>
                  {confirmId === p.id ? (
                    <>
                      <Button variant="danger" disabled={busy} onClick={() => void remove(p.id)}>
                        Confirm delete
                      </Button>
                      <Button disabled={busy} onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button disabled={busy} onClick={() => setConfirmId(p.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
