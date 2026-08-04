/**
 * Renders the draggable desktop title bar and workspace controls.
 */

import { Button, Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import logoUrl from '../../../../../build/icon.svg'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { AppSettingsPatch } from '@shared/types'
import { setPage, setSessionsSidebarOpen } from '@renderer/store/appSlice'
import AppNavigationActions from './AppNavigationActions'
import WindowControls from './WindowControls'
import styles from './Titlebar.module.scss'

interface TitlebarProps {
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
}

/** Places primary navigation and session-sidebar controls in the title bar. */
const Titlebar = ({ onSettingsChange }: TitlebarProps): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const page = useAppSelector((state) => state.app.page)
  const sidebarOpen = useAppSelector((state) => state.app.sessionsSidebarOpen)
  const navbarPosition = useAppSelector((state) => state.app.settings.navbarPosition)
  const platform = useAppSelector((state) => state.app.platform)
  const earthquakeStatus = useAppSelector((state) => state.app.earthquakeStatus)
  const { t } = useTranslation()

  return (
    <header
      className={`${styles.container} ${platform === 'darwin' ? styles.nativeWindowControls : ''} drag-region`}
    >
      <div className={`${styles.topActions} no-drag`}>
        <Button
          className={styles.titleButton ?? ''}
          type="text"
          aria-label={t('app.name')}
          icon={<img className={styles.titleLogo} src={logoUrl} alt="" />}
          onClick={() => dispatch(setPage('home'))}
        />
        {page === 'home' && (
          <Tooltip
            placement="bottom"
            title={t(sidebarOpen ? 'sidebar.hideSidebar' : 'sidebar.showSidebar')}
          >
            <Button
              className={styles.titleButton ?? ''}
              type="text"
              icon={sidebarOpen ? <PanelLeftClose size={18} /> : <PanelRightClose size={18} />}
              onClick={() => dispatch(setSessionsSidebarOpen(!sidebarOpen))}
            />
          </Tooltip>
        )}
      </div>
      <div
        className={`${styles.fcmIndicator} ${
          earthquakeStatus.state === 'connected' && earthquakeStatus.subscribedTopics.length === 2
            ? styles.fcmConnected
            : earthquakeStatus.state === 'error'
              ? styles.fcmError
              : styles.fcmPending
        }`}
      >
        <Radio size={12} />
        <span className={styles.fcmState}>{t(`earthquake.states.${earthquakeStatus.state}`)}</span>
        <span className={styles.fcmChannels}>
          {earthquakeStatus.topics.map((topic) => (
            <span
              className={
                earthquakeStatus.subscribedTopics.includes(topic)
                  ? styles.channelConnected
                  : styles.channelDisconnected
              }
              key={topic}
            >
              {topic}
            </span>
          ))}
        </span>
      </div>
      <div className={styles.rightActions}>
        {navbarPosition === 'top' && (
          <AppNavigationActions placement="top" onSettingsChange={onSettingsChange} />
        )}
        <WindowControls />
      </div>
    </header>
  )
}

export default Titlebar
