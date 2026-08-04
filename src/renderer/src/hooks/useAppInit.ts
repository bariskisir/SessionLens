/**
 * Bootstraps renderer state and binds main-to-renderer lifecycle events.
 */

import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import { hydrate, setSettingsSection, setUpdateState } from '@renderer/store/appSlice'
import { useAppDispatch } from '@renderer/store'

const logger = createLogger('AppInit')

/** Loads persisted state and maintains typed IPC subscriptions for the app lifetime. */
export const useAppInit = (): void => {
  const dispatch = useAppDispatch()
  const { message } = AntdApp.useApp()
  const messageRef = useRef(message)

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    let active = true
    const cleanup = [
      window.app.onUpdateState((event) => dispatch(setUpdateState(event))),
      window.app.onSettingsOpenRequested(() => dispatch(setSettingsSection('general'))),
    ]

    void window.app
      .bootstrap()
      .then(async (payload) => {
        if (!active) return
        dispatch(hydrate(payload))
        document.documentElement.lang = payload.settings.uiLanguage
        await i18n.changeLanguage(payload.settings.uiLanguage)
      })
      .catch((error) => {
        logger.error('Renderer bootstrap failed.', error)
        void messageRef.current.error(i18n.t('errors.generic'))
      })

    return () => {
      active = false
      cleanup.forEach((unsubscribe) => {
        unsubscribe()
      })
    }
  }, [dispatch])
}
