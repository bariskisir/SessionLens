/**
 * @file defaults.ts
 * @description Default application settings and notification configuration.
 */

import { PAGE_ZOOM_LIMITS, VISUAL_SCALE_LIMITS, DEFAULT_SMALL_MODEL_SELECTOR } from './constants'
import type { AppSettings, NotificationSettings } from '../types'

export const DEFAULT_NOTIFICATION: NotificationSettings = {
  high: 70,
  critical: 90,
  telegram: { token: null, chatId: '', enabled: false },
  discord: { webhookUrl: null, username: 'Session Lens', enabled: false },
  enabled: true,
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsRevision: 4,
  uiLanguage: 'en',
  theme: 'system',
  navbarPosition: 'top',
  pageZoom: PAGE_ZOOM_LIMITS.default,
  timeFormat: '24-hour',
  startOnStartup: true,
  alwaysOnTop: false,
  showTrayIcon: true,
  minimizeToTrayOnClose: true,
  autoUpdate: true,
  telemetryEnabled: true,
  unattendedUpdates: true,
  logLevel: 'info',
  refresh: { minute: 5 },
  notification: DEFAULT_NOTIFICATION,
  visual: {
    scale: VISUAL_SCALE_LIMITS.default,
    iconLayout: { mode: 'auto', bars: {} },
  },
  providers: [],
  models: { smallModelSelector: DEFAULT_SMALL_MODEL_SELECTOR },
}
