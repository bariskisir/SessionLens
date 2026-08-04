/** Normalizes Earthquake Network FCM data messages without applying notification policy. */

import { createHash } from 'node:crypto'
import type { Types } from '@eneris/push-receiver/dist/client'
import { calculateDistanceKm, estimateEarthquakeNetworkIntensity } from '@shared/earthquake'
import type { EarthquakeEvent } from '@shared/types'

const ignoredMessageTypes = new Set(['manual', 'chat_public', 'chat_personal', 'friendship'])

/** Returns true when a raw FCM data payload carries a non-seismic message type. */
export const isIgnoredMessage = (data: Record<string, unknown>): boolean => {
  const rawType = readString(data, ['type', 'eventType', 'notificationType'])?.toLowerCase() ?? null
  return rawType !== null && ignoredMessageTypes.has(rawType)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Parses a JSON-encoded nested data field while rejecting arrays and primitives. */
const parseNestedPayload = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Reads the first finite numeric payload alias. */
const readNumber = (data: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = data[key]
    const number =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (Number.isFinite(number)) return number
  }
  return null
}

/** Reads the first non-empty string payload alias. */
const readString = (data: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 1_000)
  }
  return null
}

/** Reads stable string or numeric identifiers without losing JSON-encoded event codes. */
const readIdentifier = (data: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300)
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/** Converts second/millisecond epochs and ISO-compatible date strings. */
const readDate = (data: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = data[key]
    const numeric =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
      : typeof value === 'string'
        ? new Date(value)
        : null
    if (date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

/** Classifies only earthquake-bearing message types and rejects community/social payloads. */
const resolveKind = (
  rawType: string | null,
  data: Record<string, unknown>,
): EarthquakeEvent['kind'] | null => {
  if (rawType && ignoredMessageTypes.has(rawType)) return null
  if (rawType?.includes('eqn') || rawType?.includes('real')) return 'realtime'
  if (rawType?.includes('official') || rawType?.includes('seismic')) return 'seismic-network'
  if (rawType) return null
  if (
    data.eqn_notification !== undefined ||
    data.realtime !== undefined ||
    data.upd !== undefined ||
    data.revision !== undefined
  ) {
    return 'realtime'
  }
  return 'seismic-network'
}

/** Converts one raw package envelope into the persisted earthquake domain model. */
export const parseEarthquakeEnvelope = (
  envelope: Types.MessageEnvelope,
  userLatitude: number,
  userLongitude: number,
): EarthquakeEvent | null => {
  const base = envelope.message.data ?? {}
  const nested = parseNestedPayload(
    base.payload ?? base.data ?? base.notification_data ?? base.notification_bundle,
  )
  const data = { ...base, ...nested }
  const rawType = readString(data, ['type', 'eventType', 'notificationType'])?.toLowerCase() ?? null
  const kind = resolveKind(rawType, data)
  if (!kind) return null

  const latitude = readNumber(data, [
    'latitude',
    'lat',
    'y',
    'latitude_eqn',
    'latitude_notification',
    'official_lat_notification',
    'preliminary_latitude',
  ])
  const longitude = readNumber(data, [
    'longitude',
    'lng',
    'lon',
    'x',
    'longitude_eqn',
    'longitude_notification',
    'official_lon_notification',
    'preliminary_longitude',
  ])
  if (latitude === null || longitude === null) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  const magnitude = readNumber(data, [
    'magnitude',
    'mag',
    'm',
    'magnitude_eqn',
    'official_mag_notification',
    'preliminary_magnitude',
  ])
  const depthKm = readNumber(data, ['depth', 'depthKm', 'dep'])
  const revision = readNumber(data, ['revision', 'upd', 'update'])
  const source =
    readString(data, ['source', 'provider', 'network', 'official_provider_notification']) ??
    'Earthquake Network'
  const place =
    readString(data, ['place', 'location', 'city', 'region', 'notification_title']) ??
    envelope.message.notification?.body
  const distanceKm = calculateDistanceKm(userLatitude, userLongitude, latitude, longitude)
  const sourceIntensity =
    kind === 'realtime' ? readNumber(data, ['intensity', 'intensity_eqn']) : null
  const providedLocalIntensity =
    kind === 'realtime'
      ? readNumber(data, [
          'intensity_at_location',
          'intensity_at_location_eqn',
          'estimatedIntensity',
        ])
      : null
  const estimatedIntensity =
    kind === 'realtime'
      ? (providedLocalIntensity ??
        (magnitude === null ? null : estimateEarthquakeNetworkIntensity(magnitude, distanceKm)))
      : null
  const waveSpeed = kind === 'realtime' ? readNumber(data, ['wave_speed', 'waveSpeed']) : null
  const alertDelay = kind === 'realtime' ? readNumber(data, ['delay', 'alert_delay']) : null
  const magnitudeRange =
    kind === 'seismic-network' ? readNumber(data, ['magnitude_range', 'magnitudeRange']) : null
  const reports = kind === 'seismic-network' ? readNumber(data, ['reports', 'reportCount']) : null
  const providerData =
    kind === 'seismic-network' ? readString(data, ['data', 'providerData']) : null
  const eventKey =
    readIdentifier(data, ['code', 'eventId', 'id', 'earthquakeId']) ??
    envelope.message.fcmMessageId ??
    envelope.persistentId
  const receivedAt = new Date().toISOString()
  const occurredAt = readDate(data, [
    'occurredAt',
    'datetime',
    'date',
    'timestamp',
    'time',
    'data',
    'official_date_notification',
  ])
  const warning = readString(data, ['warning', 'message', 'official_reports_notification'])

  return {
    id: createHash('sha256').update(`${kind}:${eventKey}`).digest('hex'),
    kind,
    source,
    latitude,
    longitude,
    receivedAt,
    distanceKm: Number(distanceKm.toFixed(1)),
    ...(occurredAt ? { occurredAt } : {}),
    ...(magnitude === null ? {} : { magnitude }),
    ...(depthKm === null ? {} : { depthKm }),
    ...(place ? { place } : {}),
    ...(revision === null ? {} : { revision: Math.max(0, Math.round(revision)) }),
    ...(sourceIntensity === null
      ? {}
      : { sourceIntensity: Math.max(0, Math.min(12, sourceIntensity)) }),
    ...(estimatedIntensity === null
      ? {}
      : { estimatedIntensity: Number(estimatedIntensity.toFixed(1)) }),
    ...(waveSpeed !== null && waveSpeed > 0 && waveSpeed <= 20
      ? { waveSpeedKmPerSecond: waveSpeed }
      : {}),
    ...(alertDelay === null
      ? {}
      : { alertDelaySeconds: Math.max(0, Math.min(86_400, alertDelay)) }),
    ...(magnitudeRange === null ? {} : { magnitudeRange }),
    ...(reports === null ? {} : { reportCount: Math.max(0, Math.round(reports)) }),
    ...(providerData ? { providerData } : {}),
    ...(warning ? { warning } : {}),
  }
}
