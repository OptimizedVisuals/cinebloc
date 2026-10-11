import { describe, expect, it } from 'vitest'
import { parseShot } from '@/kernel'
import { extractSkeletonArray } from '../repair'
import { normalizeSkeleton } from '../normalize'

/**
 * Phase 2 quality gate harness: representative messy model outputs must all
 * produce zod-valid shots. Real-model pass rates are recorded in
 * docs/parsing-quality.md (target ≥ 70% usable-as-is).
 */

export const FIXTURES: { name: string; raw: string }[] = [
  {
    name: 'clean array',
    raw: `[{"scene_heading":"INT. ROOM - DAY","scene_id":"int-room-day","shot_number":1,"character":null,"action":"ALICE crosses to the window","size":"MS","lens":"35mm","movement":"STATIC","notes":""}]`,
  },
  {
    name: 'fenced with prose',
    raw: `Here is your shot list:\n\`\`\`json\n[{"scene_heading":"INT. ROOM - DAY","shot_number":1,"action":"ALICE crosses to the window","size":"WIDE SHOT"}]\n\`\`\`\nLet me know if you need adjustments!`,
  },
  {
    name: 'trailing commas',
    raw: `[{"scene_heading":"EXT. YARD - DAY","shot_number":1,"action":"The dog sprints across the lawn",},]`,
  },
  {
    name: 'object envelope',
    raw: `{"shots":[{"scene_heading":"INT. LAB - NIGHT","shot_number":1,"action":"Beakers bubble over a flame","size":"CU","movement":"push in"}]}`,
  },
  {
    name: 'truncated mid-string',
    raw: `[{"scene_heading":"INT. LAB - NIGHT","shot_number":1,"action":"Beakers bubble over a flame","size":"CU"},{"scene_heading":"INT. LAB - NIGHT","shot_number":2,"action":"MARA checks the gauge","size":"M`,
  },
  {
    name: 'camelCase key drift',
    raw: `[{"sceneHeading":"EXT. DOCK - DAWN","shotNumber":1,"action":"Fog rolls across the moored boats","cameraSize":"WS","cameraMovement":"CRANE"}]`,
  },
  {
    name: 'uppercase keys',
    raw: `[{"SCENE_HEADING":"INT. CAR - NIGHT","SHOT NUMBER":2,"ACTION":"Mara grips the wheel","SIZE":"MCU","LENS":"50mm"}]`,
  },
]

describe('parsing quality gate (Phase 2)', () => {
  const results = FIXTURES.map((fixture) => {
    let ok = false
    let error: string | null = null
    let shotCount = 0
    try {
      const items = extractSkeletonArray(fixture.raw)
      const shots = normalizeSkeleton(items)
      shotCount = shots.length
      ok = shots.length > 0 && shots.every((s) => parseShot(s) !== null)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    return { ...fixture, ok, error, shotCount }
  })

  for (const result of results) {
    it(`fixture "${result.name}" produces valid shots`, () => {
      expect(result.error, result.error ?? '').toBeNull()
      expect(result.ok, `fixture "${result.name}" failed (shots: ${result.shotCount})`).toBe(true)
    })
  }

  it('records a pass rate of at least 70% (gate threshold)', () => {
    const passed = results.filter((r) => r.ok).length
    const rate = passed / results.length
    console.warn(
      `[parsing-quality] ${passed}/${results.length} fixtures pass (${Math.round(rate * 100)}%)`,
    )
    expect(rate).toBeGreaterThanOrEqual(0.7)
  })
})
