/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { EarthquakeSignalApi } from '@shared/types'

declare global {
  interface Window {
    app: EarthquakeSignalApi
  }
}
