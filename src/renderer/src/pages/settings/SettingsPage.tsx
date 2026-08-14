/**
 * @file SettingsPage.tsx
 * @description Renders the application settings shell, side navigation menu, and dynamic settings category sections.
 */

import {
  Activity,
  Bell,
  Bot,
  Inbox,
  Info,
  MessageSquare,
  Monitor,
  Palette,
  RefreshCw,
  ScrollText,
  Server,
  Settings2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSettingsSection, type SettingsSection } from '@renderer/store/appSlice'
import AboutSettingsSection from './sections/AboutSettingsSection'
import GeneralSettingsSection from './sections/GeneralSettingsSection'
import DisplaySettingsSection from './sections/DisplaySettingsSection'
import DefaultModelsSettingsSection from './sections/DefaultModelsSettingsSection'
import TooltipSettingsSection from './sections/TooltipSettingsSection'
import IconSettingsSection from './sections/IconSettingsSection'
import LoggingSettingsSection from './sections/LoggingSettingsSection'
import NotificationsSettingsSection from './sections/NotificationsSettingsSection'
import ProvidersSettingsSection from './sections/ProvidersSettingsSection'
import TelemetrySettingsSection from './sections/TelemetrySettingsSection'
import TraySettingsSection from './sections/TraySettingsSection'
import UpdatesSettingsSection from './sections/UpdatesSettingsSection'
import styles from './SettingsPage.module.scss'

/**
 * Renders settings category navigation sidebar and active settings section body.
 *
 * @returns JSX Element for Settings page
 */
const SettingsPage = (): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const section = useAppSelector((state) => state.app.settingsSection)
  const { t } = useTranslation()
  const menu: Array<{
    key: SettingsSection
    label: string
    icon: React.JSX.Element
  }> = [
    { key: 'general', label: t('settings.general'), icon: <Settings2 size={17} /> },
    { key: 'display', label: t('settings.display'), icon: <Monitor size={17} /> },
    { key: 'tray', label: t('settings.tray'), icon: <Inbox size={17} /> },
    { key: 'providers', label: t('settings.providers'), icon: <Server size={17} /> },
    { key: 'notifications', label: t('settings.notifications'), icon: <Bell size={17} /> },
    { key: 'tooltip', label: t('settings.tooltip'), icon: <MessageSquare size={17} /> },
    { key: 'icon', label: t('settings.icon'), icon: <Palette size={17} /> },
    { key: 'defaultModels', label: t('settings.defaultModels'), icon: <Bot size={17} /> },
    { key: 'updates', label: t('settings.updates'), icon: <RefreshCw size={17} /> },
    { key: 'telemetry', label: t('settings.telemetry'), icon: <Activity size={17} /> },
    { key: 'logging', label: t('settings.logging'), icon: <ScrollText size={17} /> },
    { key: 'about', label: t('settings.about'), icon: <Info size={17} /> },
  ]

  const sectionComponents: Record<SettingsSection, React.ComponentType> = {
    general: GeneralSettingsSection,
    display: DisplaySettingsSection,
    tray: TraySettingsSection,
    providers: ProvidersSettingsSection,
    notifications: NotificationsSettingsSection,
    tooltip: TooltipSettingsSection,
    icon: IconSettingsSection,
    defaultModels: DefaultModelsSettingsSection,
    updates: UpdatesSettingsSection,
    telemetry: TelemetrySettingsSection,
    logging: LoggingSettingsSection,
    about: AboutSettingsSection,
  }

  const SectionComponent = sectionComponents[section] ?? GeneralSettingsSection

  return (
    <main className={styles.shell}>
      <aside className={styles.menu}>
        <div className={styles.menuTitle}>{t('settings.title')}</div>
        {menu.map((item) => (
          <button
            type="button"
            className={`${styles.menuItem} ${section === item.key ? styles.active : ''}`}
            key={item.key}
            onClick={() => dispatch(setSettingsSection(item.key))}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </aside>
      <SectionComponent />
    </main>
  )
}

export default SettingsPage
