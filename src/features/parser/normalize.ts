import {
  CAMERA_MOVEMENTS,
  CAMERA_SIZES,
  defaultPosition,
  type CameraMovement,
  type CameraSize,
  type SkeletonItem,
  type Shot,
} from '@/kernel'

/**
 * Turns the loose "70%" skeleton into strict Shot records: tolerant key and
 * value aliasing, per-scene shot numbering, stable ids, derived scene ids,
 * and initial grid coordinates. One messy-output decision point (claim 1).
 */

const SIZE_ALIASES: Record<string, CameraSize> = {
  'EXTREME CLOSE UP': 'ECU',
  'EXTREME CLOSE-UP': 'ECU',
  ECU: 'ECU',
  'CLOSE UP': 'CU',
  'CLOSE-UP': 'CU',
  CU: 'CU',
  'CLOSE ON': 'CU',
  'MEDIUM CLOSE UP': 'MCU',
  'MEDIUM CLOSE-UP': 'MCU',
  MCU: 'MCU',
  'MEDIUM SHOT': 'MS',
  MS: 'MS',
  'MEDIUM WIDE SHOT': 'MWS',
  MWS: 'MWS',
  'MEDIUM WIDE': 'MWS',
  'WIDE SHOT': 'WS',
  'WIDE': 'WS',
  WS: 'WS',
  'ESTABLISHING': 'WS',
  'ESTABLISHING SHOT': 'WS',
  'EXTREME WIDE SHOT': 'EWS',
  EWS: 'EWS',
  POV: 'POV',
  'POINT OF VIEW': 'POV',
  'OVER THE SHOULDER': 'OTS',
  OTS: 'OTS',
  'TWO SHOT': 'TWO',
  'TWO-SHOT': 'TWO',
  'TWO': 'TWO',
  INSERT: 'INSERT',
  'INSERT SHOT': 'INSERT',
  AERIAL: 'AERIAL',
  'AERIAL SHOT': 'AERIAL',
  'MASTER': 'WS',
  'FULL SHOT': 'MS',
  'LONG SHOT': 'WS',
}

const MOVEMENT_ALIASES: Record<string, CameraMovement> = {
  STATIC: 'STATIC',
  LOCKED: 'STATIC',
  'LOCKED OFF': 'STATIC',
  STILL: 'STATIC',
  NONE: 'STATIC',
  PAN: 'PAN',
  TILT: 'TILT',
  DOLLY: 'DOLLY',
  PUSH: 'DOLLY',
  'PUSH IN': 'DOLLY',
  'DOLLY IN': 'DOLLY',
  TRACK: 'TRACK',
  'TRACKING': 'TRACK',
  CRANE: 'CRANE',
  ZOOM: 'ZOOM',
  HANDHELD: 'HANDHELD',
  'HAND HELD': 'HANDHELD',
  STEADICAM: 'STEADICAM',
  'STEDI CAM': 'STEADICAM',
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

/**
 * Tolerant field lookup: exact key first, then a case/separator-insensitive
 * match across aliases — real models drift to camelCase or prose keys.
 */
function pick(item: SkeletonItem, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = item[key]
    if (value !== undefined && value !== null) return value
  }
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '')
  const targets = keys.map(norm)
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined || v === null) continue
    if (targets.includes(norm(k))) return v
  }
  return undefined
}

function coerceSize(value: unknown): CameraSize {
  const raw = str(value)
  if (!raw) return 'MS'
  const upper = raw.toUpperCase()
  if ((CAMERA_SIZES as readonly string[]).includes(upper)) return upper as CameraSize
  const alias = SIZE_ALIASES[upper]
  if (alias) return alias
  const partial = Object.keys(SIZE_ALIASES).find((k) => upper.includes(k))
  return partial ? SIZE_ALIASES[partial] : 'MS'
}

function coerceMovement(value: unknown): CameraMovement | null {
  const raw = str(value)
  if (!raw) return null
  const upper = raw.toUpperCase()
  if ((CAMERA_MOVEMENTS as readonly string[]).includes(upper)) return upper as CameraMovement
  return MOVEMENT_ALIASES[upper] ?? null
}

function coerceShotNumber(value: unknown): number | null {
  const raw = str(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'scene'
}

/** A junk element has no recognizable content at all. */
function isJunk(item: SkeletonItem): boolean {
  return (
    !str(pick(item, 'action', 'description')) &&
    !str(pick(item, 'scene_heading', 'sceneHeading', 'heading', 'slugline')) &&
    !str(pick(item, 'size', 'camera_size', 'cameraSize')) &&
    coerceShotNumber(pick(item, 'shot_number', 'shotNumber', 'shot_num')) === null
  )
}

/**
 * Normalize raw skeleton items to strict Shots.
 * Deterministic: same input → same ids are unique (uuid) but same layout/order.
 */
export function normalizeSkeleton(items: SkeletonItem[]): Shot[] {
  const clean = items.filter((item) => !isJunk(item))
  const shots: Shot[] = []
  const seenScenes = new Map<string, string>()
  const perSceneCount = new Map<string, number>()

  clean.forEach((item, index) => {
    const heading = (str(pick(item, 'scene_heading', 'sceneHeading', 'heading', 'slugline', 'scene')) ?? 'UNSLUGGED').toUpperCase()
    const explicitSceneId = str(pick(item, 'scene_id', 'sceneId'))
    let sceneId = explicitSceneId ? slugify(explicitSceneId) : slugify(heading)
    const priorScene = seenScenes.get(sceneId)
    if (priorScene !== undefined && priorScene !== heading) {
      // same slug, different heading — disambiguate
      sceneId = `${sceneId}-${seenScenes.size}`
    }
    if (!seenScenes.has(sceneId)) seenScenes.set(sceneId, heading)

    const explicitNumber = coerceShotNumber(pick(item, 'shot_number', 'shotNumber', 'shot_num', 'shot'))
    const count = perSceneCount.get(sceneId) ?? 0
    const shotNumber = explicitNumber ?? count + 1
    perSceneCount.set(sceneId, count + 1)

    shots.push({
      id: crypto.randomUUID(),
      scene_id: sceneId,
      scene_heading: heading,
      shot_number: shotNumber,
      character: str(pick(item, 'character', 'character_name', 'characterName'))?.toUpperCase() ?? null,
      action: str(pick(item, 'action', 'description', 'shot_description')) ?? '',
      size: coerceSize(pick(item, 'size', 'camera_size', 'cameraSize', 'shot_size')),
      lens: str(pick(item, 'lens', 'lens_mm')),
      movement: coerceMovement(pick(item, 'movement', 'camera_movement', 'cameraMovement', 'move')),
      position_on_board: defaultPosition(index),
      is_completed: false,
      order: index,
      asset_refs: [],
      notes: str(pick(item, 'notes', 'note', 'comments')) ?? '',
    })
  })

  return shots
}
