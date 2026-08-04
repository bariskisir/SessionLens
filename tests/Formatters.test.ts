/**
 * Verifies session metadata formatting helpers.
 */

import { describe, expect, it } from 'vitest'
import { formatDate, toSessionSummary } from '../src/renderer/src/utils/formatters'

describe('formatDate', () => {
  it('formats 24-hour dates', () => {
    const result = formatDate('2026-01-02T13:05:00.000Z', '24-hour')
    expect(result).toMatch(/^02\.01\.2026 \d{2}:\d{2}$/)
  })

  it('formats 12-hour dates with a period', () => {
    const result = formatDate('2026-01-02T13:05:00.000Z', '12-hour')
    expect(result).toMatch(/^02\.01\.2026 \d{2}:\d{2} (AM|PM)$/)
  })
})

describe('toSessionSummary', () => {
  it('copies generic session metadata', () => {
    const session = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Session',
      isDefaultTitle: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    expect(toSessionSummary(session)).toEqual(session)
  })

  it('includes earthquake coordinates needed by the overview map', () => {
    const session = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Earthquake',
      isDefaultTitle: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      earthquake: {
        id: 'event-1',
        kind: 'seismic-network' as const,
        source: 'test',
        latitude: 39.9,
        longitude: 32.8,
        receivedAt: '2026-01-01T00:00:00.000Z',
        magnitude: 4.7,
        place: 'Ankara',
        occurredAt: '2025-12-31T23:59:00.000Z',
      },
    }

    expect(toSessionSummary(session)).toMatchObject({
      magnitude: 4.7,
      latitude: 39.9,
      longitude: 32.8,
      place: 'Ankara',
      occurredAt: '2025-12-31T23:59:00.000Z',
    })
  })
})
