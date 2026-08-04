/** Builds and validates native earthquake notification activation payloads. */

import type { EarthquakeNotificationOpenEvent } from './types'

export const EARTHQUAKE_NOTIFICATION_PROTOCOL = 'earthquake-signal'

const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Creates the protocol URL embedded in a Windows earthquake toast. */
export const createEarthquakeNotificationUrl = (sessionId: string): string =>
  `${EARTHQUAKE_NOTIFICATION_PROTOCOL}://notification?sessionId=${encodeURIComponent(sessionId)}`

/** Parses a strict notification protocol URL without accepting arbitrary launch arguments. */
export const parseEarthquakeNotificationUrl = (
  value: string,
): EarthquakeNotificationOpenEvent | null => {
  try {
    const url = new URL(value)
    const sessionId = url.searchParams.get('sessionId')
    if (
      url.protocol !== `${EARTHQUAKE_NOTIFICATION_PROTOCOL}:` ||
      url.hostname !== 'notification' ||
      !sessionId ||
      !sessionIdPattern.test(sessionId)
    ) {
      return null
    }
    return { sessionId }
  } catch {
    return null
  }
}

/** Produces ToastGeneric XML whose body click launches the registered protocol handler. */
export const createWindowsEarthquakeToastXml = (
  title: string,
  body: string,
  activationUrl: string,
  silent: boolean,
): string => {
  const escapeXml = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  return `<toast activationType="protocol" launch="${escapeXml(activationUrl)}"><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>${silent ? '<audio silent="true" />' : ''}</toast>`
}
