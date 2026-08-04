/** Verifies the shared sidebar and overview-map magnitude filtering rule. */

import { describe, expect, it } from 'vitest'
import { filterSessionsByMagnitude } from '../src/shared/earthquakeFilters'
import type { SessionSummary } from '../src/shared/types'

const summary = (id: string, magnitude?: number): SessionSummary => ({
  id,
  title: id,
  isDefaultTitle: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...(magnitude !== undefined ? { magnitude } : {}),
})

describe('filterSessionsByMagnitude', () => {
  const sessions = [summary('unknown'), summary('low', 3.9), summary('four', 4), summary('five', 5)]

  it('keeps every session in the all view', () => {
    expect(filterSessionsByMagnitude(sessions, 'all')).toEqual(sessions)
  })

  it('keeps only sessions at or above the selected threshold', () => {
    expect(filterSessionsByMagnitude(sessions, '3').map(({ id }) => id)).toEqual([
      'low',
      'four',
      'five',
    ])
    expect(filterSessionsByMagnitude(sessions, '4').map(({ id }) => id)).toEqual(['four', 'five'])
    expect(filterSessionsByMagnitude(sessions, '5').map(({ id }) => id)).toEqual(['five'])
  })
})
