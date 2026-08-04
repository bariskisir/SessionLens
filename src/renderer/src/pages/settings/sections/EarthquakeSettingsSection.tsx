/**
 * Renders fixed-location, FCM, realtime alert, and seismic-network preferences.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, InputNumber, Popconfirm, Select, Space, Switch, Tag } from 'antd'
import L from 'leaflet'
import { useTranslation } from 'react-i18next'
import { createEarthquakeTopics } from '@shared/earthquake'
import {
  EARTHQUAKE_NOTIFICATION_PRESENTATIONS,
  type EarthquakeEventKind,
  type EarthquakeNotificationPresentation,
} from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setEarthquakeStatus } from '@renderer/store/appSlice'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays the complete earthquake receiver settings surface. */
const EarthquakeSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const status = useAppSelector((state) => state.app.earthquakeStatus)
  const dispatch = useAppDispatch()
  const settingsActions = useSettingsActions()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const initialLocationRef = useRef<[number, number]>([
    settings.earthquakeLatitude,
    settings.earthquakeLongitude,
  ])
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const [latitude, setLatitude] = useState(settings.earthquakeLatitude)
  const [longitude, setLongitude] = useState(settings.earthquakeLongitude)
  const [interval, setInterval] = useState(settings.fcmCheckIntervalMinutes)
  const [savingLocation, setSavingLocation] = useState(false)
  const [checking, setChecking] = useState(false)
  const [resettingRegistration, setResettingRegistration] = useState(false)
  const [testing, setTesting] = useState<EarthquakeEventKind | null>(null)
  const topics = useMemo(() => createEarthquakeTopics(latitude, longitude), [latitude, longitude])

  useEffect(() => {
    const element = mapElementRef.current
    if (!element || mapRef.current) return
    const initialLocation = initialLocationRef.current
    const map = L.map(element, { zoomControl: true, attributionControl: false }).setView(
      initialLocation,
      6,
    )
    const marker = L.circleMarker(initialLocation, {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#4f46e5',
      fillOpacity: 1,
    }).addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => {
      setLatitude(Number(event.latlng.lat.toFixed(4)))
      setLongitude(Number(event.latlng.lng.toFixed(4)))
    })
    mapRef.current = map
    markerRef.current = marker
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    return () => {
      window.clearTimeout(resizeTimer)
      map.remove()
      mapRef.current = null
      tileLayerRef.current = null
      markerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tileLayerRef.current?.removeFrom(map)
    const style = theme === 'dark' ? 'dark_all' : 'light_all'
    const layer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19,
    }).addTo(map)
    layer.bringToBack()
    tileLayerRef.current = layer
  }, [theme])

  useEffect(() => {
    markerRef.current?.setLatLng([latitude, longitude])
  }, [latitude, longitude])

  /** Persists a coordinate pair atomically so its tile topic changes only once. */
  const saveLocation = async (): Promise<void> => {
    if (savingLocation) return
    setSavingLocation(true)
    try {
      const saved = await settingsActions.saveSettingsWithResult({
        earthquakeLatitude: latitude,
        earthquakeLongitude: longitude,
      })
      if (!saved) return
      dispatch(setEarthquakeStatus(await window.app.refreshEarthquakeConnection()))
    } finally {
      setSavingLocation(false)
    }
  }

  /** Invokes the same token/topic refresh that is scheduled at application startup. */
  const checkConnection = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    try {
      dispatch(setEarthquakeStatus(await window.app.refreshEarthquakeConnection()))
    } finally {
      setChecking(false)
    }
  }

  /** Deletes the current identity and waits for a completely fresh FCM/backend registration. */
  const resetRegistration = async (): Promise<void> => {
    if (resettingRegistration) return
    setResettingRegistration(true)
    try {
      const nextStatus = await window.app.resetEarthquakeRegistration()
      dispatch(setEarthquakeStatus(nextStatus))
      void message.success(t('earthquake.resetRegistrationComplete'))
    } catch {
      void message.error(t('errors.generic'))
    } finally {
      setResettingRegistration(false)
    }
  }

  /** Sends a random sample through the production event pipeline. */
  const runTest = async (kind: EarthquakeEventKind): Promise<void> => {
    if (testing) return
    setTesting(kind)
    try {
      await window.app.testEarthquake(kind)
      void message.success(t('earthquake.testCreated'))
    } catch {
      void message.error(t('errors.generic'))
    } finally {
      setTesting(null)
    }
  }

  const statusDescription =
    status.state === 'not-configured'
      ? t('earthquake.fcmNotConfiguredDescription')
      : status.state === 'connected' && status.subscribedTopics.length === 0
        ? t('earthquake.topicSubscriptionFailedDescription')
        : (status.message ?? t('earthquake.fcmStatusDescription'))

  const statusColor =
    status.state === 'connected'
      ? status.subscribedTopics.length === status.topics.length
        ? 'success'
        : 'warning'
      : status.state === 'error'
        ? 'error'
        : status.state === 'connecting'
          ? 'processing'
          : 'default'

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('earthquake.locationGroup')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.locationGrid}>
          <div className={styles.locationSettings}>
            <SettingLabel
              title={t('earthquake.location')}
              description={t('earthquake.locationDescription')}
            />
          </div>
          <div className={styles.mapColumn}>
            <div ref={mapElementRef} className={styles.earthquakeMap} />
            <div className={styles.locationSaveArea}>
              <span className={styles.selectedLocation}>
                {longitude.toFixed(4)}, {latitude.toFixed(4)}
              </span>
              <Button type="primary" loading={savingLocation} onClick={() => void saveLocation()}>
                {t('earthquake.saveLocation')}
              </Button>
            </div>
            <div className={styles.topicList}>
              <span>{t('earthquake.topics')}</span>
              {topics.map((topic) => (
                <Tag key={topic}>{topic}</Tag>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel title={t('earthquake.fcmStatus')} description={statusDescription} />
          <div className={`${styles.settingControl} ${styles.fcmStatus}`}>
            <Tag color={statusColor}>{t(`earthquake.states.${status.state}`)}</Tag>
            <div className={styles.fcmDetails}>
              {status.token && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.token')}</span>
                  <code className={styles.fcmToken ?? ''}>{status.token}</code>
                </div>
              )}
              {status.backendUserId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.backendUserId')}</span>
                  <code>{status.backendUserId}</code>
                </div>
              )}
              {status.backendRegistered !== undefined && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.backendRegistration')}</span>
                  <Tag color={status.backendRegistered ? 'success' : 'error'}>
                    {t(
                      status.backendRegistered ? 'earthquake.confirmed' : 'earthquake.notConfirmed',
                    )}
                  </Tag>
                </div>
              )}
              {status.tileRegistered !== undefined && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.tileRegistration')}</span>
                  <Tag color={status.tileRegistered ? 'success' : 'error'}>
                    {t(status.tileRegistered ? 'earthquake.confirmed' : 'earthquake.notConfirmed')}
                  </Tag>
                </div>
              )}
              {status.locationSynchronized !== undefined && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.locationSynchronization')}</span>
                  <Tag color={status.locationSynchronized ? 'success' : 'error'}>
                    {t(
                      status.locationSynchronized
                        ? 'earthquake.confirmed'
                        : 'earthquake.notConfirmed',
                    )}
                  </Tag>
                </div>
              )}
              {status.topicMembershipConfirmed !== undefined && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.topicMembership')}</span>
                  <Tag color={status.topicMembershipConfirmed ? 'success' : 'error'}>
                    {t(
                      status.topicMembershipConfirmed
                        ? 'earthquake.confirmed'
                        : 'earthquake.notConfirmed',
                    )}
                  </Tag>
                </div>
              )}
              {status.firebaseInstallationId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.firebaseInstallationId')}</span>
                  <code>{status.firebaseInstallationId}</code>
                </div>
              )}
              {status.gcmAndroidId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.gcmAndroidId')}</span>
                  <code>{status.gcmAndroidId}</code>
                </div>
              )}
              {status.gcmAppId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.gcmAppId')}</span>
                  <code>{status.gcmAppId}</code>
                </div>
              )}
              {status.firebaseProjectId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.firebaseProjectId')}</span>
                  <code>{status.firebaseProjectId}</code>
                </div>
              )}
              {status.packageId && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.packageId')}</span>
                  <code>{status.packageId}</code>
                </div>
              )}
              {status.installationCreatedAt && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.installationCreated')}</span>
                  <time dateTime={status.installationCreatedAt}>
                    {new Date(status.installationCreatedAt).toLocaleString()}
                  </time>
                </div>
              )}
              {status.authTokenExpiresAt && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.authTokenExpires')}</span>
                  <time dateTime={status.authTokenExpiresAt}>
                    {new Date(status.authTokenExpiresAt).toLocaleString()}
                  </time>
                </div>
              )}
              {status.persistentMessageCount !== undefined && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.persistentMessageCount')}</span>
                  <code>{status.persistentMessageCount}</code>
                </div>
              )}
              {status.lastCheckedAt && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.lastCheck')}</span>
                  <time dateTime={status.lastCheckedAt}>
                    {new Date(status.lastCheckedAt).toLocaleString()}
                  </time>
                </div>
              )}
              {status.nextCheckAt && (
                <div className={styles.fcmDetail}>
                  <span>{t('earthquake.nextCheck')}</span>
                  <time dateTime={status.nextCheckAt}>
                    {new Date(status.nextCheckAt).toLocaleString()}
                  </time>
                </div>
              )}
            </div>
            <div className={styles.subscribedTopics}>
              <span>{t('earthquake.subscribedTopics')}</span>
              {status.subscribedTopics.length === 0 ? (
                <em>{t('earthquake.noSubscribedTopics')}</em>
              ) : (
                status.subscribedTopics.map((topic) => (
                  <Tag color="success" key={topic}>
                    {topic}
                  </Tag>
                ))
              )}
            </div>
            <Space size={6}>
              <Button size="small" loading={checking} onClick={() => void checkConnection()}>
                {t('earthquake.checkNow')}
              </Button>
              <Popconfirm
                title={t('earthquake.resetRegistration')}
                description={t('earthquake.resetRegistrationConfirm')}
                okButtonProps={{ danger: true }}
                okText={t('earthquake.resetRegistration')}
                onConfirm={resetRegistration}
              >
                <Button danger size="small" loading={resettingRegistration}>
                  {t('earthquake.resetRegistration')}
                </Button>
              </Popconfirm>
            </Space>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.checkInterval')}
            description={t('earthquake.checkIntervalDescription')}
          />
          <Space.Compact>
            <InputNumber
              className={styles.durationInput ?? ''}
              value={interval}
              min={1}
              max={43_200}
              step={1}
              onChange={(value) => value !== null && setInterval(value)}
              onBlur={() => {
                if (interval !== settings.fcmCheckIntervalMinutes) {
                  void settingsActions.saveSettings({ fcmCheckIntervalMinutes: interval })
                }
              }}
            />
            <Button disabled>{t('earthquake.minutes')}</Button>
          </Space.Compact>
        </div>
      </section>

      <h2 className={styles.groupTitle}>{t('earthquake.realtimeGroup')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.realtimeAlerts')}
            description={t('earthquake.realtimeAlertsDescription')}
          />
          <Switch
            checked={settings.realtimeAlertsEnabled}
            onChange={(realtimeAlertsEnabled) =>
              void settingsActions.saveSettings({ realtimeAlertsEnabled })
            }
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.notificationPresentation')}
            description={t('earthquake.realtimeNotificationPresentationDescription')}
          />
          <Select
            className={styles.compactControl ?? ''}
            disabled={!settings.realtimeAlertsEnabled}
            value={settings.realtimeNotificationPresentation}
            options={EARTHQUAKE_NOTIFICATION_PRESENTATIONS.map((presentation) => ({
              value: presentation,
              label: t(`earthquake.presentations.${presentation}`),
            }))}
            onChange={(realtimeNotificationPresentation: EarthquakeNotificationPresentation) =>
              void settingsActions.saveSettings({ realtimeNotificationPresentation })
            }
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.silentWhenMild')}
            description={t('earthquake.silentWhenMildDescription')}
          />
          <Switch
            disabled={!settings.realtimeAlertsEnabled}
            checked={settings.realtimeSilentWhenMild}
            onChange={(realtimeSilentWhenMild) =>
              void settingsActions.saveSettings({ realtimeSilentWhenMild })
            }
          />
        </div>
      </section>

      <h2 className={styles.groupTitle}>{t('earthquake.seismicGroup')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.seismicNotifications')}
            description={t('earthquake.seismicNotificationsDescription')}
          />
          <Switch
            checked={settings.seismicNotificationsEnabled}
            onChange={(seismicNotificationsEnabled) =>
              void settingsActions.saveSettings({ seismicNotificationsEnabled })
            }
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.notificationPresentation')}
            description={t('earthquake.seismicNotificationPresentationDescription')}
          />
          <Select
            className={styles.compactControl ?? ''}
            disabled={!settings.seismicNotificationsEnabled}
            value={settings.seismicNotificationPresentation}
            options={EARTHQUAKE_NOTIFICATION_PRESENTATIONS.map((presentation) => ({
              value: presentation,
              label: t(`earthquake.presentations.${presentation}`),
            }))}
            onChange={(seismicNotificationPresentation: EarthquakeNotificationPresentation) =>
              void settingsActions.saveSettings({ seismicNotificationPresentation })
            }
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.minimumMagnitude')}
            description={t('earthquake.minimumMagnitudeDescription')}
          />
          <InputNumber
            value={settings.seismicMinimumMagnitude}
            min={0}
            max={10}
            step={0.1}
            onChange={(seismicMinimumMagnitude) =>
              seismicMinimumMagnitude !== null &&
              void settingsActions.saveSettings({ seismicMinimumMagnitude })
            }
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('earthquake.maximumDistance')}
            description={t('earthquake.maximumDistanceDescription')}
          />
          <Space.Compact>
            <InputNumber
              value={settings.seismicMaximumDistanceKm}
              min={1}
              max={20_000}
              step={1}
              onChange={(seismicMaximumDistanceKm) =>
                seismicMaximumDistanceKm !== null &&
                void settingsActions.saveSettings({ seismicMaximumDistanceKm })
              }
            />
            <Button disabled>{t('earthquake.kilometres')}</Button>
          </Space.Compact>
        </div>
      </section>

      <h2 className={styles.groupTitle}>{t('earthquake.testGroup')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.testButtons}>
          <Button
            danger
            loading={testing === 'realtime'}
            disabled={testing !== null && testing !== 'realtime'}
            onClick={() => void runTest('realtime')}
          >
            {t('earthquake.realtimeTest')}
          </Button>
          <Button
            loading={testing === 'seismic-network'}
            disabled={testing !== null && testing !== 'seismic-network'}
            onClick={() => void runTest('seismic-network')}
          >
            {t('earthquake.seismicTest')}
          </Button>
        </div>
      </section>
    </div>
  )
}

export default EarthquakeSettingsSection
