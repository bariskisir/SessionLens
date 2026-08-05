/**
 * @file IconSettingsSection.tsx
 * @description Renders the system tray icon layout settings allowing auto or manual drag-and-drop bar proportions.
 */

import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { InputNumber, Segmented } from 'antd'
import { GripVertical, Monitor, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PROVIDER_DESCRIPTORS,
  type IconLayoutMode,
  type ProviderDescriptor,
  type TrayIconLayoutSettings,
} from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/**
 * Returns providers that support metric windows and can be placed on tray icon bars.
 *
 * @returns Array of ProviderDescriptor items with barProvider flag set to true
 */
const barProviders = (): ProviderDescriptor[] =>
  PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.barProvider)

/**
 * Displays the drag-and-drop manual icon layout configuration and mode selection.
 *
 * @returns JSX Element for IconSettings section
 */
const IconSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()
  const providers = barProviders()
  const [layout, setLayout] = useState(settings.visual.iconLayout)

  useEffect(() => setLayout(settings.visual.iconLayout), [settings.visual.iconLayout])

  /**
   * Updates state and persists new icon layout settings.
   *
   * @param iconLayout - TrayIconLayoutSettings object to save
   */
  const saveLayout = (iconLayout: TrayIconLayoutSettings): void => {
    setLayout(iconLayout)
    void settingsActions.saveSettings({ visual: { ...settings.visual, iconLayout } })
  }

  /**
   * Calculates updated bars dictionary by modifying a provider's weight.
   *
   * @param provider - Provider descriptor
   * @param weight - New weight percentage
   * @returns Updated bars dictionary
   */
  const withWeight = (provider: ProviderDescriptor, weight: number): Record<string, number> => {
    const bars = { ...layout.bars }
    if (weight <= 0) {
      delete bars[provider.name]
      return bars
    }
    const allocatedToOthers = Object.entries(bars).reduce(
      (total, [name, allocation]) => total + (name === provider.name ? 0 : allocation),
      0,
    )
    bars[provider.name] = Math.max(1, Math.min(100 - allocatedToOthers, weight))
    return bars
  }

  /**
   * Handles drag-and-drop completion events between shelf and icon composition area.
   *
   * @param result - DragDropContext DropResult object
   */
  const onDragEnd = (result: DropResult): void => {
    const destination = result.destination
    if (!destination) return
    const sourceId = result.source.droppableId
    const destinationId = destination.droppableId

    if (sourceId === 'bar-shelf' && destinationId === 'icon-area') {
      const provider = availableProviders[result.source.index]
      if (!provider || layout.bars[provider.name] !== undefined) return
      const availableWeight = 100 - totalWeight
      const bars = { ...layout.bars }
      if (availableWeight >= 2) {
        bars[provider.name] = Math.min(50, availableWeight)
      } else {
        const names = Object.keys(bars)
        const nearestName = names[destination.index] ?? names[names.length - 1]
        if (!nearestName) return
        const nearestWeight = bars[nearestName] ?? 0
        const half = Math.max(1, Math.floor(nearestWeight / 2))
        bars[nearestName] = nearestWeight - half
        if (bars[nearestName] <= 0) delete bars[nearestName]
        bars[provider.name] = half
      }
      saveLayout({ ...layout, bars })
      return
    }

    if (sourceId === 'icon-area' && destinationId === 'bar-shelf') {
      const name = Object.keys(layout.bars)[result.source.index]
      if (!name) return
      const bars = { ...layout.bars }
      delete bars[name]
      saveLayout({ ...layout, bars })
      return
    }

    if (sourceId === 'icon-area' && destinationId === 'icon-area') {
      if (destination.index === result.source.index) return
      const names = Object.keys(layout.bars)
      const [moved] = names.splice(result.source.index, 1)
      if (!moved) return
      names.splice(destination.index, 0, moved)
      const bars: Record<string, number> = {}
      for (const name of names) bars[name] = layout.bars[name] ?? 0
      saveLayout({ ...layout, bars })
    }
  }

  const placedProviders = Object.keys(layout.bars)
    .map((name) => providers.find((provider) => provider.name === name))
    .filter((provider): provider is ProviderDescriptor => provider !== undefined)
  const availableProviders = providers.filter(
    (provider) => layout.bars[provider.name] === undefined,
  )
  const totalWeight = placedProviders.reduce(
    (sum, provider) => sum + (layout.bars[provider.name] ?? 0),
    0,
  )
  const remainingWeight = Math.max(0, 100 - totalWeight)
  let offset = 0
  const previewBars = placedProviders.map((provider) => {
    const weight = layout.bars[provider.name] ?? 0
    const bar = { provider, weight, offset }
    offset += weight
    return bar
  })

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.icon')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('icon.layoutMode')}
            description={t('icon.layoutModeDescription')}
          />
          <div className={styles.settingControl}>
            <Segmented
              value={layout.mode}
              options={[
                {
                  value: 'auto',
                  label: (
                    <span className={styles.segmentedOption}>
                      <Monitor size={15} />
                      {t('icon.layoutModes.auto')}
                    </span>
                  ),
                },
                {
                  value: 'manual',
                  label: (
                    <span className={styles.segmentedOption}>
                      <SlidersHorizontal size={15} />
                      {t('icon.layoutModes.manual')}
                    </span>
                  ),
                },
              ]}
              onChange={(mode) => saveLayout({ ...layout, mode: mode as IconLayoutMode })}
            />
          </div>
        </div>

        {layout.mode === 'manual' && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className={styles.iconLayoutManual}>
              <Droppable droppableId="bar-shelf">
                {(droppableProvided) => (
                  <aside
                    className={styles.barShelf}
                    ref={droppableProvided.innerRef}
                    {...droppableProvided.droppableProps}
                  >
                    {availableProviders.map((provider, index) => (
                      <Draggable key={provider.name} draggableId={provider.name} index={index}>
                        {(draggableProvided) => (
                          <div
                            className={styles.barShelfItem}
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            {...draggableProvided.dragHandleProps}
                          >
                            <GripVertical className={styles.iconBarGrip} size={14} />
                            <span>{provider.name}</span>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {availableProviders.length === 0 && (
                      <span className={styles.barShelfEmpty}>{t('icon.shelfEmpty')}</span>
                    )}
                    {droppableProvided.placeholder}
                  </aside>
                )}
              </Droppable>
              <section className={styles.iconComposition}>
                <Droppable droppableId="icon-area">
                  {(droppableProvided) => (
                    <div
                      className={styles.iconArea}
                      ref={droppableProvided.innerRef}
                      {...droppableProvided.droppableProps}
                    >
                      {previewBars.length === 0 ? (
                        <span className={styles.iconAreaEmpty}>{t('icon.dropHint')}</span>
                      ) : (
                        previewBars.map(({ provider, weight, offset: top }, index) => (
                          <Draggable key={provider.name} draggableId={provider.name} index={index}>
                            {(draggableProvided, draggableSnapshot) => (
                              <div
                                className={styles.iconPreviewBar}
                                ref={draggableProvided.innerRef}
                                {...draggableProvided.draggableProps}
                                {...draggableProvided.dragHandleProps}
                                style={{
                                  ...draggableProvided.draggableProps.style,
                                  ...(draggableSnapshot.isDragging
                                    ? {}
                                    : {
                                        position: 'absolute',
                                        top: `${top}%`,
                                        height: `${weight}%`,
                                      }),
                                }}
                              >
                                <span>{provider.name}</span>
                                {/* biome-ignore lint/a11y/noStaticElementInteractions: stops the weight input from starting a drag */}
                                <span
                                  className={styles.iconPreviewInputWrap}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                >
                                  <InputNumber
                                    className={styles.iconPreviewInput ?? ''}
                                    controls={false}
                                    min={1}
                                    max={100}
                                    value={weight}
                                    onChange={(weight) =>
                                      weight !== null &&
                                      saveLayout({ ...layout, bars: withWeight(provider, weight) })
                                    }
                                  />
                                  <span className={styles.iconPreviewPercent} aria-hidden="true">
                                    %
                                  </span>
                                </span>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {remainingWeight > 0 && (
                        <div
                          className={styles.iconPreviewEmpty}
                          style={{ top: `${totalWeight}%`, height: `${remainingWeight}%` }}
                        />
                      )}
                      {droppableProvided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            </div>
          </DragDropContext>
        )}
      </section>
    </div>
  )
}

export default IconSettingsSection

