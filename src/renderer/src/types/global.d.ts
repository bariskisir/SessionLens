/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { SessionLensApi } from '@shared/types'

declare global {
  interface Window {
    app: SessionLensApi
  }
}
