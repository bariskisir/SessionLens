/**
 * Manages saved sessions in the collapsible workspace sidebar.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Tooltip, type MenuProps } from 'antd'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { filterSessionsByMagnitude } from '@shared/earthquakeFilters'
import type { EarthquakeFilter, SessionSummary } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSessionActions } from '@renderer/hooks/useSessionActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setEarthquakeFilter } from '@renderer/store/appSlice'
import { formatDate } from '@renderer/utils/formatters'
import styles from './SessionsSidebar.module.scss'

const FILTER_OPTIONS: EarthquakeFilter[] = ['all', '3', '4', '5']

/** Renders open, rename, delete, and collapse actions for server-provided sessions. */
const SessionsSidebar = (): React.JSX.Element => {
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSession = useAppSelector((state) => state.app.currentSession)
  const earthquakeFilter = useAppSelector((state) => state.app.earthquakeFilter)
  const timeFormat = useAppSelector((state) => state.app.settings.timeFormat)
  const sidebarOpen = useAppSelector((state) => state.app.sessionsSidebarOpen)
  const fullscreenActive = useAppSelector((state) => state.app.fullscreenEarthquake !== null)
  const actions = useSessionActions()
  const { clearSession, openSession } = actions
  const settingsActions = useSettingsActions()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredSessions = useMemo(
    () => filterSessionsByMagnitude(sessions, earthquakeFilter),
    [sessions, earthquakeFilter],
  )

  /** Applies a magnitude filter and opens its unselected multi-earthquake map. */
  const applyFilter = (option: EarthquakeFilter): void => {
    clearSession()
    if (option === earthquakeFilter) return
    dispatch(setEarthquakeFilter(option))
    void settingsActions.saveSettings({ earthquakeFilter: option })
  }

  useEffect(() => {
    if (fullscreenActive) return
    /** Moves the selection to the previous or next earthquake in the active filter. */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (filteredSessions.length === 0) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"], .ant-modal, .ant-dropdown')
      ) {
        return
      }
      event.preventDefault()
      const currentIndex = currentSession
        ? filteredSessions.findIndex((item) => item.id === currentSession.id)
        : -1
      const nextIndex =
        event.key === 'ArrowDown'
          ? (currentIndex + 1) % filteredSessions.length
          : (currentIndex - 1 + filteredSessions.length) % filteredSessions.length
      const item = filteredSessions[nextIndex]
      if (item) void openSession(item.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredSessions, currentSession, fullscreenActive, openSession])

  useEffect(() => {
    if (!currentSession) return
    listRef.current?.querySelector(`.${styles.active}`)?.scrollIntoView({ block: 'nearest' })
  }, [currentSession])

  /** Resolves a generated title from the active interface locale while preserving custom names. */
  const displayTitle = (item: SessionSummary): string =>
    item.isDefaultTitle ? t('sessions.newSession') : item.title

  /** Opens the rename dialog with the selected session's current title. */
  const beginRename = (item: SessionSummary): void => {
    setRenameTarget(item)
    setRenameValue(displayTitle(item))
  }

  /** Persists the edited title and closes the dialog after a successful update. */
  const commitRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    const renamed = await actions.renameSession(renameTarget.id, renameValue.trim())
    setRenaming(false)
    if (renamed) setRenameTarget(null)
  }

  /** Deletes the local session records visible under the active magnitude filter. */
  const deleteAllSessions = async (): Promise<void> => {
    if (deletingAll) return
    setDeletingAll(true)
    try {
      await actions.deleteAllSessions(earthquakeFilter)
    } finally {
      setDeletingAll(false)
    }
  }

  /** Builds the right-click context menu for a single session row. */
  const sessionMenu = (item: SessionSummary): MenuProps => ({
    items: [
      { key: 'rename', icon: <Pencil size={14} />, label: t('common.rename') },
      { type: 'divider' },
      {
        key: 'delete',
        danger: true,
        icon: <Trash2 size={14} />,
        label: t('common.delete'),
        disabled: deletingAll,
      },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'rename') beginRename(item)
      if (key === 'delete') void actions.deleteSession(item.id)
    },
  })

  return (
    <>
      <aside
        className={`${styles.container} ${sidebarOpen ? '' : styles.collapsed}`}
        aria-hidden={!sidebarOpen}
      >
        {sidebarOpen && (
          <>
            <header className={styles.header}>
              <div className={styles.filterGroup}>
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${styles.filterButton} ${earthquakeFilter === option ? styles.filterActive : ''}`}
                    onClick={() => applyFilter(option)}
                  >
                    {option === 'all' ? t('sessions.all') : `${option}+`}
                  </button>
                ))}
              </div>
              <div className={styles.headerActions}>
                <Button
                  type="text"
                  danger
                  size="small"
                  aria-label={t('sessions.deleteAll')}
                  icon={<Trash2 size={15} />}
                  disabled={deletingAll || filteredSessions.length === 0}
                  onClick={() => void deleteAllSessions()}
                />
              </div>
            </header>

            <div
              className={styles.scrollArea}
              ref={listRef}
              role="listbox"
              aria-label={t('nav.sessions')}
            >
              {filteredSessions.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('sessions.emptyTitle')}
                  />
                </div>
              ) : (
                <div className={styles.list}>
                  {filteredSessions.map((item) => (
                    <Dropdown
                      key={item.id}
                      menu={sessionMenu(item)}
                      trigger={['contextMenu']}
                      disabled={deletingAll}
                    >
                      <div
                        role="option"
                        aria-selected={currentSession?.id === item.id}
                        tabIndex={-1}
                        className={`${styles.item} ${currentSession?.id === item.id ? styles.active : ''}`}
                      >
                        <button
                          type="button"
                          className={styles.openButton}
                          onClick={() => void openSession(item.id)}
                        >
                          <span className={styles.fileIcon}>
                            <FileText size={14} />
                          </span>
                          <span className={styles.itemBody}>
                            <span className={styles.itemTitle}>{displayTitle(item)}</span>
                            <span className={styles.itemMeta}>
                              {formatDate(item.createdAt, timeFormat)}
                            </span>
                          </span>
                        </button>
                        <Tooltip title={t('common.delete')}>
                          <Button
                            className={styles.deleteButton ?? ''}
                            type="text"
                            danger
                            size="small"
                            disabled={deletingAll}
                            icon={<Trash2 size={13} />}
                            onClick={() => void actions.deleteSession(item.id)}
                          />
                        </Tooltip>
                      </div>
                    </Dropdown>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
      <Modal
        title={t('sessions.renameSession')}
        open={renameTarget !== null}
        okText={t('common.rename')}
        cancelText={t('common.cancel')}
        confirmLoading={renaming}
        okButtonProps={{
          disabled: !renameValue.trim(),
          ...(light ? { ghost: true as const } : {}),
        }}
        onOk={() => void commitRename()}
        onCancel={() => setRenameTarget(null)}
        destroyOnHidden
      >
        <Input
          className={styles.renameInput}
          value={renameValue}
          maxLength={200}
          autoFocus
          placeholder={t('sessions.renameSession')}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void commitRename()}
        />
      </Modal>
    </>
  )
}

export default SessionsSidebar
