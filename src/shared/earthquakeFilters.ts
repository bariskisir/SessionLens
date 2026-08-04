/** Provides one shared magnitude-filter rule for earthquake lists and overview maps. */

import type { EarthquakeFilter, SessionSummary } from './types'

/** Returns the earthquake summaries visible under the selected magnitude threshold. */
export const filterSessionsByMagnitude = (
  sessions: SessionSummary[],
  filter: EarthquakeFilter,
): SessionSummary[] => {
  if (filter === 'all') return sessions
  const threshold = Number(filter)
  return sessions.filter(
    (session) => session.magnitude !== undefined && session.magnitude >= threshold,
  )
}
