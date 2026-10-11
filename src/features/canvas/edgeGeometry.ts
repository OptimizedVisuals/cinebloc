import type { EdgeSide, Position } from '@/kernel'

/**
 * Pure math for the board's connection threads (feedback round): anchor
 * points on card edges, outward normals, and the auto-routed curve that
 * leaves each card along its edge — the shortest smooth path between two
 * anchored cards that never doubles back over a card.
 */

export interface Size {
  w: number
  h: number
}

export interface PendingConnect {
  fromId: string
  side: EdgeSide
  /** Pointer position in board coordinates. */
  x: number
  y: number
  /** Card under the pointer while dragging (auto-clipped nearest edge). */
  target: { id: string; side: EdgeSide } | null
}

export const NORMALS: Record<EdgeSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

export function anchor(pos: Position, size: Size, side: EdgeSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: pos.x + size.w / 2, y: pos.y }
    case 'right':
      return { x: pos.x + size.w, y: pos.y + size.h / 2 }
    case 'bottom':
      return { x: pos.x + size.w / 2, y: pos.y + size.h }
    case 'left':
      return { x: pos.x, y: pos.y + size.h / 2 }
  }
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}

export interface Curve {
  d: string
  /** Point on the curve at t=0.5 (for the remove handle). */
  mid: { x: number; y: number }
}

/**
 * Auto-routed edge: cubic bezier whose control points push out along each
 * card's edge normal. Distance-adaptive pull keeps long hops straight
 * (shortest path) and short hops gently curved (shape preserved).
 */
export function edgeCurve(
  p0: { x: number; y: number },
  s0: EdgeSide,
  p3: { x: number; y: number },
  s3: EdgeSide,
): Curve {
  const d = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  const k = Math.min(Math.max(d * 0.35, 36), 150)
  const n0 = NORMALS[s0]
  const n3 = NORMALS[s3]
  const c1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }
  const c2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k }
  return {
    d: `M ${r(p0.x)} ${r(p0.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(p3.x)} ${r(p3.y)}`,
    mid: {
      x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
      y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
    },
  }
}

/** Live thread while dragging from a node toward a card. */
export function freeCurve(
  p0: { x: number; y: number },
  s0: EdgeSide,
  tip: { x: number; y: number },
): string {
  const n0 = NORMALS[s0]
  const d = Math.hypot(tip.x - p0.x, tip.y - p0.y)
  const k = Math.min(Math.max(d * 0.3, 30), 120)
  const c1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }
  return `M ${r(p0.x)} ${r(p0.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(tip.x)} ${r(tip.y)}, ${r(tip.x)} ${r(tip.y)}`
}

/** Edge whose midpoint is closest to a point inside the card. */
export function nearestSide(size: Size, x: number, y: number): EdgeSide {
  const dist: Record<EdgeSide, number> = {
    top: y,
    right: size.w - x,
    bottom: size.h - y,
    left: x,
  }
  let best: EdgeSide = 'top'
  let min = Infinity
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (dist[side] < min) {
      min = dist[side]
      best = side
    }
  }
  return best
}
