import { useRef } from 'react'
import {
  CAMERA_MOVEMENTS,
  CAMERA_SIZES,
  type CameraMovement,
  type CameraSize,
  type Shot,
} from '@/kernel'
import { Button, Field, Input, Modal, Select, Textarea } from '@/ui'
import { useAppStore } from '@/state/store'
import { SlideshowThumb, useDropAsset } from '@/media'
import styles from './canvas.module.css'

interface ShotEditorModalProps {
  shot: Shot
  onClose: () => void
}

/** Contextual metadata editor for one card (deep metadata container, claim 3). */
export function ShotEditorModal({ shot, onClose }: ShotEditorModalProps) {
  const editShot = useAppStore((s) => s.editShot)
  const deleteShot = useAppStore((s) => s.deleteShot)
  const drop = useDropAsset(shot.id)
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<Shot>) => editShot(shot.id, p)

  return (
    <Modal title={`Shot ${shot.shot_number} — ${shot.scene_heading}`} onClose={onClose} wide>
      <div className={styles.editorGrid}>
        <Field label="Shot #">
          <Input
            type="number"
            min={0}
            value={shot.shot_number}
            onChange={(e) => patch({ shot_number: Math.max(0, Number(e.target.value) || 0) })}
            data-no-drag
          />
        </Field>
        <Field label="Size">
          <Select
            value={shot.size}
            onChange={(e) => patch({ size: e.target.value as CameraSize })}
            data-no-drag
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
            data-no-drag
          />
        </Field>
        <Field label="Movement">
          <Select
            value={shot.movement ?? ''}
            onChange={(e) =>
              patch({ movement: (e.target.value || null) as CameraMovement | null })
            }
            data-no-drag
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
            data-no-drag
          />
        </Field>
        <Field label="Scene heading">
          <Input
            value={shot.scene_heading}
            onChange={(e) => patch({ scene_heading: e.target.value })}
            data-no-drag
          />
        </Field>
        <div className={styles.editorFull}>
          <Field label="Action">
            <Textarea
              value={shot.action}
              rows={3}
              onChange={(e) => patch({ action: e.target.value })}
              data-no-drag
            />
          </Field>
        </div>
        <div className={styles.editorFull}>
          <Field label="Notes">
            <Textarea
              value={shot.notes}
              rows={2}
              placeholder="Lighting, blocking, props…"
              onChange={(e) => patch({ notes: e.target.value })}
              data-no-drag
            />
          </Field>
        </div>
      </div>

      <div className={styles.assetStrip} data-no-drag>
        {shot.asset_refs.map((key, i) => (
          <SlideshowThumb key={`${key}-${i}`} index={i} shot={shot} alt="Shot reference" />
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          data-no-drag
          onChange={(e) => {
            void drop.onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div
          className={styles.dropHint}
          data-no-drag
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDragOver={drop.onDragOver}
          onDragLeave={drop.onDragLeave}
          onDrop={drop.onDrop}
        >
          {drop.isDragging ? 'Drop to attach' : 'Drag an image here — or click to browse'}
        </div>
      </div>

      <div className={styles.editorActions}>
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
    </Modal>
  )
}
