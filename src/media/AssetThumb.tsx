import { useState } from 'react'
import { AssetLightbox } from './Lightbox'
import { useAssetUrl } from './useAssetUrl'
import styles from './assets.module.css'

interface AssetThumbProps {
  assetKey: string
  alt: string
  size?: 'sm' | 'lg'
  /** Wrap the thumb in a tap target that pops it up in the lightbox. */
  expandable?: boolean
}

export function AssetThumb({ assetKey, alt, size = 'sm', expandable = false }: AssetThumbProps) {
  const url = useAssetUrl(assetKey)
  const [open, setOpen] = useState(false)
  if (!url) return null

  const img = (
    <img
      src={url}
      alt={alt}
      className={size === 'lg' ? styles.thumbLg : styles.thumbSm}
      loading="lazy"
      draggable={false}
    />
  )

  if (!expandable) return img

  return (
    <>
      <button
        type="button"
        className={styles.thumbBtn}
        data-no-drag
        onClick={() => setOpen(true)}
        aria-label={`View ${alt || 'reference'} enlarged`}
      >
        {img}
      </button>
      {open ? <AssetLightbox url={url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
