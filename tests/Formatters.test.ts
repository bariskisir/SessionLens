/**
 * Verifies date formatting helpers.
 */

import { describe, expect, it } from 'vitest'
import { formatDate } from '../src/renderer/src/utils/formatters'

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
