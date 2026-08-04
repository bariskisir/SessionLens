/**
 * Exposes renderer commands for persisted application settings.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AppSettingsPatch } from '@shared/types'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import SettingsPersistenceQueue from '@renderer/services/SettingsPersistenceQueue'
import { useAppDispatch } from '@renderer/store'
import { setSettings } from '@renderer/store/appSlice'

const logger = createLogger('SettingsActions')
const settingsPersistenceQueue = new SettingsPersistenceQueue()

/** Returns stable settings commands backed by the preload API. */
export const useSettingsActions = () => {
  const dispatch = useAppDispatch()
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Serializes a partial settings update so rapid controls cannot overwrite each other. */
  const saveSettingsWithResult = useCallback(
    async (patch: AppSettingsPatch): Promise<boolean> => {
      try {
        const saved = await settingsPersistenceQueue.enqueue(patch, window.app.saveSettings)
        dispatch(setSettings(saved))
        document.documentElement.lang = saved.uiLanguage
        await i18n.changeLanguage(saved.uiLanguage)
        return true
      } catch (error) {
        logger.error('Settings could not be saved.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Persists settings for controls that do not need to branch on the result. */
  const saveSettings = useCallback(
    async (patch: AppSettingsPatch): Promise<void> => {
      await saveSettingsWithResult(patch)
    },
    [saveSettingsWithResult],
  )

  return { saveSettings, saveSettingsWithResult }
}
