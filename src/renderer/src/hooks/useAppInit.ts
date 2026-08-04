/**
 * Bootstraps renderer state and binds main-to-renderer lifecycle events.
 */

import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import { playEarthquakeAlarm, stopEarthquakeAlarm } from '@renderer/services/EarthquakeAlarmService'
import {
  hydrate,
  replaceCurrentSession,
  replaceSessionSummary,
  setCurrentSession,
  setEarthquakeStatus,
  setFullscreenEarthquake,
  setPage,
  setSessionsSidebarOpen,
  setUpdateState,
} from '@renderer/store/appSlice'
import { useAppDispatch } from '@renderer/store'
import { toSessionSummary } from '@renderer/utils/formatters'

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
      window.app.onSettingsOpenRequested(() => dispatch(setPage('settings'))),
      window.app.onEarthquakeStatus((status) => dispatch(setEarthquakeStatus(status))),
      window.app.onEarthquakeReceived((event) => {
        dispatch(replaceSessionSummary(toSessionSummary(event.session)))
        dispatch(replaceCurrentSession(event.session))
        if (event.presentation === 'fullscreen') {
          dispatch(setFullscreenEarthquake(event.session))
        }
        if (event.shouldAlarm) {
          void playEarthquakeAlarm(event.presentation === 'fullscreen').catch((error: unknown) => {
            logger.warn('Realtime earthquake alarm could not be played.', error)
          })
        }
      }),
      window.app.onEarthquakeNotificationOpened((event) => {
        dispatch(setPage('home'))
        dispatch(setSessionsSidebarOpen(true))
        void window.app
          .getSession(event.sessionId)
          .then((session) => dispatch(setCurrentSession(session)))
          .catch((error: unknown) => {
            logger.warn('Clicked earthquake session could not be opened.', error)
          })
      }),
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
      stopEarthquakeAlarm()
    }
  }, [dispatch])
}
