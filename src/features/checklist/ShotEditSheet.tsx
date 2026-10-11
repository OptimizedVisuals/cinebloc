import { useEffect, useRef } from 'react'
import {
  CAMERA_MOVEMENTS,
  CAMERA_SIZES,
  type CameraMovement,
  type CameraSize,
  type Shot,
} from '@/kernel'
import { Button, Field, Input, Select, Textarea } from '@/ui'
import { useAppStore } from '@/state/store'
import { SlideshowThumb, useDropAsset } from '@/media'
import styles from './checklist.module.css'

interface ShotEditSheetProps {
  shot: Shot
  onClose: () => void
}

/**
 * Mobile editing surface (claim 4): a slide-up bottom sheet with the same
 * fields as the desktop card editor, sized for thumbs — full-width inputs,
 * one column, safe-area padding. Reference images attach straight into the
 * IndexedDB blob store and preview inline.
 */
export function ShotEditSheet({ shot, onClose }: ShotEditSheetProps) {
  const editShot = useAppStore((s) => s.editShot)
  const deleteShot = useAppStore((s) => s.deleteShot)
  const drop = useDropAsset(shot.id)
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<Shot>) => editShot(shot.id, p)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={styles.sheetOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit shot ${shot.shot_number}`}
        data-testid="shot-edit-sheet"
      >
        <div className={styles.sheetGrip} aria-hidden="true" />

        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>
            Shot {shot.shot_number} · {shot.size}
          </span>
          <button
            type="button"
            className={styles.sheetClose}
            onClick={onClose}
            aria-label="Close editor"
          >
            ✕
          </button>
        </div>

        <div className={styles.sheetBody}>
          <span className={styles.sheetScene}>{shot.scene_heading}</span>

          <div className={styles.sheetGrid}>
            <Field label="Shot #">
              <Input
                type="number"
                min={0}
                value={shot.shot_number}
                onChange={(e) => patch({ shot_number: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label="Size">
              <Select
                value={shot.size}
                onChange={(e) => patch({ size: e.target.value as CameraSize })}
              >
                {CAMERA_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lens">
              <Input
                value={shot.lens ?? ''}
                placeholder="35mm"
                onChange={(e) => patch({ lens: e.target.value || null })}
              />
            </Field>
            <Field label="Movement">
              <Select
                value={shot.movement ?? ''}
                onChange={(e) =>
                  patch({ movement: (e.target.value || null) as CameraMovement | null })
                }
              >
                <option value="">—</option>
                {CAMERA_MOVEMENTS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Character">
              <Input
                value={shot.character ?? ''}
                placeholder="ALICE"
                onChange={(e) => patch({ character: e.target.value.toUpperCase() || null })}
              />
            </Field>
            <Field label="Scene heading">
              <Input
                value={shot.scene_heading}
                onChange={(e) => patch({ scene_heading: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Action">
            <Textarea
              value={shot.action}
              rows={4}
              onChange={(e) => patch({ action: e.target.value })}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={shot.notes}
              rows={3}
              placeholder="Lighting, blocking, props…"
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </Field>

          <div className={styles.sheetAssets}>
            {shot.asset_refs.map((key, i) => (
              <SlideshowThumb key={`${key}-${i}`} index={i} shot={shot} alt="Shot reference" />
            ))}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => {
                void drop.onFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={styles.assetAdd}
              onClick={() => fileRef.current?.click()}
            >
              + Add image
            </button>
          </div>
        </div>

        <div className={styles.sheetActions}>
          <Button
            variant="danger"
            onClick={() => {
              deleteShot(shot.id)
              onClose()
            }}
          >
            Delete shot
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
