import { skeletonArraySchema, type SkeletonItem } from '@/kernel'

/**
 * Tolerant extraction + structural repair of model output (Phase 2 gate):
 * strips fences, unwraps object envelopes, removes trailing commas, and
 * closes truncated JSON when possible. Throws ParseError when no array
 * can be recovered.
 */

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return fenced?.[1] ? fenced[1].trim() : text.trim()
}

/** Pull the outermost array (or object envelope) out of surrounding prose. */
function sliceRegion(text: string): string | undefined {
  const startBracket = text.indexOf('[')
  const startBrace = text.indexOf('{')
  if (startBracket === -1 && startBrace === -1) return undefined
  if (startBracket !== -1 && (startBrace === -1 || startBracket < startBrace)) {
    const end = text.lastIndexOf(']')
    if (end > startBracket) return text.slice(startBracket, end + 1)
  }
  const end = text.lastIndexOf('}')
  if (end > startBrace) return text.slice(startBrace, end + 1)
  return undefined
}

function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

interface Scan {
  stack: string[]
  inString: boolean
  escaped: boolean
}

function scan(text: string): Scan {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  return { stack, inString, escaped }
}

/**
 * Best-effort closure of JSON truncated mid-generation (max_tokens cut):
 * closes dangling strings, drops incomplete trailing fragments, and appends
 * the missing closers. Returns undefined when nothing parses.
 */
function closeTruncated(text: string): string | undefined {
  let base = text.trimEnd()
  for (let attempt = 0; attempt < 8 && base.length > 0; attempt++) {
    const { stack, inString, escaped } = scan(base)
    let out = base
    if (inString) {
      if (escaped) out = out.slice(0, -1)
      out += '"'
    }
    out = out.replace(/,\s*$/, '')
    const candidate = out + [...stack].reverse().join('')
    if (tryParse(candidate) !== undefined) return candidate

    // Drop the incomplete tail back to the last structural boundary.
    const cut = Math.max(
      base.lastIndexOf(','),
      base.lastIndexOf('}'),
      base.lastIndexOf(']'),
      base.lastIndexOf('"'),
    )
    if (cut <= 0) break
    base = base.slice(0, cut)
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toShotArray(value: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is Record<string, unknown> => isPlainObject(v) && Object.keys(v).length > 0,
    )
  }
  if (isPlainObject(value)) {
    for (const key of ['shots', 'shot_list', 'data', 'results', 'items']) {
      const nested = value[key]
      if (Array.isArray(nested)) return toShotArray(nested)
    }
  }
  return undefined
}

function validate(items: Record<string, unknown>[]): SkeletonItem[] {
  const parsed = skeletonArraySchema.safeParse(items)
  if (!parsed.success) throw new ParseError('Recovered JSON was not an array of objects.')
  return parsed.data as SkeletonItem[]
}

/**
 * Extract a validated array of loose skeleton objects from raw model text.
 * Throws ParseError when nothing recoverable exists.
 */
export function extractSkeletonArray(raw: string): SkeletonItem[] {
  const stripped = stripFences(raw)
  const candidates = [stripped]
  const region = sliceRegion(stripped)
  if (region && region !== stripped) candidates.push(region)

  for (const base of candidates) {
    const attempts = [base, removeTrailingCommas(base), closeTruncated(base)]
    for (const attempt of attempts) {
      if (!attempt) continue
      const parsed = tryParse(attempt)
      if (parsed === undefined) continue
      const arr = toShotArray(parsed)
      if (arr && arr.length > 0) return validate(arr)
    }
  }

  throw new ParseError(
    'The model response did not contain a usable JSON shot array. Try again, or use a shorter script excerpt.',
  )
}
