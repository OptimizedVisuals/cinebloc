import { z } from 'zod'
import { CAMERA_MOVEMENTS, CAMERA_SIZES } from './model/shot'
import type { Project } from './model/project'
import { SCHEMA_VERSION } from './model/project'
import type { Settings } from './model/settings'
import type { Shot } from './model/shot'

export const positionSchema = z.object({ x: z.number(), y: z.number() })

const edgeSideSchema = z.enum(['top', 'right', 'bottom', 'left'])

export const linkSchema = z.object({
  id: z.string().min(1),
  to: z.string().min(1),
  from_side: edgeSideSchema,
  to_side: edgeSideSchema,
  origin: z.enum(['ai', 'manual']).optional(),
})

export const shotSchema = z.object({
  id: z.string().min(1),
  scene_id: z.string().min(1),
  scene_heading: z.string(),
  shot_number: z.number().int().nonnegative(),
  character: z.string().nullable(),
  action: z.string(),
  size: z.enum(CAMERA_SIZES),
  lens: z.string().nullable(),
  movement: z.enum(CAMERA_MOVEMENTS).nullable(),
  position_on_board: positionSchema,
  is_completed: z.boolean(),
  order: z.number().int().nonnegative(),
  asset_refs: z.array(z.string()),
  links: z.array(linkSchema).optional(),
  notes: z.string(),
})

export const projectSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  script_text: z.string(),
  schema_version: z.number().int().positive(),
  created_at: z.number(),
  updated_at: z.number(),
})

/** One element of the raw JSON array the model is asked to return. */
export const skeletonItemSchema = z.record(z.unknown())

export const skeletonArraySchema = z.array(z.record(z.unknown()))

export const settingsSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  api_key: z.string(),
  model: z.string(),
  base_url: z.string().nullable(),
  viewport: z.enum(['auto', 'desktop', 'mobile']),
  // .default() keeps records written before this field migrating cleanly and
  // .catch() means one bad value can never fail the whole parse — falling
  // back to DEFAULT_SETTINGS would silently drop the user's API key.
  board_mode: z.enum(['default', 'fast', 'custom', 'blend']).default('fast').catch('fast'),
})

export function parseShot(value: unknown): Shot | null {
  const parsed = shotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseProject(value: unknown): Project | null {
  const parsed = projectSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Versioned migration hook — stored records pass through here on hydrate.
 * v1 is current; older versions would be upgraded field-by-field here.
 */
export function migrateProject(value: unknown): Project | null {
  const parsed = parseProject(value)
  if (!parsed) return null
  if (parsed.schema_version < SCHEMA_VERSION) {
    return { ...parsed, schema_version: SCHEMA_VERSION }
  }
  return parsed
}

export function migrateShot(value: unknown): Shot | null {
  return parseShot(value)
}

export function migrateSettings(value: unknown): Settings | null {
  const parsed = settingsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
