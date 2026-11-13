/**
 * @file NotificationDispatcher.test.ts
 * @description Unit tests for notification dispatch, baseline retention while disabled, and severity grouping.
 */

import { describe, expect, it, vi } from 'vitest'
import NotificationDispatcher from '../src/main/services/usage/NotificationDispatcher'
import type { AppSettings, NotificationSettings, UsageWindow } from '../src/shared/types'
import type LoggerService from '../src/main/services/LoggerService'

const createLogger = (): LoggerService =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as LoggerService

const notification = (overrides: Partial<NotificationSettings> = {}): NotificationSettings => ({
  high: 70,
  critical: 90,
  telegram: { token: null, chatId: '', enabled: false },
  discord: { webhookUrl: null, username: 'Session Lens', enabled: false },
  enabled: true,
  ...overrides,
})

const settings = (overrides: Partial<NotificationSettings> = {}): AppSettings =>
  ({ notification: notification(overrides) }) as AppSettings

const usageWindow = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  providerName: 'Claude',
  label: 'Session',
  usedPercent: 40,
  ...overrides,
})

describe('NotificationDispatcher', () => {
  it('keeps the notification baseline current while notifications are disabled', async () => {
    const dispatcher = new NotificationDispatcher(createLogger())
    const emitNative = vi.fn()

    await dispatcher.emitAsync(
      [usageWindow({ usedPercent: 80 })],
      settings({ enabled: false }),
      emitNative,
    )
    await dispatcher.emitAsync(
      [usageWindow({ usedPercent: 100 })],
      settings({ enabled: false }),
      emitNative,
    )
    expect(emitNative).not.toHaveBeenCalled()

    // Re-enabling must not replay the crossing that happened while disabled.
    await dispatcher.emitAsync(
      [usageWindow({ usedPercent: 100 })],
      settings({ enabled: true }),
      emitNative,
    )
    expect(emitNative).not.toHaveBeenCalled()

    await dispatcher.emitAsync(
      [usageWindow({ usedPercent: 60 })],
      settings({ enabled: true }),
      emitNative,
    )
    await dispatcher.emitAsync(
      [usageWindow({ usedPercent: 100 })],
      settings({ enabled: true }),
      emitNative,
    )
    expect(emitNative).toHaveBeenCalledTimes(1)
    expect(emitNative).toHaveBeenCalledWith('critical', expect.stringContaining('100%'))
  })

  it('groups windows by severity and emits critical before high', async () => {
    const dispatcher = new NotificationDispatcher(createLogger())
    const emitNative = vi.fn()
    const config = settings()

    await dispatcher.emitAsync(
      [
        usageWindow({ label: 'Session', usedPercent: 50 }),
        usageWindow({ label: 'Weekly', usedPercent: 50 }),
      ],
      config,
      emitNative,
    )
    await dispatcher.emitAsync(
      [
        usageWindow({ label: 'Session', usedPercent: 100 }),
        usageWindow({ label: 'Weekly', usedPercent: 75 }),
      ],
      config,
      emitNative,
    )

    expect(emitNative.mock.calls.map((call) => call[0])).toEqual(['critical', 'high'])
    expect(emitNative.mock.calls[0]?.[1]).toContain('Session')
    expect(emitNative.mock.calls[1]?.[1]).toContain('Weekly')
  })
})
