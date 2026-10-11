import styles from './canvas.module.css'

/**
 * Geometric radial-gradient anchors for the infinite board (claim 3):
 * a dotted lattice with a soft radial vignette, rendered as pure CSS.
 */
export function RadialGrid() {
  return <div className={styles.gridLayer} aria-hidden="true" data-grid />
}
