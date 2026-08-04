/** Renders user and epicentre positions, distance, and an animated realtime wavefront. */

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useTranslation } from 'react-i18next'
import {
  calculateDistanceKm,
  calculateEarthquakeWaveState,
  type EarthquakeWaveState,
} from '@shared/earthquake'
import type { EarthquakeEvent } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import styles from './EarthquakeEventMap.module.scss'

interface EarthquakeEventMapProps {
  earthquake: EarthquakeEvent
  userLatitude: number
  userLongitude: number
  mode?: 'session' | 'fullscreen'
  showWave?: boolean
}

/** Draws the selected earthquake relative to the user's fixed notification location. */
const EarthquakeEventMap = ({
  earthquake,
  userLatitude,
  userLongitude,
  mode = 'session',
  showWave = false,
}: EarthquakeEventMapProps): React.JSX.Element => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const waveCircleRef = useRef<L.Circle | null>(null)
  const distanceKm = calculateDistanceKm(
    userLatitude,
    userLongitude,
    earthquake.latitude,
    earthquake.longitude,
  )
  const eventTimestamp = Date.parse(earthquake.receivedAt)
  const waveSpeedKmPerSecond = earthquake.waveSpeedKmPerSecond
  const alertDelaySeconds = earthquake.alertDelaySeconds ?? 0
  const elapsedSeconds = Number.isNaN(eventTimestamp)
    ? 0
    : Math.max(0, (Date.now() - eventTimestamp) / 1_000)
  const [waveState, setWaveState] = useState<EarthquakeWaveState>(() =>
    calculateEarthquakeWaveState(
      distanceKm,
      elapsedSeconds,
      waveSpeedKmPerSecond,
      alertDelaySeconds,
    ),
  )

  useEffect(() => {
    const element = mapElementRef.current
    if (!element) return
    const eventLocation: L.LatLngExpression = [earthquake.latitude, earthquake.longitude]
    const userLocation: L.LatLngExpression = [userLatitude, userLongitude]
    const map = L.map(element, {
      attributionControl: true,
      zoomControl: true,
      preferCanvas: false,
    })
    const style = theme === 'dark' ? 'dark_all' : 'light_all'
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors © CARTO',
    }).addTo(map)

    if (earthquake.kind === 'realtime' && showWave) {
      const initialWave = calculateEarthquakeWaveState(
        distanceKm,
        Number.isNaN(eventTimestamp) ? 0 : Math.max(0, (Date.now() - eventTimestamp) / 1_000),
        waveSpeedKmPerSecond,
        alertDelaySeconds,
      )
      waveCircleRef.current = L.circle(eventLocation, {
        radius: initialWave.radiusKm * 1_000,
        color: '#ff4d4f',
        weight: 2,
        opacity: 0.82,
        fillColor: '#ff4d4f',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map)
    }

    L.polyline([eventLocation, userLocation], {
      color: theme === 'dark' ? '#f8fafc' : '#1f2937',
      weight: 2,
      opacity: 0.82,
      dashArray: '8 8',
      interactive: false,
    }).addTo(map)

    L.circleMarker(eventLocation, {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#ff4d4f',
      fillOpacity: 1,
    })
      .bindTooltip(t('earthquake.earthquakeCenter'), {
        permanent: true,
        direction: 'top',
        className: styles.markerTooltip ?? '',
      })
      .addTo(map)

    L.circleMarker(userLocation, {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#4f46e5',
      fillOpacity: 1,
    })
      .bindTooltip(t('earthquake.yourLocation'), {
        permanent: true,
        direction: 'bottom',
        className: styles.markerTooltip ?? '',
      })
      .addTo(map)

    const midpoint: L.LatLngExpression = [
      (earthquake.latitude + userLatitude) / 2,
      (earthquake.longitude + userLongitude) / 2,
    ]
    L.circleMarker(midpoint, { radius: 1, opacity: 0, fillOpacity: 0 })
      .bindTooltip(`${distanceKm.toFixed(1)} ${t('earthquake.kilometres')}`, {
        permanent: true,
        direction: 'center',
        className: styles.distanceTooltip ?? '',
      })
      .addTo(map)

    const bounds: L.LatLngBoundsExpression = [eventLocation, userLocation]
    /** Frames both markers within the container's current size. */
    const fitMapToBounds = (): void => {
      const fullscreenWide = mode === 'fullscreen' && element.clientWidth > 800
      map.fitBounds(bounds, {
        paddingTopLeft: fullscreenWide ? [430, 75] : [55, 55],
        paddingBottomRight: mode === 'fullscreen' ? [90, 90] : [55, 55],
        maxZoom: 11,
      })
    }
    fitMapToBounds()
    mapRef.current = map
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    let refitTimer = 0
    /** Re-frames the markers after the container size settles. */
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(refitTimer)
      refitTimer = window.setTimeout(() => {
        map.invalidateSize()
        fitMapToBounds()
      }, 150)
    })
    resizeObserver.observe(element)
    return () => {
      window.clearTimeout(resizeTimer)
      window.clearTimeout(refitTimer)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      waveCircleRef.current = null
    }
  }, [
    distanceKm,
    alertDelaySeconds,
    earthquake.kind,
    earthquake.latitude,
    earthquake.longitude,
    eventTimestamp,
    mode,
    showWave,
    t,
    theme,
    userLatitude,
    userLongitude,
    waveSpeedKmPerSecond,
  ])

  useEffect(() => {
    if (earthquake.kind !== 'realtime' || !showWave) return
    const startedAt = Number.isNaN(eventTimestamp) ? Date.now() : eventTimestamp
    const updateWave = (): void => {
      const elapsed = Math.max(0, (Date.now() - startedAt) / 1_000)
      const next = calculateEarthquakeWaveState(
        distanceKm,
        elapsed,
        waveSpeedKmPerSecond,
        alertDelaySeconds,
      )
      waveCircleRef.current?.setRadius(next.radiusKm * 1_000)
      setWaveState((current) =>
        current.radiusKm === next.radiusKm && current.remainingSeconds === next.remainingSeconds
          ? current
          : next,
      )
    }
    updateWave()
    const timer = window.setInterval(updateWave, 100)
    return () => window.clearInterval(timer)
  }, [
    alertDelaySeconds,
    distanceKm,
    earthquake.kind,
    eventTimestamp,
    showWave,
    waveSpeedKmPerSecond,
  ])

  return (
    <div className={`${styles.shell} ${mode === 'fullscreen' ? styles.fullscreen : ''}`}>
      <div ref={mapElementRef} className={styles.map} />
      <div className={styles.legend}>
        <span>
          <i className={styles.userDot} /> {t('earthquake.yourLocation')}
        </span>
        <span>
          <i className={styles.earthquakeDot} /> {t('earthquake.earthquakeCenter')}
        </span>
        <strong>
          {distanceKm.toFixed(1)} {t('earthquake.kilometres')}
        </strong>
      </div>
      {earthquake.kind === 'realtime' && showWave && (
        <div className={`${styles.countdown} ${waveState.arrived ? styles.arrived : ''}`}>
          <span>{t('earthquake.estimatedWaveArrival')}</span>
          <strong>
            {waveState.arrived
              ? t('earthquake.waveArrived')
              : t('earthquake.secondsRemaining', { count: waveState.remainingSeconds })}
          </strong>
        </div>
      )}
    </div>
  )
}

export default EarthquakeEventMap
