import { useState } from 'react'
import type { Shot } from '@/kernel'
import { AssetThumb } from './AssetThumb'
import { Slideshow } from './Slideshow'
import styles from './slideshowThumbs.module.css'

/**
 * A reference-image thumbnail for ONE slot of a shot's image array
 * (`index` selects which image). On tap it pops the slideshow for the
 * whole group, starting on this image.
 *
 * Group order = the store's film order (the order shots are planned in
 * in the editor), so a photo added to shot 2 is always in the S2 group —
 * never appended at the end.
 */
export function SlideshowThumb({ shot, alt, size = 'sm', expandable = false, index = 0 }: {
  shot: Shot
  alt: string
  size?: 'sm' | 'lg'
  expandable?: boolean
  /** Which image of `shot.asset_refs` this button previews. */
  index?: number
}) {
  const keys = shot.asset_refs
  const [open, setOpen] = useState(false)

  // Empty slot: fewer images than requested — render nothing, never a
  // duplicate of image 0.
  const assetKey = keys[index]
  if (!assetKey) return null

  const shotLabel = String(shot.shot_number).padStart(2, '0') + ' · ' + shot.scene_heading

  return (
    <>
      <button
        type="button"
        className={[styles.thumbBtn, expandable ? styles.expandable : ''].filter(Boolean).join(' ')}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label={`View ${shot.shot_number} image ${index + 1} of ${keys.length}: ${alt}`}
      >
        <AssetThumb assetKey={assetKey} alt={alt} size={size} />
      </button>

      {open ? (
        <Slideshow
          items={keys.map((key) => ({ shotLabel, assetKey: key }))}
          active={index}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
