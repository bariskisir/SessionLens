/**
 * @file NotificationMessageFormatter.ts
 * @description Prepends a severity-level emoji to notification messages, matching the
 * UsageBar convention so that tray balloons and remote channel messages carry a visual
 * indicator of the notification level.
 */

import type { NotificationLevel } from '@shared/types'

const EMOJI_PREFIX: Record<NotificationLevel, string> = {
  critical: '\u26A0\uFE0F ',
  high: '\u26A1 ',
  reset: '\u2705 ',
}

export const formatNotification = (level: NotificationLevel, raw: string): string =>
  `${EMOJI_PREFIX[level]}${raw}`
