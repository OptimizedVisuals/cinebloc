import { useEffect, useState } from 'react'
import { useAssetUrl } from './useAssetUrl'
import styles from './slideshow.module.css'

/** A single photo bound to a shot, in film order. */
export interface SlideshowItem {
  shotLabel: string
  assetKey: string
}

/**
 * Film-ordered image group: one item per image, so index i always shows
 * image i — never the first image repeated.
 *
 * The popup is a fixed overlay; the arrow handles live on the left and
 * right edges so one-handed control is always within reach.
 */
export function Slideshow({ items, active, onClose }: {
  items: SlideshowItem[]
  /** Index into items that is currently shown. */
  active: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(active, items.length - 1)))
  const item = items[index] ?? null

  // Load the picture for the active slide (one key at a time, in order).
  const assetUrl = useAssetUrl(item?.assetKey ?? null)

  // Keep the displayed slide aligned when the active prop changes.
  useEffect(() => {
    setIndex((i) => Math.min(i, items.length - 1))
  }, [active, items.length])

  const total = items.length
  if (total === 0 || !item) return null
  const img = assetUrl ?? null

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
      aria-label="Slideshow"
    >
      <div className={styles.card} role="dialog" aria-modal="true" aria-label={`Slide ${index + 1} of ${total}`}>
        {/* Left arrow edge */}
        <button
          type="button"
          className={styles.arrowLeft}
          onClick={() => setIndex((i) => (i - 1 + total) % total)}
          aria-label="Previous image"
          data-testid="slideshow-prev"
        >
          <span aria-hidden="true">‹</span>
        </button>

        {/* Image area (nearly full-bleed) */}
        <div
          className={styles.imgWrap}
          style={{ background: img ? 'none' : 'var(--bg-card)' }}
        >
          {img ? (
            <img src={img} alt={item.shotLabel} draggable={false} className={styles.img} />
          ) : (
            <div className={styles.imgPlaceholder}>No image</div>
          )}
        </div>

        {/* Right arrow edge */}
        <button
          type="button"
          className={styles.arrowRight}
          onClick={() => setIndex((i) => (i + 1) % total)}
          aria-label="Next image"
          data-testid="slideshow-next"
        >
          <span aria-hidden="true">›</span>
        </button>

        <div className={styles.meta}>
          <span className={styles.counter}>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
          <span className={styles.shotLabel}>{item.shotLabel}</span>
        </div>

        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close slideshow"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
