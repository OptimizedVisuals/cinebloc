import { useCallback, useEffect, useState } from 'react'
import { useAssetUrl } from './useAssetUrl'
import styles from './projectSlideshow.module.css'

/** One playable frame: a project image plus where it came from. */
export interface ProjectSlide {
  assetKey: string
  shotLabel: string
}

/** Playback speeds — label, sub-note and interval in ms. */
const SPEEDS = [
  { id: '0.5x', sub: '2s', ms: 2000 },
  { id: '1x', sub: '1s', ms: 1000 },
  { id: '2x', sub: '0.5s', ms: 500 },
] as const

/**
 * Futuristic live-scroll slideshow (feedback round): a vertical 3-up
 * coverflow — blurred previous thumbnail on top, crystal-clear active
 * image in the middle with side arrows, blurred next thumbnail below.
 * Auto-advances at the selected speed; arrows/keyboard step manually.
 * Deep-black overlay, glowing borders, cyan accents.
 */
export function ProjectSlideshow({ slides, onClose }: {
  slides: ProjectSlide[]
  onClose: () => void
}) {
  const total = slides.length
  const [index, setIndex] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(1) // 1x = 1s default

  const prevIdx = (index - 1 + total) % total
  const nextIdx = (index + 1) % total

  const activeUrl = useAssetUrl(slides[index]?.assetKey ?? null)
  const prevUrl = useAssetUrl(total > 1 ? slides[prevIdx].assetKey : null)
  const nextUrl = useAssetUrl(total > 1 ? slides[nextIdx].assetKey : null)

  const goPrev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total])
  const goNext = useCallback(() => setIndex((i) => (i + 1) % total), [total])

  // Auto-advance at the chosen speed.
  useEffect(() => {
    if (total < 2) return
    const ms = SPEEDS[speedIdx].ms
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % total), ms)
    return () => window.clearTimeout(timer)
  }, [index, speedIdx, total])

  // Keyboard: Esc closes, arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, goPrev, goNext])

  if (total === 0) return null
  const slide = slides[index]

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
      aria-label="Project slideshow"
    >
      <div
        className={styles.stage}
        role="dialog"
        aria-modal="true"
        aria-label={`Slideshow: slide ${index + 1} of ${total}`}
        data-testid="project-slideshow"
      >
        {/* Top peek — previous image, blurred */}
        <button
          type="button"
          className={styles.peek}
          onClick={goPrev}
          aria-label="Previous image"
          tabIndex={total > 1 ? 0 : -1}
        >
          {prevUrl ? <img src={prevUrl} alt="" draggable={false} className={styles.peekImg} /> : null}
        </button>

        {/* Middle — crystal-clear active image with side arrows */}
        <div className={styles.center}>
          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowLeft}`}
            onClick={goPrev}
            aria-label="Previous slide"
            data-testid="slideshow-prev"
          >
            <span aria-hidden="true">‹</span>
          </button>

          <div className={styles.imgWrap}>
            {activeUrl ? (
              <img src={activeUrl} alt={slide.shotLabel} draggable={false} className={styles.img} />
            ) : (
              <div className={styles.imgPlaceholder}>No image</div>
            )}
          </div>

          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowRight}`}
            onClick={goNext}
            aria-label="Next slide"
            data-testid="slideshow-next"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        {/* Bottom peek — next image, blurred */}
        <button
          type="button"
          className={styles.peek}
          onClick={goNext}
          aria-label="Next image"
          tabIndex={total > 1 ? 0 : -1}
        >
          {nextUrl ? <img src={nextUrl} alt="" draggable={false} className={styles.peekImg} /> : null}
        </button>

        {/* HUD: counter, source label, speed pills */}
        <div className={styles.hud}>
          <div className={styles.meta}>
            <span className={styles.counter}>
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
            <span className={styles.shotLabel}>{slide.shotLabel}</span>
          </div>

          <div className={styles.speed} role="group" aria-label="Playback speed">
            {SPEEDS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={[styles.speedBtn, i === speedIdx ? styles.speedBtnOn : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={i === speedIdx}
                data-testid={`slideshow-speed-${s.id}`}
                onClick={() => setSpeedIdx(i)}
              >
                <span className={styles.speedLabel}>{s.id}</span>
                <span className={styles.speedSub}>{s.sub}</span>
              </button>
            ))}
          </div>
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
