import { useRef, useState } from 'react'
import { Button } from '@/ui'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import styles from './settings.module.css'

/** Restore a snapshot exported on this or another device. */
export function DataImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return
    const state = useAppStore.getState()
    setBusy(true)
    try {
      const snapshot = await getServices().snapshot.importFile(file)
      state.setProject(snapshot.project)
      state.setShots(snapshot.shots)
      state.pushToast(
        `Imported “${snapshot.project.title}” with ${snapshot.shots.length} shots.`,
        'ok',
      )
    } catch (cause) {
      console.error('import failed', cause)
      state.pushToast('Import failed — that file is not a valid RecBay snapshot.', 'error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Restore</div>
      <div className={styles.row}>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Importing…' : 'Import snapshot'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
          data-testid="import-input"
        />
      </div>
      <p className={styles.hint}>Replaces the current project with the snapshot&apos;s contents.</p>
    </div>
  )
}
