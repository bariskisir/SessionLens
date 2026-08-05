/**
 * @file NotificationsSettingsSection.tsx
 * @description Renders threshold notification preferences and remote integration settings for Telegram and Discord webhooks.
 */

import { Button, Input, InputNumber, Switch } from 'antd'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DiscordSettings, TelegramSettings } from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import { createLogger } from '@renderer/services/LoggerService'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Logger for NotificationsSettings UI component. */
const logger = createLogger('NotificationsSettings')

/**
 * Displays threshold notification preferences and remote delivery channel controls.
 *
 * @returns JSX Element for NotificationsSettings section
 */
const NotificationsSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()
  const telegramEnabled = settings.notification.telegram.enabled
  const discordEnabled = settings.notification.discord.enabled

  /**
   * Updates and saves Telegram settings.
   *
   * @param telegram - Updated TelegramSettings object
   */
  const saveTelegram = (telegram: TelegramSettings): void => {
    void settingsActions.saveSettings({
      notification: { ...settings.notification, telegram },
    })
  }

  /**
   * Updates and saves Discord settings.
   *
   * @param discord - Updated DiscordSettings object
   */
  const saveDiscord = (discord: DiscordSettings): void => {
    void settingsActions.saveSettings({
      notification: { ...settings.notification, discord },
    })
  }

  /**
   * Dispatches a test notification request to main process via IPC.
   */
  const sendTestNotification = async (): Promise<void> => {
    try {
      await window.app.sendTestNotification()
    } catch (error) {
      logger.error('Test notification could not be sent.', error)
    }
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.notifications')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.enabled')}
            description={t('notifications.enabledDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.notification.enabled}
              onChange={(enabled) =>
                void settingsActions.saveSettings({
                  notification: { ...settings.notification, enabled },
                })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.refreshInterval')}
            description={t('notifications.refreshIntervalDescription')}
          />
          <div className={styles.settingControl}>
            <InputNumber
              className={styles.durationInput ?? ''}
              min={1}
              max={1440}
              value={settings.refresh.minute}
              onChange={(minute) => {
                if (minute !== null) {
                  void settingsActions.saveSettings({ refresh: { minute } })
                }
              }}
            />
            <span className={styles.durationUnit}>{t('notifications.minutes')}</span>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.highThreshold')}
            description={t('notifications.highThresholdDescription')}
          />
          <div className={styles.settingControl}>
            <InputNumber
              className={styles.durationInput ?? ''}
              min={1}
              max={100}
              value={settings.notification.high}
              onChange={(high) => {
                if (high !== null) {
                  void settingsActions.saveSettings({
                    notification: { ...settings.notification, high },
                  })
                }
              }}
            />
            <span className={styles.durationUnit}>%</span>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.criticalThreshold')}
            description={t('notifications.criticalThresholdDescription')}
          />
          <div className={styles.settingControl}>
            <InputNumber
              className={styles.durationInput ?? ''}
              min={1}
              max={100}
              value={settings.notification.critical}
              onChange={(critical) => {
                if (critical !== null) {
                  void settingsActions.saveSettings({
                    notification: { ...settings.notification, critical },
                  })
                }
              }}
            />
            <span className={styles.durationUnit}>%</span>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.test')}
            description={t('notifications.testDescription')}
          />
          <div className={styles.settingControl}>
            <Button icon={<Send size={14} />} onClick={() => void sendTestNotification()}>
              {t('notifications.testButton')}
            </Button>
          </div>
        </div>
      </section>

      <h2 className={styles.groupTitle}>{t('settings.remoteChannels')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.telegram.enabled')}
            description={t('notifications.telegram.enabledDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.notification.telegram.enabled}
              onChange={(enabled) => saveTelegram({ ...settings.notification.telegram, enabled })}
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.telegram.token')}
            description={t('notifications.telegram.tokenDescription')}
          />
          <div className={styles.settingControl}>
            <Input.Password
              className={styles.wideControl ?? ''}
              disabled={!telegramEnabled}
              autoComplete="new-password"
              placeholder={t('notifications.telegram.token')}
              value={settings.notification.telegram.token ?? ''}
              onChange={(event) =>
                saveTelegram({
                  ...settings.notification.telegram,
                  token: event.target.value || null,
                })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.telegram.chatId')}
            description={t('notifications.telegram.chatIdDescription')}
          />
          <div className={styles.settingControl}>
            <Input
              className={styles.compactControl ?? ''}
              disabled={!telegramEnabled}
              value={settings.notification.telegram.chatId}
              onChange={(event) =>
                saveTelegram({ ...settings.notification.telegram, chatId: event.target.value })
              }
            />
          </div>
        </div>
      </section>

      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.discord.enabled')}
            description={t('notifications.discord.enabledDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.notification.discord.enabled}
              onChange={(enabled) => saveDiscord({ ...settings.notification.discord, enabled })}
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.discord.webhookUrl')}
            description={t('notifications.discord.webhookUrlDescription')}
          />
          <div className={styles.settingControl}>
            <Input.Password
              className={styles.wideControl ?? ''}
              disabled={!discordEnabled}
              autoComplete="new-password"
              placeholder={t('notifications.discord.webhookUrl')}
              value={settings.notification.discord.webhookUrl ?? ''}
              onChange={(event) =>
                saveDiscord({
                  ...settings.notification.discord,
                  webhookUrl: event.target.value || null,
                })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('notifications.discord.username')}
            description={t('notifications.discord.usernameDescription')}
          />
          <div className={styles.settingControl}>
            <Input
              className={styles.compactControl ?? ''}
              disabled={!discordEnabled}
              value={settings.notification.discord.username}
              onChange={(event) =>
                saveDiscord({ ...settings.notification.discord, username: event.target.value })
              }
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default NotificationsSettingsSection
