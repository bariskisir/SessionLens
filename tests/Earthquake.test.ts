/** Verifies fixed topic naming and coordinate distance calculations. */

import { describe, expect, it } from 'vitest'
import { createFirebaseTopicMembershipUrl } from '../src/main/earthquakeNetworkConfig'
import {
  calculateDistanceKm,
  calculateDestinationCoordinates,
  calculateEarthquakeWaveState,
  createEarthquakeTileTopic,
  createEarthquakeTopics,
  estimateEarthquakeNetworkIntensity,
  getEarthquakeMarkerRadius,
} from '../src/shared/earthquake'

describe('earthquake utilities', () => {
  it('builds the official Firebase installation topic endpoints used by the APK', () => {
    expect(
      createFirebaseTopicMembershipUrl('project', 'installation-id', 'x20y12', 'subscribe'),
    ).toBe(
      'https://fcmregistrations.googleapis.com/v1/projects/project/registrations/installation-id/topicSubscriptions/x20y12:subscribe',
    )
  })

  it('uses global and Ankara fixed ten-degree tile topics', () => {
    expect(createEarthquakeTileTopic(39.9334, 32.8597)).toBe('x21y12')
    expect(createEarthquakeTopics(39.9334, 32.8597)).toEqual(['global', 'x21y12'])
  })

  it('keeps negative coordinates in deterministic tile names', () => {
    expect(createEarthquakeTileTopic(-1, -1)).toBe('x17y8')
  })

  it('calculates a realistic Ankara to Istanbul surface distance', () => {
    expect(calculateDistanceKm(39.9334, 32.8597, 41.0082, 28.9784)).toBeCloseTo(352, -1)
  })

  it('places test events at the requested distance and bearing', () => {
    const destination = calculateDestinationCoordinates(39.9334, 32.8597, 300, 125)
    expect(calculateDistanceKm(39.9334, 32.8597, destination[0], destination[1])).toBeCloseTo(
      300,
      6,
    )
  })

  it('calculates realtime wave radius and remaining arrival seconds', () => {
    expect(calculateEarthquakeWaveState(35, 5)).toEqual({
      radiusKm: 17.5,
      remainingSeconds: 5,
      arrived: false,
    })
    expect(calculateEarthquakeWaveState(35, 12)).toEqual({
      radiusKm: 42,
      remainingSeconds: 0,
      arrived: true,
    })
    expect(calculateEarthquakeWaveState(35, 2, 3.5, 3)).toEqual({
      radiusKm: 17.5,
      remainingSeconds: 5,
      arrived: false,
    })
  })

  it('matches the APK local-intensity attenuation formula', () => {
    expect(estimateEarthquakeNetworkIntensity(5, 100)).toBeCloseTo(3.16, 2)
    expect(estimateEarthquakeNetworkIntensity(4, 100)).toBeCloseTo(2.13, 2)
  })

  it('scales overview-map markers across the five magnitude bands', () => {
    expect(getEarthquakeMarkerRadius(undefined)).toBe(5)
    expect(getEarthquakeMarkerRadius(3.9)).toBe(5)
    expect(getEarthquakeMarkerRadius(4)).toBe(8)
    expect(getEarthquakeMarkerRadius(5)).toBe(12)
    expect(getEarthquakeMarkerRadius(6)).toBe(17)
    expect(getEarthquakeMarkerRadius(7)).toBe(23)
    expect(getEarthquakeMarkerRadius(9.2)).toBe(23)
  })
})
