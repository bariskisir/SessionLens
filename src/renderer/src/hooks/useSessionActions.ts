/**
 * Exposes renderer commands for session workspace management.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { EarthquakeFilter } from '@shared/types'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  removeSessionSummary,
  replaceCurrentSession,
  replaceSessionSummary,
  setCurrentSession,
} from '@renderer/store/appSlice'
import { toSessionSummary } from '@renderer/utils/formatters'

const logger = createLogger('SessionActions')
let selectionRevision = 0

/** Returns stable local session management commands. */
export const useSessionActions = () => {
  const dispatch = useAppDispatch()
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSessionId = useAppSelector((state) => state.app.currentSession?.id ?? null)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Loads a complete session from local storage. */
  const openSession = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const session = await window.app.getSession(id)
        if (revision === selectionRevision) dispatch(setCurrentSession(session))
      } catch (error) {
        if (revision !== selectionRevision) return
        logger.error('Session could not be loaded.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, t],
  )

  /** Clears the active workspace selection and invalidates pending loads. */
  const clearSession = useCallback((): void => {
    selectionRevision += 1
    dispatch(setCurrentSession(null))
  }, [dispatch])

  /** Renames a session and synchronizes the active document and summary. */
  const renameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const session = await window.app.renameSession(id, title)
        dispatch(replaceCurrentSession(session))
        dispatch(replaceSessionSummary(toSessionSummary(session)))
        return true
      } catch (error) {
        logger.error('Session could not be renamed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Deletes one session and selects the next available workspace when needed. */
  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const result = await window.app.deleteSession(id)
        if (!result.deleted) return
        dispatch(removeSessionSummary(id))
        const remaining = sessions.filter((item) => item.id !== id)

        if (currentSessionId !== id) return
        const nextSession = remaining[0] ? await window.app.getSession(remaining[0].id) : null
        if (revision === selectionRevision) dispatch(setCurrentSession(nextSession))
      } catch (error) {
        logger.error('Session could not be deleted.', error)
        void message.error(t('errors.generic'))
      }
    },
    [currentSessionId, dispatch, sessions, message, t],
  )

  /** Deletes sessions in one magnitude filter and clears the selection when it was removed. */
  const deleteAllSessions = useCallback(
    async (filter: EarthquakeFilter): Promise<boolean> => {
      const revision = ++selectionRevision
      try {
        const deletedIds = await window.app.deleteAllSessions(filter)
        deletedIds.forEach((id) => {
          dispatch(removeSessionSummary(id))
        })
        if (
          currentSessionId !== null &&
          deletedIds.includes(currentSessionId) &&
          revision === selectionRevision
        ) {
          dispatch(setCurrentSession(null))
        }
        return true
      } catch (error) {
        logger.error('Sessions could not be deleted.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [currentSessionId, dispatch, message, t],
  )

  return { clearSession, deleteAllSessions, deleteSession, openSession, renameSession }
}
