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

  it('migrates revision 1 settings with Ankara earthquake defaults', () => {
    const result = parsePersistedSettings({ settingsRevision: 1, theme: 'dark' })
    expect(result).toMatchObject({
      settingsRevision: 3,
      theme: 'dark',
      earthquakeLatitude: 40,
      earthquakeLongitude: 32,
      fcmCheckIntervalMinutes: 480,
      realtimeNotificationPresentation: 'fullscreen',
      seismicNotificationPresentation: 'normal',
    })
  })

  it('migrates the previous seismic notification defaults', () => {
    const result = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      settingsRevision: 2,
      seismicMinimumMagnitude: 3,
      seismicMaximumDistanceKm: 500,
    })
    expect(result).toMatchObject({
      settingsRevision: 3,
      seismicMinimumMagnitude: 4,
      seismicMaximumDistanceKm: 1_000,
    })
  })

  it('drops obsolete feature settings', () => {
    const result = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      removedProvider: 'legacy',
      removedFeatureEnabled: true,
      realtimeTextToSpeech: true,
      seismicTextToSpeech: true,
      seismicTextToSpeechMinimumMagnitude: 4,
      seismicNotificationFilter: 'relevant',
    })
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect(result).not.toHaveProperty('removedProvider')
    expect(result).not.toHaveProperty('removedFeatureEnabled')
    expect(result).not.toHaveProperty('realtimeTextToSpeech')
    expect(result).not.toHaveProperty('seismicTextToSpeech')
    expect(result).not.toHaveProperty('seismicTextToSpeechMinimumMagnitude')
    expect(result).not.toHaveProperty('seismicNotificationFilter')
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

  it('validates the minute-based FCM interval and earthquake coordinates', () => {
    expect(
      settingsSchema.safeParse({ ...DEFAULT_SETTINGS, fcmCheckIntervalMinutes: 0 }).success,
    ).toBe(false)
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, earthquakeLatitude: 91 }).success).toBe(
      false,
    )
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
