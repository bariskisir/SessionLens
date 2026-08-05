/**
 * @file SettingsPage.tsx
 * @description Renders the application settings shell, side navigation menu, and dynamic settings category sections.
 */

import {
  Bell,
  Bot,
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
    { key: 'providers', label: t('settings.providers'), icon: <Server size={17} /> },
    { key: 'notifications', label: t('settings.notifications'), icon: <Bell size={17} /> },
    { key: 'tooltip', label: t('settings.tooltip'), icon: <MessageSquare size={17} /> },
    { key: 'icon', label: t('settings.icon'), icon: <Palette size={17} /> },
    { key: 'defaultModels', label: t('settings.defaultModels'), icon: <Bot size={17} /> },
    { key: 'updates', label: t('settings.updates'), icon: <RefreshCw size={17} /> },
    { key: 'logging', label: t('settings.logging'), icon: <ScrollText size={17} /> },
    { key: 'about', label: t('settings.about'), icon: <Info size={17} /> },
  ]

  /**
   * Resolves the active category component without keeping inactive forms mounted.
   *
   * @returns JSX Element of the active section
   */
  const renderSection = (): React.JSX.Element => {
    if (section === 'display') return <DisplaySettingsSection />
    if (section === 'tooltip') return <TooltipSettingsSection />
    if (section === 'icon') return <IconSettingsSection />
    if (section === 'defaultModels') return <DefaultModelsSettingsSection />
    if (section === 'providers') return <ProvidersSettingsSection />
    if (section === 'notifications') return <NotificationsSettingsSection />
    if (section === 'updates') return <UpdatesSettingsSection />
    if (section === 'logging') return <LoggingSettingsSection />
    if (section === 'about') return <AboutSettingsSection />
    return <GeneralSettingsSection />
  }

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
      {renderSection()}
    </main>
  )
}

export default SettingsPage

