/** Renders a modal application-wide warning for fullscreen earthquake delivery. */

import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@renderer/services/LoggerService'
import { stopEarthquakeAlarm } from '@renderer/services/EarthquakeAlarmService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setFullscreenEarthquake } from '@renderer/store/appSlice'
import EarthquakeEventMap from '@renderer/components/earthquake/EarthquakeEventMap'
import { getIntensityLabel } from '@shared/earthquake'
import styles from './FullscreenEarthquakeAlert.module.scss'

const logger = createLogger('FullscreenEarthquakeAlert')

/** Covers the fullscreen main window until the user explicitly dismisses the warning. */
const FullscreenEarthquakeAlert = (): React.JSX.Element | null => {
  const session = useAppSelector((state) => state.app.fullscreenEarthquake)
  const userLatitude = useAppSelector((state) => state.app.settings.earthquakeLatitude)
  const userLongitude = useAppSelector((state) => state.app.settings.earthquakeLongitude)
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const earthquake = session?.earthquake

  /** Restores the normal window and clears the active warning. */
  const dismiss = useCallback((): void => {
    stopEarthquakeAlarm()
    dispatch(setFullscreenEarthquake(null))
    void window.app.dismissFullscreenEarthquake().catch((error: unknown) => {
      logger.warn('Fullscreen earthquake warning could not be dismissed.', error)
    })
  }, [dispatch])

  useEffect(() => {
    if (!earthquake) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [earthquake, dismiss])

  if (!session || !earthquake) return null
  const location = earthquake.place ?? `${earthquake.latitude}, ${earthquake.longitude}`
  const magnitude =
    earthquake.magnitude === undefined ? 'M —' : `M ${earthquake.magnitude.toFixed(1)}`
  const intensityLabel =
    earthquake.estimatedIntensity !== undefined
      ? getIntensityLabel(earthquake.estimatedIntensity)
      : null

  return (
    <div
      className={`${styles.overlay} ${intensityLabel ? styles[intensityLabel] : ''}`}
      role="alertdialog"
      aria-modal="true"
    >
      <section className={styles.summary}>
        <span className={styles.eyebrow}>{t('earthquake.fullscreenAlert')}</span>
        <h1>
          {magnitude} – {location}
        </h1>
        {earthquake.estimatedIntensity !== undefined && (
          <p className={styles.intensity}>
            {t(`earthquake.intensityLabels.${getIntensityLabel(earthquake.estimatedIntensity)}`)}
          </p>
        )}
        {earthquake.distanceKm !== undefined && (
          <p>
            {earthquake.distanceKm.toFixed(0)} {t('earthquake.kilometres')}
          </p>
        )}
      </section>
      <div className={styles.mapPanel}>
        <EarthquakeEventMap
          key={earthquake.id}
          earthquake={earthquake}
          userLatitude={userLatitude}
          userLongitude={userLongitude}
          mode="fullscreen"
          showWave
        />
      </div>
    </div>
  )
}

export default FullscreenEarthquakeAlert
