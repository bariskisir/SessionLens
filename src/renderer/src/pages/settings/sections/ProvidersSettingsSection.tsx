/**
 * @file ProvidersSettingsSection.tsx
 * @description Renders provider configuration controls and draggable list for customizing provider display order and API keys.
 */

import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { App, Input, Switch, Tooltip } from 'antd'
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PROVIDER_DESCRIPTORS, type ProviderSettings } from '@shared/types'
import { createLogger } from '@renderer/services/LoggerService'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSettings } from '@renderer/store/appSlice'
import styles from '../SettingsPage.module.scss'

/** Logger instance for ProvidersSettings UI section. */
const logger = createLogger('ProvidersSettings')

/**
 * Renders one provider row with identity, enabled, refresh, warm window, and optional API key controls.
 *
 * @param props - Component props containing provider, index, and onChange callback
 * @returns JSX Element for Provider card row
 */
const ProviderCard = ({
  provider,
  index,
  onChange,
}: {
  provider: ProviderSettings
  index: number
  onChange: (provider: ProviderSettings) => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const environmentApiKeys = useAppSelector((state) => state.app.environmentApiKeys)
  const descriptor = PROVIDER_DESCRIPTORS.find(
    (entry) => entry.id === provider.id || entry.name === provider.name,
  )
  const hasApiKeyControl = descriptor?.authenticationKind === 'apiKey' || provider.type === 'apiKey'
  const canRefresh = descriptor?.authenticationKind === 'oauth' || provider.type === 'oauth'
  const supportsWarmWindow =
    descriptor?.id === 'codex' || descriptor?.id === 'claude' || descriptor?.id === 'antigravity'
  const warmWindowEnabled =
    provider.startWindowAfterReset ?? descriptor?.startWindowAfterReset ?? false
  const envKeyName = descriptor?.credentialName ?? null
  const hasEnvKey = envKeyName !== null && environmentApiKeys[envKeyName] !== undefined

  return (
    <Draggable key={provider.name} draggableId={provider.name} index={index}>
      {(draggableProvided, draggableSnapshot) => (
        <article
          className={`${styles.providerCard} ${draggableSnapshot.isDragging ? styles.providerDragging : ''}`}
          ref={draggableProvided.innerRef}
          {...draggableProvided.draggableProps}
          {...draggableProvided.dragHandleProps}
        >
          <GripVertical className={styles.providerDragHandle} size={17} />
          <div className={styles.providerIdentity}>
            <strong>{provider.name}</strong>
          </div>
          <div className={styles.providerToggle}>
            <Switch
              checked={provider.enabled}
              aria-label={t('providers.enabled')}
              onChange={(enabled) => onChange({ ...provider, enabled })}
            />
          </div>
          {canRefresh ? (
            <div className={styles.providerToggle}>
              <Switch
                checked={provider.refreshToken}
                aria-label={t('providers.refreshToken')}
                onChange={(refreshToken) => onChange({ ...provider, refreshToken })}
              />
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
          {supportsWarmWindow ? (
            <div className={styles.providerToggle}>
              <Switch
                checked={warmWindowEnabled}
                aria-label={t('providers.warmWindow')}
                onChange={(startWindowAfterReset) =>
                  onChange({ ...provider, startWindowAfterReset })
                }
              />
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
          {hasApiKeyControl &&
            (hasEnvKey ? (
              <Tooltip title={`${envKeyName}: ${t('providers.envKeyDescription')}`}>
                <div className={styles.providerKeyField}>
                  <Input.Password
                    className={styles.providerApiKeyInput}
                    readOnly
                    value={environmentApiKeys[envKeyName ?? ''] ?? ''}
                    placeholder={t('providers.envKeyPlaceholder')}
                  />
                </div>
              </Tooltip>
            ) : (
              <div className={styles.providerKeyField}>
                <Input.Password
                  className={styles.providerApiKeyInput}
                  autoComplete="new-password"
                  placeholder={t('providers.apiKey')}
                  value={provider.apiKey ?? ''}
                  onChange={(event) =>
                    onChange({ ...provider, apiKey: event.target.value || null })
                  }
                />
              </div>
            ))}
        </article>
      )}
    </Draggable>
  )
}

/**
 * Displays the persisted provider list with drag-and-drop reordering.
 *
 * @returns JSX Element for ProvidersSettings section
 */
const ProvidersSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const dispatch = useAppDispatch()
  const settingsActions = useSettingsActions()
  const { message } = App.useApp()
  const { t } = useTranslation()

  /**
   * Persists the provider array; the array index is the display order.
   *
   * @param providers - Array of provider settings items
   */
  const saveProviders = (providers: ProviderSettings[]): void => {
    void settingsActions.saveSettings({ providers }).catch(() => undefined)
  }

  /**
   * Updates one provider row and keeps the remaining rows in their current order.
   *
   * @param updated - Modified provider settings item
   */
  const updateProvider = (updated: ProviderSettings): void => {
    const providers = settings.providers.map((provider) =>
      provider.name === updated.name ? updated : provider,
    )
    saveProviders(providers)
  }

  /**
   * Reorders providers optimistically on drag, then persists the new display order.
   *
   * @param result - DragDropContext DropResult object
   */
  const reorderFromResult = (result: DropResult): void => {
    const destination = result.destination
    if (!destination || destination.index === result.source.index) return
    const previous = settings.providers
    const providers = [...previous]
    const [moved] = providers.splice(result.source.index, 1)
    if (moved === undefined) return
    providers.splice(destination.index, 0, moved)
    dispatch(setSettings({ ...settings, providers }))
    settingsActions
      .saveSettings({ providers })
      .then(() => undefined)
      .catch((error) => {
        logger.error('Provider order could not be saved.', error)
        dispatch(setSettings({ ...settings, providers: previous }))
        void message.error(t('errors.generic'))
      })
  }

  return (
    <div className={styles.settingContainer}>
      <div className={styles.sectionHeading}>
        <h2>{t('settings.providers')}</h2>
        <p>{t('providers.displayOrderDescription')}</p>
      </div>
      <DragDropContext onDragEnd={reorderFromResult}>
        <div className={styles.providerHeader} aria-hidden="true">
          <span />
          <span />
          <span className={styles.providerHeaderLabel}>{t('providers.enabled')}</span>
          <span className={styles.providerHeaderLabel}>{t('providers.refreshToken')}</span>
          <span className={styles.providerHeaderLabel}>{t('providers.warmWindow')}</span>
          <span className={styles.providerHeaderLabel}>{t('providers.apiKey')}</span>
        </div>
        <Droppable droppableId="providers">
          {(droppableProvided) => (
            <div
              className={styles.providerList}
              ref={droppableProvided.innerRef}
              {...droppableProvided.droppableProps}
            >
              {settings.providers.map((provider, index) => (
                <ProviderCard
                  key={provider.name}
                  provider={provider}
                  index={index}
                  onChange={updateProvider}
                />
              ))}
              {droppableProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  )
}

export default ProvidersSettingsSection
