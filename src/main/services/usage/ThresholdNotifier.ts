/**
 * @file ThresholdNotifier.ts
 * @description Compares per-window usage between refreshes and emits threshold-crossing
 * and usage-reset notifications. Notification state is latched per window so a window
 * that stays above a threshold is announced only once until it leaves the band or a
 * genuine reset is confirmed. First observations and windows returning after a provider
 * outage are treated as new baselines to avoid spurious alerts.
 */

import type { NotificationSettings, NotificationLevel, UsageWindow } from '@shared/types'

export interface ThresholdNotification {
  level: NotificationLevel
  message: string
  window: {
    providerName: string
    label: string
    subLabel: string | null
  }
}

/** Threshold band a window is currently known to have announced. */
type ThresholdLevel = 'high' | 'critical'

/** Per-window notification state retained between refresh cycles. */
interface WindowNotificationState {
  usedPercent: number
  resetAt: string | null
  notifiedLevel: ThresholdLevel | null
  fullNotified: boolean
  resetArmed: boolean
  /** A reset deadline advanced but usage had not dropped yet in that cycle. */
  resetPending: boolean
  lastSeenCycle: number
}

/** Percentage points a window must fall below a threshold before it can re-announce it. */
const THRESHOLD_HYSTERESIS_PERCENT = 5
/** Minimum previous usage and drop in percentage points that can confirm a reset. */
const RESET_MIN_DROP_PERCENT = 10
/** Usage at or below this percentage is treated as freshly reset; also re-arms resets. */
const RESET_REARM_PERCENT = 10
/** Tolerance for small reset timestamp drifts between provider responses. */
const RESET_DEADLINE_TOLERANCE_MS = 60_000
/** Number of missing cycles after which a window's state is discarded. */
const MAX_MISSING_CYCLES = 288

const windowKey = (window: UsageWindow): string =>
  `${window.providerName}\u0000${window.label}\u0000${window.subLabel ?? ''}`

const windowLabel = (window: UsageWindow): string =>
  window.subLabel ? `${window.label} (${window.subLabel})` : window.label

const displayPercent = (fraction: number): number => Math.round(fraction * 100)

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

const parseTime = (value: string | null | undefined): number | null => {
  if (value == null) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

const normalizeResetAt = (value: string | null | undefined): string | null => {
  const parsed = parseTime(value)
  return parsed === null ? null : new Date(parsed).toISOString()
}

const levelForFraction = (
  fraction: number,
  high: number,
  critical: number,
): ThresholdLevel | null => {
  if (fraction >= critical) return 'critical'
  if (fraction >= high) return 'high'
  return null
}

/**
 * Collapses duplicate window identities before evaluation. Providers occasionally
 * return the same quota bucket more than once; matching only the first previous
 * duplicate could make the other copy look like a fresh crossing on every cycle.
 */
const dedupeWindows = (windows: UsageWindow[]): UsageWindow[] => {
  const byKey = new Map<string, UsageWindow>()
  for (const window of windows) {
    if (!Number.isFinite(window.usedPercent)) continue
    const key = windowKey(window)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...window })
      continue
    }
    const existingResetAt = parseTime(existing.resetAt) ?? Number.NEGATIVE_INFINITY
    const candidateResetAt = parseTime(window.resetAt) ?? Number.NEGATIVE_INFINITY
    if (
      window.usedPercent > existing.usedPercent ||
      (window.usedPercent === existing.usedPercent && candidateResetAt > existingResetAt)
    ) {
      byKey.set(key, { ...window })
    }
  }
  return [...byKey.values()]
}

export default class ThresholdNotifier {
  /** Window states keyed by provider/label/sub-label identity. */
  private readonly states = new Map<string, WindowNotificationState>()
  /** Monotonic refresh cycle counter used to detect provider outages. */
  private cycle = 0

