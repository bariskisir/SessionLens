/**
 * @file constants.ts
 * @description Application-wide constant arrays and limit objects shared between main and renderer processes.
 */

export const APP_LOCALES = ['en', 'tr', 'de', 'fr', 'pt', 'zh', 'es', 'ru', 'ja', 'ko'] as const

export const THEME_MODES = ['system', 'light', 'dark'] as const

export const NAVBAR_POSITIONS = ['left', 'top'] as const

/** Defines the supported page zoom range and control increment. */
export const PAGE_ZOOM_LIMITS = { min: 0.5, max: 2, step: 0.1, default: 1 } as const

export const TIME_FORMATS = ['24-hour', '12-hour'] as const

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const

export const ICON_LAYOUT_MODES = ['auto', 'manual'] as const

export const PROVIDER_TYPES = ['oauth', 'apiKey'] as const

export const DEFAULT_SMALL_MODEL_SELECTOR = 'nano,mini,haiku,lite,flash,oss'

export const REFRESH_MAX_MINUTES = 1440

export const VISUAL_SCALE_LIMITS = { min: 50, max: 1000, default: 110 } as const
