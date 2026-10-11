import { describe, expect, it } from 'vitest'
import { ParseError, extractSkeletonArray } from '../repair'

describe('repair: JSON extraction and structural repair', () => {
  it('accepts a clean array', () => {
    const items = extractSkeletonArray('[{"action":"x","size":"MS"}]')
    expect(items).toHaveLength(1)
  })

  it('strips markdown fences', () => {
    const raw = 'Sure! Here is the shot list:\n```json\n[{"action":"x"}]\n```\nEnjoy.'
    expect(extractSkeletonArray(raw)).toHaveLength(1)
  })

  it('removes trailing commas', () => {
    const raw = '[{"action":"x",},{"action":"y",},]'
    expect(extractSkeletonArray(raw)).toHaveLength(2)
  })

  it('unwraps an object envelope', () => {
    const raw = '{"shots":[{"action":"x"}]}'
    expect(extractSkeletonArray(raw)).toHaveLength(1)
  })

  it('recovers an array embedded in prose', () => {
    const raw = 'Model notes before. Then: [{"action":"x"},{"action":"y"}] And after.'
    expect(extractSkeletonArray(raw)).toHaveLength(2)
  })

  it('closes JSON truncated mid-string', () => {
    const raw =
      '[{"action":"Beakers bubble","size":"CU"},{"action":"She checks the gauge","size":"M'
    const items = extractSkeletonArray(raw)
    expect(items).toHaveLength(2)
    expect(items[0].action).toBe('Beakers bubble')
  })

  it('drops empty junk objects recovered from truncation', () => {
    const raw = '[{"action":"x"},{}]'
    expect(extractSkeletonArray(raw)).toHaveLength(1)
  })

  it('throws ParseError on prose with no JSON at all', () => {
    expect(() => extractSkeletonArray('I cannot parse that screenplay, sorry.')).toThrow(
      ParseError,
    )
  })

  it('throws ParseError on an empty response', () => {
    expect(() => extractSkeletonArray('')).toThrow(ParseError)
  })
})
