import { useState } from 'react'
import { modeLabel, type Shot } from '@/kernel'
import { Button } from '@/ui'
import { useAppStore } from '@/state/store'
import { useChecklistShots, useProgress, useSettings } from '@/state/select'
import { ShotEditSheet } from './ShotEditSheet'
import { ShotRow } from './ShotRow'
import styles from './checklist.module.css'

/**
 * Mobile set controller (claim 4): the SAME store array projected into a
 * single-column transactional list. Completed rows sink via the derived
 * selector — the underlying data order is never mutated. The order follows
 * the board mode chosen on the freed-up header: Default/Custom list
 * chronologically, Fastest regroups by setup so the crew walks the shortest
 * route. The desktop canvas is stripped from the DOM while this is mounted.
 *
 * The header carries no mode tabs anymore — the current order is stated in
 * one quiet line, and each row expands into an inline accordion instead of
 * pushing a whole screen of chrome.
 */
export function SetChecklist() {
  const shots = useChecklistShots()
  const progress = useProgress()
  const settings = useSettings()
  const project = useAppStore((s) => s.project)
  const [editing, setEditing] = useState<Shot | null>(null)

  // Re-read from the live list so edits inside the sheet stay in sync.
  const editingShot = editing ? shots.find((s) => s.id === editing.id) ?? editing : null
  const remaining = progress.total - progress.completed

  return (
    <div className={styles.page} data-testid="set-checklist">
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <span className={styles.title}>{project?.title ?? 'Set checklist'}</span>
          <span className={styles.count} data-testid="progress-count">
            {progress.completed}/{progress.total} · {progress.percent}%
          </span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
        </div>
        {shots.length > 0 ? (
          <div className={styles.headerMeta}>
            <span className={styles.headerMode}>{modeLabel(settings.board_mode)} order</span>
            <span className={styles.headerDot} aria-hidden="true">
              •
            </span>
            <span>{remaining === 0 ? 'all shots done' : `${remaining} left`}</span>
          </div>
        ) : null}
      </header>

      {shots.length === 0 ? (
        <ChecklistEmptyState />
      ) : (
        <ul className={styles.list}>
          {shots.map((shot) => (
            <ShotRow key={shot.id} shot={shot} onEdit={setEditing} />
          ))}
        </ul>
      )}

      {shots.length > 0 ? (
        <footer className={styles.footer}>Saved on this device only</footer>
      ) : null}

      {editingShot ? (
        <ShotEditSheet shot={editingShot} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  )
}

function ChecklistEmptyState() {
  const setActiveModal = useAppStore((s) => s.setActiveModal)
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>WORKSPACE EMPTY</div>
      <p className={styles.emptyHint}>
        Generate shots from a screenplay and every shot becomes a checkable row.
      </p>
      <div className={styles.emptyActions}>
        <Button variant="primary" onClick={() => setActiveModal('parse')}>
          Paste a script
        </Button>
        <Button onClick={() => setActiveModal('settings')}>Settings</Button>
      </div>
    </div>
  )
}
