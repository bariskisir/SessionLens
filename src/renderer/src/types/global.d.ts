/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { LensApi } from '@shared/types'

declare global {
  interface Window {
    app: LensApi
  }
}
