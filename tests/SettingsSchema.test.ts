/**
 * Verifies generic settings validation, migration, and partial updates.
 */

import { describe, expect, it } from 'vitest'
import {
  parsePersistedSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../src/main/settingsSchema'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('parsePersistedSettings', () => {
  it('returns defaults for missing data', () => {
    expect(parsePersistedSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('preserves valid generic preferences', () => {
    const result = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      uiLanguage: 'tr',
      pageZoom: 1.2,
    })
    expect(result).toMatchObject({ theme: 'dark', uiLanguage: 'tr', pageZoom: 1.2 })
  })

  it('enables startup launch by default for older settings', () => {
    const { startOnStartup: _removed, ...olderSettings } = DEFAULT_SETTINGS
    expect(parsePersistedSettings(olderSettings).startOnStartup).toBe(true)
  })

  it('preserves an explicitly disabled startup launch preference', () => {
    expect(
      parsePersistedSettings({ ...DEFAULT_SETTINGS, startOnStartup: false }).startOnStartup,
    ).toBe(false)
  })

  it('enables unattended updates by default for older settings', () => {
    const { unattendedUpdates: _removed, ...olderSettings } = DEFAULT_SETTINGS
    expect(parsePersistedSettings(olderSettings).unattendedUpdates).toBe(true)
  })

  it('drops obsolete feature settings', () => {
    const result = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      removedProvider: 'legacy',
      removedFeatureEnabled: true,
      earthquakeLatitude: 40,
      realtimeAlertsEnabled: true,
    })
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect(result).not.toHaveProperty('removedProvider')
    expect(result).not.toHaveProperty('removedFeatureEnabled')
    expect(result).not.toHaveProperty('earthquakeLatitude')
    expect(result).not.toHaveProperty('realtimeAlertsEnabled')
  })

  it('falls back safely when a generic preference is invalid', () => {
    expect(parsePersistedSettings({ ...DEFAULT_SETTINGS, theme: 'neon' })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('settingsSchema', () => {
  it('accepts the complete default settings document', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('requires the tray icon when close-to-tray is enabled', () => {
    const result = settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      showTrayIcon: false,
      minimizeToTrayOnClose: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('settingsPatchSchema', () => {
  it('accepts a non-empty generic patch', () => {
    expect(settingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(settingsPatchSchema.parse({ unattendedUpdates: false })).toEqual({
      unattendedUpdates: false,
    })
  })

  it('rejects empty and unknown-only patches', () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ removedFeature: true }).success).toBe(false)
  })
})
