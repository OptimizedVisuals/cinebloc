/**
 * Camera size vocabulary for the shot skeleton.
 * Kept in kernel so canvas, checklist, parser and adapters all agree.
 */
export const CAMERA_SIZES = [
  'ECU',
  'CU',
  'MCU',
  'MS',
  'MWS',
  'WS',
  'EWS',
  'POV',
  'OTS',
  'TWO',
  'INSERT',
  'AERIAL',
] as const

export type CameraSize = (typeof CAMERA_SIZES)[number]

export const CAMERA_MOVEMENTS = [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY',
  'TRACK',
  'CRANE',
  'ZOOM',
  'HANDHELD',
  'STEADICAM',
] as const

export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]

export interface Position {
  x: number
  y: number
}

/** Which edge of a card a connection node attaches to. */
export type EdgeSide = 'top' | 'right' | 'bottom' | 'left'

export const EDGE_SIDES: readonly EdgeSide[] = ['top', 'right', 'bottom', 'left']

/**
 * One directed connection ("thread") between two shot cards, anchored to a
 * specific edge on each end. `origin` marks AI-generated same-setup links so
 * they can be regenerated without touching manual ones.
 */
export interface ShotLink {
  id: string
  to: string
  from_side: EdgeSide
  to_side: EdgeSide
  origin?: 'ai' | 'manual'
}

/** One parsed shot — the atomic unit of the "70% skeleton". */
export interface Shot {
  id: string
  scene_id: string
  scene_heading: string
  shot_number: number
  character: string | null
  action: string
  size: CameraSize
  lens: string | null
  movement: CameraMovement | null
  /** Spatial coordinate tracking (canvas layout); ignored by checklist. */
  position_on_board: Position
  /** Execution state mutated by the mobile checklist toggle. */
  is_completed: boolean
  /** Canonical linear sequence (never mutated by completion sorting). */
  order: number
  /** Keys into the IndexedDB blob store. */
  asset_refs: string[]
  /** Outgoing connection nodes (canvas graph). Optional for old snapshots. */
  links?: ShotLink[]
  notes: string
}
