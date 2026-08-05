/**
 * @file TooltipSettingsSection.tsx
 * @description Renders the system tray tooltip UI scale slider and zoom control settings.
 */

import { Button, Tooltip } from 'antd'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { VISUAL_SCALE_LIMITS } from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/**
 * Displays the system tray tooltip scale controls and zoom buttons.
 *
 * @returns JSX Element for TooltipSettings section
 */
const TooltipSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  /**
   * Adjusts tooltip scale: 10-step between 50–150, 50-step above 150.
   *
   * @param delta - Delta amount (+50 or -50)
   */
  const changeTooltipScale = (delta: number): void => {
    const direction = delta > 0 ? 1 : -1
    const current = settings.visual.scale
    const step = direction > 0 ? (current < 150 ? 10 : 50) : (current <= 150 ? 10 : 50)
    const scale = Math.min(
      VISUAL_SCALE_LIMITS.max,
      Math.max(VISUAL_SCALE_LIMITS.min, current + direction * step),
    )
    void settingsActions.saveSettings({ visual: { ...settings.visual, scale } })
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.tooltip')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('icon.tooltipScale')}
            description={t('icon.tooltipScaleDescription')}
          />
          <div className={styles.zoomControl}>
            <Tooltip title={t('settings.zoomOut')}>
              <Button
                type="text"
                aria-label={t('settings.zoomOut')}
                disabled={settings.visual.scale <= VISUAL_SCALE_LIMITS.min}
                icon={<Minus size={15} />}
                onClick={() => changeTooltipScale(-50)}
              />
            </Tooltip>
            <span className={styles.zoomValue}>{settings.visual.scale}%</span>
            <Tooltip title={t('settings.zoomIn')}>
              <Button
                type="text"
                aria-label={t('settings.zoomIn')}
                disabled={settings.visual.scale >= VISUAL_SCALE_LIMITS.max}
                icon={<Plus size={15} />}
                onClick={() => changeTooltipScale(50)}
              />
            </Tooltip>
            <Tooltip title={t('settings.resetZoom')}>
              <Button
                type="text"
                aria-label={t('settings.resetZoom')}
                disabled={settings.visual.scale === VISUAL_SCALE_LIMITS.default}
                icon={<RotateCcw size={15} />}
                onClick={() =>
                  void settingsActions.saveSettings({
                    visual: { ...settings.visual, scale: VISUAL_SCALE_LIMITS.default },
                  })
                }
              />
            </Tooltip>
          </div>
        </div>
      </section>
    </div>
  )
}

export default TooltipSettingsSection

