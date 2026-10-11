import type { ReactNode } from 'react'
import type { Shot } from '@/kernel'
import { anchor, edgeCurve, freeCurve, NORMALS, type PendingConnect, type Size } from './edgeGeometry'
import styles from './canvas.module.css'

interface EdgeLayerProps {
  shots: Shot[]
  sizes: Record<string, Size>
  pending: PendingConnect | null
  /** Board mode projection: 'all' (fast), 'manual' (custom), 'none' (default). */
  linkView?: 'all' | 'manual' | 'none'
  onRotate: (fromId: string, linkId: string, end: 'from' | 'to') => void
  onRemove: (fromId: string, linkId: string) => void
}

/**
 * The connection graph layer: every shot link drawn as an auto-routed
 * curve. Hovering a thread reveals round handles (click to rotate that end
 * to the next edge) and an ✕ (remove). Rendering a live thread while the
 * user drags a node toward another card.
 */
export function EdgeLayer({
  shots,
  sizes,
  pending,
  linkView = 'all',
  onRotate,
  onRemove,
}: EdgeLayerProps) {
  const byId = new Map(shots.map((s) => [s.id, s]))
  const rows: ReactNode[] = []

  for (const shot of shots) {
    const fromSize = sizes[shot.id]
    if (!fromSize || !shot.links?.length) continue
    for (const link of shot.links) {
      // Board mode: Default draws no threads at all.
      if (linkView === 'none') continue
      // Custom mode hides the AI guides but keeps threads the user drew.
      if (linkView === 'manual' && link.origin === 'ai') continue
      const target = byId.get(link.to)
        const toSize = target ? sizes[target.id] : undefined
        if (!target || !toSize) continue

      const p0 = anchor(shot.position_on_board, fromSize, link.from_side)
      const p3 = anchor(target.position_on_board, toSize, link.to_side)
      const { d, mid } = edgeCurve(p0, link.from_side, p3, link.to_side)

      // Handles sit just inside each edge so they never block the node.
      const h0 = {
        x: p0.x - NORMALS[link.from_side].x * 16,
        y: p0.y - NORMALS[link.from_side].y * 16,
      }
      const h3 = {
        x: p3.x - NORMALS[link.to_side].x * 16,
        y: p3.y - NORMALS[link.to_side].y * 16,
      }

      rows.push(
        <g key={link.id} className={link.origin === 'ai' ? `${styles.linkG} ${styles.linkAi}` : styles.linkG}>
          <title>
            {String(shot.shot_number).padStart(2, '0')} → {String(target.shot_number).padStart(2, '0')}
            {' — hover: click a round handle to rotate that end, ✕ to remove'}
          </title>
          <path className={styles.linkLine} d={d} />
          <circle
            className={styles.linkHandle}
            cx={h0.x}
            cy={h0.y}
            r={7}
            onClick={() => onRotate(shot.id, link.id, 'from')}
          >
            <title>Rotate this end to the next edge</title>
          </circle>
          <circle
            className={styles.linkHandle}
            cx={h3.x}
            cy={h3.y}
            r={7}
            onClick={() => onRotate(shot.id, link.id, 'to')}
          >
            <title>Rotate that end to the next edge</title>
          </circle>
          <g
            className={styles.linkRemove}
            onClick={() => onRemove(shot.id, link.id)}
            role="button"
            aria-label="Remove connection"
          >
            <circle cx={mid.x} cy={mid.y} r={9} />
            <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central">
              ✕
            </text>
          </g>
        </g>,
      )
    }
  }

  let temp: ReactNode = null
  if (pending) {
    const from = byId.get(pending.fromId)
    const fromSize = from ? sizes[from.id] : undefined
    if (from && fromSize) {
      const p0 = anchor(from.position_on_board, fromSize, pending.side)
      temp = <path className={styles.tempLine} d={freeCurve(p0, pending.side, pending)} />
      if (pending.target) {
        const to = byId.get(pending.target.id)
        const toSize = to ? sizes[to.id] : undefined
        if (to && toSize) {
          const p3 = anchor(to.position_on_board, toSize, pending.target.side)
          temp = (
            <>
              {temp}
              <circle className={styles.tempTip} cx={p3.x} cy={p3.y} r={5} />
            </>
          )
        }
      }
    }
  }

  return <svg className={styles.edges}>{rows}{temp}</svg>
}
