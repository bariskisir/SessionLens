/** Renders every earthquake in the active magnitude filter on one shared map. */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTranslation } from 'react-i18next'
import { calculateDistanceKm, getEarthquakeMarkerRadius } from '@shared/earthquake'
import type { SessionSummary, TimeFormat } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import { formatDate } from '@renderer/utils/formatters'
import styles from './EarthquakeEventMap.module.scss'

interface EarthquakeOverviewMapProps {
  sessions: SessionSummary[]
  userLatitude: number
  userLongitude: number
  timeFormat: TimeFormat
  onSelectSession: (id: string) => Promise<void>
}

/** Draws filtered epicentres with hover details, distance, and selection behavior. */
const EarthquakeOverviewMap = ({
  sessions,
  userLatitude,
  userLongitude,
  timeFormat,
  onSelectSession,
}: EarthquakeOverviewMapProps): React.JSX.Element => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const mapElementRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = mapElementRef.current
    if (!element) return
    const userLocation: L.LatLngTuple = [userLatitude, userLongitude]
    const earthquakes = sessions.flatMap((session) =>
      session.latitude !== undefined && session.longitude !== undefined
        ? [{ location: [session.latitude, session.longitude] as L.LatLngTuple, session }]
        : [],
    )
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
    const hoverLayer = L.layerGroup().addTo(map)
    const distanceLinePane = map.createPane('overview-distance-lines')
    distanceLinePane.style.zIndex = '390'
    distanceLinePane.style.pointerEvents = 'none'

    earthquakes.forEach(({ location, session }) => {
      const tooltip = document.createElement('span')
      tooltip.className = styles.overviewTooltipContent ?? ''
      const details = document.createElement('strong')
      const locationLabel = session.place ?? `${location[0].toFixed(2)}, ${location[1].toFixed(2)}`
      details.textContent = `${session.magnitude !== undefined ? `M${session.magnitude.toFixed(1)} · ` : ''}${locationLabel}`
      const timestamp = document.createElement('span')
      timestamp.textContent = formatDate(session.occurredAt ?? session.createdAt, timeFormat)
      tooltip.append(details, timestamp)

      const radius = getEarthquakeMarkerRadius(session.magnitude)
      L.circleMarker(location, {
        radius,
        color: '#ffffff',
        weight: radius < 8 ? 2 : radius >= 17 ? 4 : 3,
        fillColor: '#ff4d4f',
        fillOpacity: 1,
        className: styles.clickableMarker ?? '',
      })
        .bindTooltip(tooltip, {
          direction: 'top',
          className: styles.overviewTooltip ?? '',
        })
        .on('mouseover', () => {
          hoverLayer.clearLayers()
          const distanceKm = calculateDistanceKm(
            userLatitude,
            userLongitude,
            location[0],
            location[1],
          )
          L.polyline([userLocation, location], {
            color: theme === 'dark' ? '#f8fafc' : '#1f2937',
            weight: 2,
            opacity: 0.82,
            dashArray: '8 8',
            interactive: false,
            pane: 'overview-distance-lines',
          }).addTo(hoverLayer)
          const midpoint: L.LatLngTuple = [
            (userLatitude + location[0]) / 2,
            (userLongitude + location[1]) / 2,
          ]
          L.circleMarker(midpoint, { radius: 1, opacity: 0, fillOpacity: 0 })
            .bindTooltip(`${distanceKm.toFixed(1)} ${t('earthquake.kilometres')}`, {
              permanent: true,
              direction: 'center',
              className: styles.distanceTooltip ?? '',
            })
            .addTo(hoverLayer)
        })
        .on('mouseout', () => hoverLayer.clearLayers())
        .on('click', () => void onSelectSession(session.id))
        .addTo(map)
    })

    L.circleMarker(userLocation, {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#4f46e5',
      fillOpacity: 1,
    }).addTo(map)

    const bounds = L.latLngBounds([userLocation, ...earthquakes.map(({ location }) => location)])
    /** Keeps every filtered epicentre visible after the workspace changes size. */
    const fitMapToBounds = (): void => {
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 10 })
    }
    fitMapToBounds()
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    let refitTimer = 0
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
    }
  }, [onSelectSession, sessions, t, theme, timeFormat, userLatitude, userLongitude])

  return (
    <div className={styles.shell}>
      <div ref={mapElementRef} className={styles.map} />
      <div className={styles.legend}>
        <span>
          <i className={styles.earthquakeDot} /> {t('earthquake.earthquakeCenter')}
        </span>
      </div>
    </div>
  )
}

export default EarthquakeOverviewMap
