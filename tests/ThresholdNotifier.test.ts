/**
 * @file ThresholdNotifier.test.ts
 * @description Unit tests for latched threshold and reset notifications across refresh cycles.
 */

import { describe, expect, it } from 'vitest'
import ThresholdNotifier from '../src/main/services/usage/ThresholdNotifier'
import type { NotificationSettings, UsageWindow } from '../src/shared/types'

const notification = (overrides: Partial<NotificationSettings> = {}): NotificationSettings => ({
  high: 70,
  critical: 90,
  telegram: { token: null, chatId: '', enabled: false },
  discord: { webhookUrl: null, username: 'Session Lens', enabled: false },
  enabled: true,
  ...overrides,
})

const usageWindow = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  providerName: 'Claude',
  label: 'Session',
  usedPercent: 40,
  ...overrides,
})

const resetAt = (hours: number): string => new Date(Date.UTC(2026, 0, 1, hours, 0, 0)).toISOString()

describe('ThresholdNotifier', () => {
  it('captures a baseline without notifying on the first observation', () => {
    const notifier = new ThresholdNotifier()

    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], notification())).toEqual([])
  })

  it('announces a window reaching 100% exactly once despite jitter', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 80 })], settings)).toEqual([])

    const first = notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)
    expect(first).toHaveLength(1)
    expect(first[0]?.level).toBe('critical')
    expect(first[0]?.message).toContain('100%')

    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 99.9 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toEqual([])
  })

  it('escalates from high to critical and then announces full usage once', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 60 })], settings)).toEqual([])

    const high = notifier.evaluate([usageWindow({ usedPercent: 72 })], settings)
    expect(high.map((item) => item.level)).toEqual(['high'])

    const critical = notifier.evaluate([usageWindow({ usedPercent: 92 })], settings)
    expect(critical.map((item) => item.level)).toEqual(['critical'])
    expect(critical[0]?.message).toContain('critically high')

    const full = notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)
    expect(full.map((item) => item.level)).toEqual(['critical'])
    expect(full[0]?.message).toContain('limit reached')

    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toEqual([])
  })

  it('re-announces a threshold only after usage leaves the hysteresis band', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 50 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 71 })], settings)).toHaveLength(1)
    expect(notifier.evaluate([usageWindow({ usedPercent: 66 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 64 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 72 })], settings)).toHaveLength(1)
  })

  it('does not repeat a critical alert while usage hovers near the threshold', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 50 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 91 })], settings)).toHaveLength(1)
    expect(notifier.evaluate([usageWindow({ usedPercent: 89 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 90.5 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toHaveLength(1)
  })

  it('announces a reset once and stays silent while the unused window keeps rolling', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(
      notifier.evaluate([usageWindow({ usedPercent: 90, resetAt: resetAt(0) })], settings),
    ).toEqual([])

    const reset = notifier.evaluate(
      [usageWindow({ usedPercent: 0, resetAt: resetAt(5) })],
      settings,
    )
    expect(reset.map((item) => item.level)).toEqual(['reset'])

    expect(
      notifier.evaluate([usageWindow({ usedPercent: 0, resetAt: resetAt(5) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 0, resetAt: resetAt(10) })], settings),
    ).toEqual([])
  })

  it('re-arms a reset notification only after the window is used again', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(
      notifier.evaluate([usageWindow({ usedPercent: 100, resetAt: resetAt(0) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 0, resetAt: resetAt(5) })], settings),
    ).toHaveLength(1)
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 20, resetAt: resetAt(5) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 0, resetAt: resetAt(10) })], settings),
    ).toHaveLength(1)
  })

  it('ignores tiny usage fluctuations', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(
      notifier.evaluate([usageWindow({ usedPercent: 40, resetAt: resetAt(0) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 39.5, resetAt: resetAt(0) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 39.2, resetAt: resetAt(0) })], settings),
    ).toEqual([])
  })

  it('confirms a reset from a meaningful drop when timestamps are unavailable', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 60 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 55 })], settings)).toEqual([])

    const reset = notifier.evaluate([usageWindow({ usedPercent: 0 })], settings)
    expect(reset.map((item) => item.level)).toEqual(['reset'])
  })

  it('waits for the usage drop when the reset deadline advances first', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(
      notifier.evaluate([usageWindow({ usedPercent: 100, resetAt: resetAt(0) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 100, resetAt: resetAt(5) })], settings),
    ).toEqual([])
    expect(
      notifier.evaluate([usageWindow({ usedPercent: 0, resetAt: resetAt(5) })], settings),
    ).toHaveLength(1)
  })

  it('rebaselines after a provider outage instead of alerting on stale data', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(notifier.evaluate([usageWindow({ usedPercent: 50 })], settings)).toEqual([])
    expect(notifier.evaluate([], settings)).toEqual([])

    // The provider comes back with an exhausted window; this is a new baseline.
    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toEqual([])

    expect(notifier.evaluate([usageWindow({ usedPercent: 60 })], settings)).toEqual([])
    expect(notifier.evaluate([usageWindow({ usedPercent: 100 })], settings)).toHaveLength(1)
  })

  it('deduplicates repeated window identities before evaluating crossings', () => {
    const notifier = new ThresholdNotifier()
    const settings = notification()

    expect(
      notifier.evaluate(
        [usageWindow({ usedPercent: 40 }), usageWindow({ usedPercent: 40 })],
        settings,
      ),
    ).toEqual([])

    expect(
      notifier.evaluate(
        [usageWindow({ usedPercent: 100 }), usageWindow({ usedPercent: 40 })],
        settings,
      ),
    ).toHaveLength(1)
    expect(
      notifier.evaluate(
        [usageWindow({ usedPercent: 100 }), usageWindow({ usedPercent: 40 })],
        settings,
      ),
    ).toEqual([])
  })
})
