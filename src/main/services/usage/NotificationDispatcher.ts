/**
 * @file NotificationDispatcher.ts
 * @description Evaluates threshold crossings via ThresholdNotifier and dispatches
 * formatted alerts to both the native OS notification channel and every enabled
 * remote delivery channel (Telegram, Discord).
 */

import type { AppSettings, NotificationLevel, UsageWindow } from '@shared/types'
import { postJson } from './ProviderHttp'
import ThresholdNotifier from './ThresholdNotifier'
import { formatNotification } from './NotificationMessageFormatter'
import type LoggerService from '../LoggerService'

/** Notifications are emitted in severity order so the most critical appear first. */
const SEVERITY_ORDER: NotificationLevel[] = ['critical', 'high', 'reset']

export default class NotificationDispatcher {
  private readonly thresholds = new ThresholdNotifier()

  public constructor(private readonly logger: LoggerService) {}

  /** Resets the threshold notifier baseline (e.g. after a manual refresh from settings). */
  public resetBaseline(): void {
    this.thresholds.resetBaseline()
  }

  /**
   * Sends a single test notification through the native OS channel and every
   * enabled remote webhook so the user can verify their delivery configuration.
   */
  public async sendTestNotificationAsync(
    settings: AppSettings,
    emitNative: (level: NotificationLevel, message: string) => void,
  ): Promise<void> {
    const message = formatNotification('critical', 'Test: Limit reached 100%')
    emitNative('critical', message)
    await this.sendRemoteAsync(message, settings)
  }

  /**
   * Evaluates every window from the latest refresh snapshot against the stored
   * baseline. Windows seen for the first time are silently recorded; threshold
   * crossings are detected only on the second and subsequent observations.
   */
  public async emitAsync(
    windows: UsageWindow[],
    settings: AppSettings,
    emitNative: (level: NotificationLevel, message: string) => void,
  ): Promise<void> {
    const notification = settings.notification
    if (!notification.enabled) return

    const items = this.thresholds.evaluate(windows, notification)
    if (items.length === 0) return

    for (const level of SEVERITY_ORDER) {
      const lines = items.filter((item) => item.level === level).map((item) => item.message)
      if (lines.length === 0) continue

      const message = formatNotification(level, lines.join('\n'))
      this.logger.info('NotificationDispatcher', 'Usage notification dispatched.', {
        level,
        itemCount: lines.length,
      })
      emitNative(level, message)
      await this.sendRemoteAsync(message, settings)
    }
  }

  private async sendRemoteAsync(message: string, settings: AppSettings): Promise<void> {
    const tasks: Promise<void>[] = []
    const telegram = settings.notification.telegram
    if (telegram.enabled && telegram.token && telegram.chatId) {
      tasks.push(this.sendTelegramAsync(telegram.token, telegram.chatId, message))
    }
    const discord = settings.notification.discord
    if (discord.enabled && discord.webhookUrl) {
      tasks.push(this.sendDiscordAsync(discord.webhookUrl, discord.username, message))
    }
    await Promise.allSettled(tasks)
  }

  private async sendTelegramAsync(token: string, chatId: string, message: string): Promise<void> {
    try {
      const response = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: message,
      })
      if (!response.ok) {
        this.logger.warn('NotificationDispatcher', 'Telegram API returned an error.', {
          statusCode: response.status,
        })
      }
    } catch (error) {
      this.logger.warn('NotificationDispatcher', 'Failed to send Telegram notification.', error)
    }
  }

  private async sendDiscordAsync(
    webhookUrl: string,
    username: string,
    message: string,
  ): Promise<void> {
    try {
      const response = await postJson(webhookUrl, {
        content: message,
        username: username || 'Session Lens',
        avatar_url:
          'https://raw.githubusercontent.com/bariskisir/SessionLens/master/build/icon.png',
      })
      if (!response.ok) {
        this.logger.warn('NotificationDispatcher', 'Discord webhook returned an error.', {
          statusCode: response.status,
        })
      }
    } catch (error) {
      this.logger.warn('NotificationDispatcher', 'Failed to send Discord notification.', error)
    }
  }
}