  /**
   * Evaluates current windows against the previous refresh baseline.
   *
   * On the first observation of a window only the baseline is captured — no
   * notifications are produced. Every subsequent observation compares the window
   * against its own retained state and emits an alert only when a high / critical
   * threshold is crossed or a genuine usage reset is confirmed.
   */
  public evaluate(
    currentWindows: UsageWindow[],
    notification: NotificationSettings,
  ): ThresholdNotification[] {
    this.cycle += 1
    const high = clampPercent(notification.high) / 100
    const critical = clampPercent(notification.critical) / 100
    const thresholdGapPercent = Math.max(0, (critical - high) * 100)
    const hysteresisPercent = Math.min(
      THRESHOLD_HYSTERESIS_PERCENT,
      Math.max(0.5, thresholdGapPercent / 2),
    )
    const highHysteresis = hysteresisPercent / 100
    const criticalHysteresis = hysteresisPercent / 100
    const notifications: ThresholdNotification[] = []

    for (const current of dedupeWindows(currentWindows)) {
      const key = windowKey(current)
      const currentPercent = clampPercent(current.usedPercent)
      const currentFraction = currentPercent / 100
      const currentResetAt = normalizeResetAt(current.resetAt)
      const state = this.states.get(key)

      if (!state) {
        this.states.set(key, {
          usedPercent: currentPercent,
          resetAt: currentResetAt,
          notifiedLevel: levelForFraction(currentFraction, high, critical),
          fullNotified: currentFraction >= 1,
          resetArmed: true,
          resetPending: false,
          lastSeenCycle: this.cycle,
        })
        continue
      }

      // A provider outage removes windows from the snapshot. Treat the first
      // successful observation after such a gap as a fresh baseline instead of
      // comparing against stale data.
      if (this.cycle - state.lastSeenCycle > 1) {
        state.usedPercent = currentPercent
        state.resetAt = currentResetAt
        state.notifiedLevel = levelForFraction(currentFraction, high, critical)
        state.fullNotified = currentFraction >= 1
        state.resetArmed = true
        state.resetPending = false
        state.lastSeenCycle = this.cycle
        continue
      }

      const previousPercent = state.usedPercent
      const previousFraction = previousPercent / 100
      const previousResetAt = parseTime(state.resetAt)
      const currentResetAtMs = parseTime(currentResetAt)
      const resetAtAdvanced =
        currentResetAtMs !== null &&
        previousResetAt !== null &&
        currentResetAtMs > previousResetAt + RESET_DEADLINE_TOLERANCE_MS
      if (resetAtAdvanced) state.resetPending = true

      const hasResetTimestamps = currentResetAtMs !== null && previousResetAt !== null
      const dropPercent = previousPercent - currentPercent
      const meaningfulDrop =
        previousPercent >= RESET_MIN_DROP_PERCENT && dropPercent >= RESET_MIN_DROP_PERCENT
      // A reset is only meaningful when the window had been used and dropped
      // back near empty. Sliding or unchanged deadlines on untouched windows
      // must stay silent, as must tiny jitter around the current percentage.
      const resetEvidence =
        meaningfulDrop &&
        currentPercent <= RESET_REARM_PERCENT &&
        (state.resetPending || !hasResetTimestamps)

      const resetDetected = currentFraction < previousFraction && state.resetArmed && resetEvidence

      if (resetDetected) {
        notifications.push({
          level: 'reset',
          message: `${current.providerName} ${windowLabel(current)} reset to ${displayPercent(currentFraction)}%`,
          window: {
            providerName: current.providerName,
            label: current.label,
            subLabel: current.subLabel ?? null,
          },
        })
        state.notifiedLevel = levelForFraction(currentFraction, high, critical)
        state.fullNotified = currentFraction >= 1
        state.resetArmed = false
        state.resetPending = false
      } else if (currentFraction >= critical) {
        if (currentFraction >= 1 && !state.fullNotified) {
          notifications.push({
            level: 'critical',
            message: `${current.providerName} ${windowLabel(current)} at 100% — limit reached!`,
            window: {
              providerName: current.providerName,
              label: current.label,
              subLabel: current.subLabel ?? null,
            },
          })
          state.notifiedLevel = 'critical'
          state.fullNotified = true
        } else if (state.notifiedLevel !== 'critical') {
          notifications.push({
            level: 'critical',
            message: `${current.providerName} ${windowLabel(current)} at ${displayPercent(currentFraction)}% — critically high!`,
            window: {
              providerName: current.providerName,
              label: current.label,
              subLabel: current.subLabel ?? null,
            },
          })
          state.notifiedLevel = 'critical'
        }
      } else if (currentFraction >= high) {
        if (state.notifiedLevel === null) {
          notifications.push({
            level: 'high',
            message: `${current.providerName} ${windowLabel(current)} at ${displayPercent(currentFraction)}% — approaching limit`,
            window: {
              providerName: current.providerName,
              label: current.label,
              subLabel: current.subLabel ?? null,
            },
          })
          state.notifiedLevel = 'high'
        } else if (
          state.notifiedLevel === 'critical' &&
          currentFraction < critical - criticalHysteresis
        ) {
          state.notifiedLevel = 'high'
          state.fullNotified = false
        }
      } else if (state.notifiedLevel === 'critical' && currentFraction >= high - highHysteresis) {
        state.notifiedLevel = 'high'
        state.fullNotified = false
      } else if (state.notifiedLevel !== null && currentFraction < high - highHysteresis) {
        state.notifiedLevel = null
        state.fullNotified = false
      }

      if (currentPercent >= RESET_REARM_PERCENT) state.resetArmed = true

      state.usedPercent = currentPercent
      state.resetAt = currentResetAt
      state.lastSeenCycle = this.cycle
    }

    this.pruneExpiredStates()
    return notifications
  }

  /** Drops all baselines so the *next* call becomes a first-observation cycle again. */
  public resetBaseline(): void {
    this.states.clear()
    this.cycle = 0
  }

  /** Removes state for windows that have not been observed for a full day. */
  private pruneExpiredStates(): void {
    for (const [key, state] of this.states) {
      if (this.cycle - state.lastSeenCycle > MAX_MISSING_CYCLES) this.states.delete(key)
    }
  }
}
