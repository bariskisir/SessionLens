/**
 * Centralizes persisted and IPC settings validation.
 */

import {
  APP_LOCALES,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  TIME_FORMATS,
  THEME_MODES,
  type AppSettings,
} from '@shared/types'
import { z } from 'zod'

const settingsFieldsSchema = z.object({
  settingsRevision: z.literal(3),
  uiLanguage: z.enum(APP_LOCALES),
  theme: z.enum(THEME_MODES),
  navbarPosition: z.enum(NAVBAR_POSITIONS),
  pageZoom: z.number().min(PAGE_ZOOM_LIMITS.min).max(PAGE_ZOOM_LIMITS.max),
  timeFormat: z.enum(TIME_FORMATS),
  startOnStartup: z.boolean(),
  alwaysOnTop: z.boolean(),
  showTrayIcon: z.boolean(),
  minimizeToTrayOnClose: z.boolean(),
  autoUpdate: z.boolean(),
  unattendedUpdates: z.boolean(),
  logLevel: z.enum(LOG_LEVELS),
})

export const settingsSchema = settingsFieldsSchema.superRefine((settings, context) => {
  if (settings.minimizeToTrayOnClose && !settings.showTrayIcon) {
    context.addIssue({
      code: 'custom',
      path: ['minimizeToTrayOnClose'],
      message: 'Minimize to tray requires the tray icon to be enabled.',
    })
  }
})

export const settingsPatchSchema = settingsFieldsSchema
  .omit({ settingsRevision: true })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one setting must be provided.')

/** Returns an object record only when a persisted value can contain named settings. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Migrates persisted generic settings and drops fields owned by removed features. */
export const parsePersistedSettings = (input: unknown): AppSettings => {
  const persisted = asRecord(input)
  if (!persisted) return structuredClone(DEFAULT_SETTINGS)

  const candidate = { ...DEFAULT_SETTINGS, ...persisted, settingsRevision: 3 }
  const parsed = settingsSchema.safeParse(candidate)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS)
}
