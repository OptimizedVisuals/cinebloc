import type { Position } from './model/shot'

/**
 * Initial spatial placement for parsed shots (claim 3): a tidy grid that the
 * user is free to break via drag-and-drop. Kept in kernel so parser and any
 * future importer produce identical starting coordinates.
 */
const CARD_W = 320
const CARD_H = 240
const GAP = 40
const ORIGIN = 64
const PER_ROW = 4

export function defaultPosition(index: number): Position {
  const col = index % PER_ROW
  const row = Math.floor(index / PER_ROW)
  return {
    x: ORIGIN + col * (CARD_W + GAP),
    y: ORIGIN + row * (CARD_H + GAP),
  }
}
