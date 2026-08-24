/**
 * Renders system tray and startup visibility preferences.
 */

import { Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays tray icon and startup minimization controls. */
const TraySettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  /** Keeps close-to-tray and minimized startup disabled whenever the tray icon is removed. */
  const changeTrayIcon = (showTrayIcon: boolean): void => {
    void settingsActions.saveSettings({
      showTrayIcon,
      ...(showTrayIcon ? {} : { minimizeToTrayOnClose: false, startMinimized: false }),
    })
  }

  /** Enables the required tray icon when close-to-tray is selected. */
  const changeMinimizeToTray = (minimizeToTrayOnClose: boolean): void => {
    void settingsActions.saveSettings({
      minimizeToTrayOnClose,
      ...(minimizeToTrayOnClose ? { showTrayIcon: true } : {}),
    })
  }

  /** Enables the required tray icon when minimized startup is selected. */
  const changeStartMinimized = (startMinimized: boolean): void => {
    void settingsActions.saveSettings({
      startMinimized,
      ...(startMinimized ? { showTrayIcon: true } : {}),
    })
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.traySettings')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.showTrayIcon')}
            description={t('settings.showTrayIconDescription')}
          />
          <div className={styles.settingControl}>
            <Switch checked={settings.showTrayIcon} onChange={changeTrayIcon} />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.minimizeToTrayOnClose')}
            description={t('settings.minimizeToTrayOnCloseDescription')}
          />
          <div className={styles.settingControl}>
            <Switch checked={settings.minimizeToTrayOnClose} onChange={changeMinimizeToTray} />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.startMinimized')}
            description={t('settings.startMinimizedDescription')}
          />
          <div className={styles.settingControl}>
            <Switch checked={settings.startMinimized} onChange={changeStartMinimized} />
          </div>
        </div>
      </section>
    </div>
  )
}

export default TraySettingsSection
