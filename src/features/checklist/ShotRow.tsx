import { useState } from 'react'
import type { Shot } from '@/kernel'
import { ChevronDownIcon, PencilIcon } from '@/ui'
import { SlideshowThumb } from '@/media'
import { CompleteToggle } from './CompleteToggle'
import styles from './checklist.module.css'

interface ShotRowProps {
  shot: Shot
  /** Row C's edit trigger → the mobile bottom-sheet editor. */
  onEdit: (shot: Shot) => void
}

/**
 * One compact checklist row (claim 4). Collapsed it is a single scannable
 * line — toggle, number, scene, camera pills. Tapping it expands an
 * accordion with three tidy rows: metadata pills, the full action text
 * (wrapped, never clipped), then reference thumbnails + an edit trigger.
 * Everything is single-column and full-width, so nothing overflows a phone.
 */
export function ShotRow({ shot, onEdit }: ShotRowProps) {
  const [open, setOpen] = useState(false)
  const detailId = `shot-detail-${shot.id}`

  return (
    <li
      className={[styles.row, shot.is_completed ? styles.rowDone : ''].filter(Boolean).join(' ')}
      data-shot-id={shot.id}
    >
      <div className={styles.rowHead}>
        <CompleteToggle shot={shot} />

        <button
          type="button"
          className={styles.rowToggle}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.rowNo}>{String(shot.shot_number).padStart(2, '0')}</span>

          <span className={styles.rowMain}>
            <span className={styles.rowScene}>{shot.scene_heading}</span>
            <span className={styles.rowTags}>
              <span className={styles.tag}>{shot.size}</span>
              {shot.lens ? <span className={styles.tag}>{shot.lens}</span> : null}
              {shot.character ? <span className={styles.tag}>{shot.character}</span> : null}
            </span>
          </span>

          {shot.asset_refs.length > 0 ? (
            <span className={styles.rowImageDot} aria-hidden="true" />
          ) : null}

          <ChevronDownIcon
            size={16}
            className={[styles.chevron, open ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
          />
        </button>
      </div>

      {open ? (
        <div className={styles.detail} id={detailId}>
          {/* Row A — camera metadata pills */}
          <div className={`${styles.detailRow} ${styles.pillsRow}`}>
            <span className={styles.pillOn}>{shot.size}</span>
            {shot.lens ? <span className={styles.pill}>{shot.lens}</span> : null}
            {shot.movement ? <span className={styles.pill}>{shot.movement}</span> : null}
            {shot.character ? <span className={styles.pill}>{shot.character}</span> : null}
          </div>

          {/* Row B — full action text, wrapped */}
          <p className={styles.detailText}>{shot.action || '—'}</p>
          {shot.notes ? <p className={styles.detailNotes}>{shot.notes}</p> : null}

          {/* Row C — reference thumbnails + subtle edit trigger */}
          <div className={styles.detailRow}>
            <div className={styles.detailThumbs}>
              {shot.asset_refs.length === 0 ? (
                <span className={styles.noImage}>No reference image</span>
              ) : (
                shot.asset_refs.map((key, i) => (
                  <SlideshowThumb
                    key={`${key}-${i}`}
                    index={i}
                    shot={shot}
                    alt={`Shot ${shot.shot_number} reference`}
                  />
                ))
              )}
            </div>

            <button
              type="button"
              className={styles.editBtn}
              onClick={() => onEdit(shot)}
              aria-label={`Edit shot ${shot.shot_number}`}
            >
              <PencilIcon size={14} />
              <span>Edit</span>
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
