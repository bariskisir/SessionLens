/** Verifies Windows toast XML and strict notification protocol activation payloads. */

import { describe, expect, it } from 'vitest'
import {
  createEarthquakeNotificationUrl,
  createWindowsEarthquakeToastXml,
  parseEarthquakeNotificationUrl,
} from '../src/shared/earthquakeNotification'

const sessionId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

describe('earthquake notification activation', () => {
  it('round-trips the stored session through the custom protocol', () => {
    expect(parseEarthquakeNotificationUrl(createEarthquakeNotificationUrl(sessionId))).toEqual({
      sessionId,
    })
  })

  it('rejects unrelated, invalid, and unsupported activation URLs', () => {
    expect(parseEarthquakeNotificationUrl('https://example.com')).toBeNull()
    expect(
      parseEarthquakeNotificationUrl('earthquake-signal://notification?sessionId=invalid'),
    ).toBeNull()
  })

  it('escapes toast content and uses protocol activation without a system sound', () => {
    const url = createEarthquakeNotificationUrl(sessionId)
    const xml = createWindowsEarthquakeToastXml('M <5>', 'A & B', url, true)
    expect(xml).toContain('activationType="protocol"')
    expect(xml).toContain('sessionId=6ba7b810-9dad-41d1-80b4-00c04fd430c8')
    expect(xml).toContain('M &lt;5&gt;')
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('<audio silent="true" />')
  })
})
