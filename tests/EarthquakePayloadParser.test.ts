/** Verifies normalization of the APK's real-time, official, and ignored FCM message types. */

import type { Types } from '@eneris/push-receiver/dist/client'
import { describe, expect, it } from 'vitest'
import { parseEarthquakeEnvelope } from '../src/main/services/EarthquakePayloadParser'

const envelope = (data: Record<string, unknown>, persistentId = 'persistent-1') =>
  ({ message: { data }, persistentId }) satisfies Types.MessageEnvelope

describe('EarthquakePayloadParser', () => {
  it('keeps source intensity separate and reproduces realtime timing fields', () => {
    const parsed = parseEarthquakeEnvelope(
      envelope({
        type: 'eqn',
        latitude: '0',
        longitude: '0.8993',
        mag: '5',
        intensity: '9',
        wave_speed: '3.5',
        delay: '4.25',
        code: '321',
        upd: '2',
        datetime: '2026-07-28T12:00:00.000Z',
        location: 'Test location',
      }),
      0,
      0,
    )

    expect(parsed).toMatchObject({
      kind: 'realtime',
      magnitude: 5,
      sourceIntensity: 9,
      estimatedIntensity: 3.2,
      waveSpeedKmPerSecond: 3.5,
      alertDelaySeconds: 4.25,
      revision: 2,
      place: 'Test location',
    })
  })

  it('preserves official-network metadata', () => {
    const parsed = parseEarthquakeEnvelope(
      envelope({
        type: 'official',
        latitude: '39.1',
        longitude: '28.2',
        magnitude: '4.6',
        magnitude_range: '0.2',
        reports: '14',
        data: '2026-07-28T13:00:00.000Z',
        place: 'Western Türkiye',
        provider: 'Example Network',
      }),
      40,
      32,
    )

    expect(parsed).toMatchObject({
      kind: 'seismic-network',
      magnitude: 4.6,
      magnitudeRange: 0.2,
      reportCount: 14,
      providerData: '2026-07-28T13:00:00.000Z',
      occurredAt: '2026-07-28T13:00:00.000Z',
      place: 'Western Türkiye',
      source: 'Example Network',
    })
  })

  it('does not mislabel manual or social messages as seismic-network earthquakes', () => {
    expect(
      parseEarthquakeEnvelope(
        envelope({ type: 'manual', latitude: '40', longitude: '32', place: 'Report' }),
        40,
        32,
      ),
    ).toBeNull()
    expect(
      parseEarthquakeEnvelope(
        envelope({ type: 'chat_public', latitude: '40', longitude: '32' }),
        40,
        32,
      ),
    ).toBeNull()
  })

  it('uses numeric alert codes to upsert revisions under one stable event id', () => {
    const first = parseEarthquakeEnvelope(
      envelope({ type: 'eqn', latitude: 40, longitude: 32, mag: 4, code: 77, upd: 1 }),
      40,
      32,
    )
    const second = parseEarthquakeEnvelope(
      envelope({ type: 'eqn', latitude: 40.1, longitude: 32.1, mag: 4.2, code: 77, upd: 2 }),
      40,
      32,
    )

    expect(first?.id).toBe(second?.id)
  })
})
