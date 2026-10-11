import { useEffect } from 'react'
import styles from './assets.module.css'

interface AssetLightboxProps {
  url: string
  alt: string
  onClose: () => void
}

/**
 * Tap-to-expand overlay for reference images: the thumb pops up to a
 * content-card-sized panel with an ✕ top-right. Closes via the ✕, Esc, or
 * clicking anywhere on screen (per feedback). Purely local object URL —
 * zero network.
 */
export function AssetLightbox({ url, alt, onClose }: AssetLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.lightbox} onClick={onClose} role="presentation">
      <div
        className={styles.lightboxCard}
        role="dialog"
        aria-modal="true"
        aria-label={alt || 'Reference image'}
      >
        <button type="button" className={styles.lightboxClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
        <img src={url} alt={alt} className={styles.lightboxImg} draggable={false} />
      </div>
    </div>
  )
}
