/**
 * @file ThresholdNotifier.ts
 * @description Compares per-window usage between refreshes and emits threshold-crossing
 * and usage-reset notifications. Skips evaluation on first observation so that a fresh
 * launch never fires spurious alerts — genuine baselines require two consecutive cycles.
 */

import type { NotificationSettings, NotificationLevel, UsageWindow } from '@shared/types'

export interface ThresholdNotification {
  level: NotificationLevel
  message: string
}

const windowLabel = (window: UsageWindow): string =>
  window.subLabel ? `${window.label} (${window.subLabel})` : window.label

const displayPercent = (fraction: number): number => Math.round(fraction * 100)

const findWindow = (
  windows: UsageWindow[],
  provider: string,
  label: string,
  subLabel: string | null | undefined,
): UsageWindow | undefined =>
  windows.find(
    (window) =>
      window.providerName === provider &&
      window.label === label &&
      window.subLabel === subLabel,
  )

const cloneWindows = (windows: UsageWindow[]): UsageWindow[] =>
  windows.map((window) => ({ ...window }))

export default class ThresholdNotifier {
  /** Whether the notifier has captured at least one reference snapshot. */
  private hasBaseline = false

  /** Deep-copied windows from the most recently evaluated refresh cycle. */
  private previousWindows: UsageWindow[] = []

  /**
   * Evaluates current windows against the previous refresh baseline.
   *
   * On the very first call only the baseline is captured — no notifications are
   * produced. Every subsequent call compares each window against its previously
   * recorded counterpart and emits alerts when a high / critical threshold or a
   * genuine usage reset is detected.
   */
  public evaluate(
    currentWindows: UsageWindow[],
    notification: NotificationSettings,
  ): ThresholdNotification[] {
    if (!this.hasBaseline) {
      this.previousWindows = cloneWindows(currentWindows)
      this.hasBaseline = true
      return []
    }

    const high = notification.high / 100
    const critical = notification.critical / 100
    const notifications: ThresholdNotification[] = []

    for (const current of currentWindows) {
      const previous = findWindow(
        this.previousWindows,
        current.providerName,
        current.label,
        current.subLabel,
      )
      if (!previous) continue

      const currentFraction = current.usedPercent / 100
      const previousFraction = previous.usedPercent / 100
      const label = windowLabel(current)

      if (currentFraction < previousFraction) {
        const resetTimestampAdvanced =
          current.resetAt != null &&
          previous.resetAt != null &&
          new Date(current.resetAt).getTime() > new Date(previous.resetAt).getTime()
        if (currentFraction <= 0.05 || resetTimestampAdvanced) {
          notifications.push({
            level: 'reset',
            message: `${current.providerName} ${label} reset to ${displayPercent(currentFraction)}%`,
          })
        }
        continue
      }

      if (previousFraction < 1 && currentFraction >= 1) {
        notifications.push({
          level: 'critical',
          message: `${current.providerName} ${label} at 100% — limit reached!`,
        })
      } else if (previousFraction < critical && currentFraction >= critical) {
        notifications.push({
          level: 'critical',
          message: `${current.providerName} ${label} at ${displayPercent(currentFraction)}% — critically high!`,
        })
      } else if (previousFraction < high && currentFraction >= high) {
        notifications.push({
          level: 'high',
          message: `${current.providerName} ${label} at ${displayPercent(currentFraction)}% — approaching limit`,
        })
      }
    }

    this.previousWindows = cloneWindows(currentWindows)
    return notifications
  }

  /** Drops the baseline so the *next* call becomes a first-observation cycle again. */
  public resetBaseline(): void {
    this.hasBaseline = false
    this.previousWindows = []
  }
}
