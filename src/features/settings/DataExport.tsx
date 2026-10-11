import { useState } from 'react'
import { Button } from '@/ui'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import styles from './settings.module.css'

/**
 * "Export all data" — ships in Phase 1 because IndexedDB doesn't sync across
 * devices; a restorable JSON snapshot (records + embedded blobs) is the
 * mitigation. Also the user's escape hatch: their data stays theirs.
 */
export function DataExport() {
  const [busy, setBusy] = useState(false)

  async function exportAll(): Promise<void> {
    const state = useAppStore.getState()
    if (!state.project) {
      state.pushToast('Nothing to export yet — parse a script first.', 'info')
      return
    }
    setBusy(true)
    try {
      const blob = await getServices().snapshot.exportAll({
        project: state.project,
        shots: state.shots,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeTitle = state.project.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'project'
      a.href = url
      a.download = `recbay-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      state.pushToast(`Exported ${state.shots.length} shots (JSON snapshot).`, 'ok')
    } catch (cause) {
      console.error('export failed', cause)
      state.pushToast('Export failed — see console for details.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Your data</div>
      <p className={styles.hint}>
        Everything lives in this browser&apos;s IndexedDB — there is no account and no cloud
        copy. Export regularly to back up, or to move a production to another device.
      </p>
      <div className={styles.row}>
        <Button variant="primary" onClick={() => void exportAll()} disabled={busy}>
          {busy ? 'Exporting…' : 'Export all data (JSON)'}
        </Button>
      </div>
    </div>
  )
}
