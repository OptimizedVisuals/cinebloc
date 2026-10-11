import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EDGE_SIDES, type EdgeSide, type Shot } from '@/kernel'
import { SlideshowThumb, useDropAsset } from '@/media'
import { useAppStore } from '@/state/store'
import { useDragCards } from './useDragCards'
import { ShotEditorModal } from './ShotEditorModal'
import styles from './canvas.module.css'

interface ShotCardProps {
  shot: Shot
  /** 1-based setup index (S1, S2 …) when same-setup grouping is active. */
  setup?: number
  /** Highlighted while a connection thread is being dragged onto it. */
  linkTarget?: boolean
  /** Reports measured size so the edge layer can anchor threads. */
  onSize?: (id: string, w: number, h: number) => void
  /** Pointerdown on an edge node starts a thread from that side. */
  startConnect?: (e: ReactPointerEvent, side: EdgeSide) => void
}

/** One visual card bound to a Shot record: deep metadata container + binary
 * file gateway. Drag writes position_on_board through the shared store.
 * Round nodes on each edge start connection threads; the footer toggles
 * completion so a shot can be marked done without opening the checklist.
 */
export function ShotCard({
  shot,
  setup,
  linkTarget,
  onSize,
  startConnect,
}: ShotCardProps) {
  const [editing, setEditing] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const editShot = useAppStore((s) => s.editShot)
  const toggleShot = useAppStore((s) => s.toggleShot)
  const drag = useDragCards(shot.id, shot.position_on_board)
  const dropHandlers = useDropAsset(shot.id)
  const rootRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || !onSize) return
    const report = () => onSize(shot.id, el.offsetWidth, el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shot.id, onSize])

  const links = shot.links ?? []

  return (
    <>
      <article
        ref={rootRef}
        className={[
          styles.card,
          shot.is_completed ? styles.cardDone : '',
          dropHandlers.isDragging ? styles.dragOver : '',
          linkTarget ? styles.linkTarget : '',
          notesOpen ? styles.cardNotes : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          left: shot.position_on_board.x,
          top: shot.position_on_board.y,
        }}
        onPointerDown={drag.onPointerDown}
        onDragOver={dropHandlers.onDragOver}
        onDragLeave={dropHandlers.onDragLeave}
        onDrop={dropHandlers.onDrop}
        data-shot-id={shot.id}
      >
        <header className={styles.cardHeader}>
          <span className={styles.shotNo}>
            {String(shot.shot_number).padStart(2, '0')} · {shot.size}
          </span>
          {setup !== undefined ? (
            <span className={styles.setupChip} title={`Shoot setup ${setup}`}>
              S{setup}
            </span>
          ) : null}
          <span className={styles.headerRight}>
            <button
              type="button"
              className={[
                styles.notesBtn,
                shot.notes ? styles.notesBtnHas : '',
                notesOpen ? styles.notesBtnOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-no-drag
              aria-label={`Notes for shot ${shot.shot_number} of ${shot.scene_heading}`}
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((o) => !o)}
              title="Notes"
            >
              Notes
            </button>
            <span className={styles.scene}>{shot.scene_heading}</span>
          </span>
        </header>

        {notesOpen ? (
          <div className={styles.notesPop} data-no-drag>
            <div className={styles.notesPopHead}>
              <span>Notes</span>
              <button
                type="button"
                className={styles.notesClose}
                onClick={() => setNotesOpen(false)}
                aria-label="Close notes"
                title="Close"
              >
                ✕
              </button>
            </div>
            <textarea
              className={styles.notesArea}
              value={shot.notes}
              rows={4}
              placeholder="Lighting, blocking, props…"
              aria-label={`Notes for shot ${shot.shot_number}`}
              onChange={(e) => editShot(shot.id, { notes: e.target.value })}
            />
          </div>
        ) : null}

        <div className={styles.cardBody}>
          <div className={styles.chips}>
            {shot.lens ? <span className={styles.chip}>{shot.lens}</span> : null}
            {shot.movement ? (
              <span className={styles.chip}>{shot.movement}</span>
            ) : (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>STATIC</span>
            )}
          </div>
          {shot.character ? <span className={styles.character}>{shot.character}</span> : null}
          <p className={styles.action}>{shot.action || '—'}</p>
        </div>

        <footer className={styles.cardFooter}>
          {shot.asset_refs.length > 0 ? (
            <div className={styles.thumbs} data-no-drag>
              {shot.asset_refs.slice(0, 3).map((key, i) => (
                <SlideshowThumb key={`${key}-${i}`} index={i} shot={shot} alt="Shot reference" />
              ))}
            </div>
          ) : null}
          <div className={styles.footerActions} data-no-drag>
            <button
              type="button"
              className={[
                styles.footerBtn,
                styles.doneBtn,
                shot.is_completed ? styles.doneBtnOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid="card-complete"
              aria-pressed={shot.is_completed}
              onClick={() => toggleShot(shot.id)}
              aria-label={`Mark shot ${shot.shot_number} of ${shot.scene_heading} ${
                shot.is_completed ? 'incomplete' : 'complete'
              }`}
              title={shot.is_completed ? 'Mark as not done' : 'Mark as done'}
            >
              {shot.is_completed ? 'Done ✓' : 'Mark done'}
            </button>
            <button
              className={styles.footerBtn}
              data-no-drag
              onClick={() => setEditing(true)}
              aria-label={`Edit shot ${shot.shot_number} of ${shot.scene_heading}`}
            >
              Edit
            </button>
          </div>
        </footer>

        {startConnect
          ? EDGE_SIDES.map((side) => {
              const active = links.some((l) => l.from_side === side)
              return (
                <span
                  key={side}
                  className={active ? `${styles.node} ${styles.nodeOn}` : styles.node}
                  data-side={side}
                  data-no-drag
                  title="Drag onto another card to link"
                  onPointerDown={(e) => startConnect(e, side)}
                />
              )
            })
          : null}
      </article>

      {editing ? <ShotEditorModal shot={shot} onClose={() => setEditing(false)} /> : null}
    </>
  )
}
