import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../model/settings'
import { migrateSettings } from '../schema'

describe('settings migration (board_mode)', () => {
  it('defaults board_mode to fast for records written before the field existed', () => {
    // A real pre-board_mode record: dropping it would wipe the user's API key.
    const legacy = {
      provider: 'openai',
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
      base_url: null,
      viewport: 'desktop',
    }

    const migrated = migrateSettings(legacy)
    expect(migrated).not.toBeNull()
    expect(migrated?.board_mode).toBe('fast')
    expect(migrated?.api_key).toBe('sk-test')
    expect(migrated?.viewport).toBe('desktop')
  })

  it('keeps an explicit board_mode as stored', () => {
    const stored = { ...DEFAULT_SETTINGS, board_mode: 'default' as const }
    expect(migrateSettings(stored)?.board_mode).toBe('default')
  })

  it('never lets one bad board_mode fail the whole settings record', () => {
    const recovered = migrateSettings({ ...DEFAULT_SETTINGS, board_mode: 'neon', api_key: 'k' })
    expect(recovered?.board_mode).toBe('fast')
    expect(recovered?.api_key).toBe('k')
  })
})
