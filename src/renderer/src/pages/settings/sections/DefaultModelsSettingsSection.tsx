/**
 * @file DefaultModelsSettingsSection.tsx
 * @description Renders model preference settings used for configuring model selection in warm-window requests.
 */

import { Input } from 'antd'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SMALL_MODEL_SELECTOR } from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/**
 * Displays the small model selector used by warm-window requests.
 *
 * @returns JSX Element for DefaultModelsSettings section
 */
const DefaultModelsSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.defaultModels')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.smallModelSelector')}
            description={t('settings.smallModelSelectorDescription')}
          />
          <div className={styles.settingControl}>
            <Input
              className={styles.modelSelectorInput}
              value={settings.models.smallModelSelector}
              placeholder={DEFAULT_SMALL_MODEL_SELECTOR}
              onChange={(event) => {
                void settingsActions.saveSettings({
                  models: { smallModelSelector: event.target.value },
                })
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default DefaultModelsSettingsSection

