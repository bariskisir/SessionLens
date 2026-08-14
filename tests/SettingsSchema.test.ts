/**
 * Verifies generic settings validation, migration, and partial updates.
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeSettingsPatch,
  parsePersistedSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../src/main/settingsSchema'
import { DEFAULT_SETTINGS, PROVIDER_DESCRIPTORS } from '../src/shared/types'

describe('parsePersistedSettings', () => {
  it('returns defaults with all registered providers for missing data', () => {
    const result = parsePersistedSettings(null)
    expect(result.providers).toHaveLength(PROVIDER_DESCRIPTORS.length)
    expect(result.providers.every((provider) => !provider.enabled)).toBe(true)
    expect(result).toMatchObject({ theme: 'system', uiLanguage: 'en', settingsRevision: 4 })
  })

  it('enables providers whose credentials exist on first install', () => {
    const result = parsePersistedSettings(null, ['codex', 'claude', 'antigravity', 'deepseek'])
    const enabled = result.providers.filter((provider) => provider.enabled)
    expect(enabled.map((provider) => provider.name).sort()).toEqual(
      ['Antigravity', 'Claude', 'Codex', 'DeepSeek'].sort(),
    )
    for (const provider of result.providers) {
      expect(provider.refreshToken).toBe(true)
    }
    expect(result.providers).toHaveLength(PROVIDER_DESCRIPTORS.length)
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

  it('falls back safely when a generic preference is invalid', () => {
    const result = parsePersistedSettings({ ...DEFAULT_SETTINGS, theme: 'neon' })
    expect(result.theme).toBe('system')
    expect(result.providers).toHaveLength(PROVIDER_DESCRIPTORS.length)
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

  it('requires the tray icon when minimized startup is enabled', () => {
    const result = settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      showTrayIcon: false,
      startMinimized: true,
    })
    expect(result.success).toBe(false)
  })

  it('accepts minimized startup together with a tray icon', () => {
    const result = settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      showTrayIcon: true,
      startMinimized: true,
    })
    expect(result.success).toBe(true)
  })
})

describe('settingsPatchSchema', () => {
  it('accepts a non-empty generic patch', () => {
    expect(settingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(settingsPatchSchema.parse({ unattendedUpdates: false })).toEqual({
      unattendedUpdates: false,
    })
    expect(settingsPatchSchema.parse({ startMinimized: false })).toEqual({ startMinimized: false })
  })

  it('rejects empty and unknown-only patches', () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ unknownSetting: true }).success).toBe(false)
  })

  it('retains remote credentials when their delivery channel is disabled', () => {
    const notification = {
      ...DEFAULT_SETTINGS.notification,
      telegram: { token: 'telegram-token', chatId: '123', enabled: false },
      discord: { webhookUrl: 'https://discord.test/webhook', username: 'Bot', enabled: false },
    }

    expect(normalizeSettingsPatch({ notification }).notification).toMatchObject(notification)
  })

  it('migrates a legacy numeric Telegram chat ID to text', () => {
    const result = parsePersistedSettings({
      ...DEFAULT_SETTINGS,
      notification: {
        ...DEFAULT_SETTINGS.notification,
        telegram: { ...DEFAULT_SETTINGS.notification.telegram, chatId: -100123 },
      },
    })

    expect(result.notification.telegram.chatId).toBe('-100123')
  })
})
