/**
 * Provides consistent formatting helpers for application metadata.
 */

import type { TimeFormat } from '@shared/types'

/** Formats a stored ISO date with the preferred 12- or 24-hour clock. */
export const formatDate = (isoDate: string, timeFormat: TimeFormat): string => {
  const date = new Date(isoDate)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = String(date.getFullYear())
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const localHours = date.getHours()

  if (timeFormat === '12-hour') {
    const hours = (localHours % 12 || 12).toString().padStart(2, '0')
    const period = localHours >= 12 ? 'PM' : 'AM'
    return `${day}.${month}.${year} ${hours}:${minutes} ${period}`
  }

  return `${day}.${month}.${year} ${localHours.toString().padStart(2, '0')}:${minutes}`
}
