/**
 * Renders the draggable desktop title bar and workspace controls.
 */

import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import logoUrl from '../../../../../build/icon.svg'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { AppSettingsPatch } from '@shared/types'
import { setSettingsSection } from '@renderer/store/appSlice'
import AppNavigationActions from './AppNavigationActions'
import WindowControls from './WindowControls'
import styles from './Titlebar.module.scss'

interface TitlebarProps {
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
}

/** Places primary navigation and window controls in the title bar. */
const Titlebar = ({ onSettingsChange }: TitlebarProps): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const navbarPosition = useAppSelector((state) => state.app.settings.navbarPosition)
  const platform = useAppSelector((state) => state.app.platform)
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
          onClick={() => dispatch(setSettingsSection('general'))}
        />
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
