/**
 * @file types.ts
 * @description Serialisable domain models, cross-process contracts, and type aliases.
 *
 * Constants, default values, and provider descriptors live in `src/shared/config/`.
 */

// Re-export constants for backward compatibility — consumers should migrate to
// importing from `@shared/config/*` directly.
export {
  APP_LOCALES,
  THEME_MODES,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  TIME_FORMATS,
  LOG_LEVELS,
  ICON_LAYOUT_MODES,
  PROVIDER_TYPES,
  DEFAULT_SMALL_MODEL_SELECTOR,
  REFRESH_MAX_MINUTES,
  VISUAL_SCALE_LIMITS,
} from './config/constants'

export { DEFAULT_NOTIFICATION, DEFAULT_SETTINGS } from './config/defaults'

export { PROVIDER_DESCRIPTORS } from './config/providers'

// ---------------------------------------------------------------------------
// Type aliases (derived from const arrays)
// ---------------------------------------------------------------------------

import type {
  APP_LOCALES as _APP_LOCALES,
  THEME_MODES as _THEME_MODES,
  NAVBAR_POSITIONS as _NAVBAR_POSITIONS,
  TIME_FORMATS as _TIME_FORMATS,
  LOG_LEVELS as _LOG_LEVELS,
  ICON_LAYOUT_MODES as _ICON_LAYOUT_MODES,
  PROVIDER_TYPES as _PROVIDER_TYPES,
} from './config/constants'

export type AppLocale = (typeof _APP_LOCALES)[number]
export type ThemeMode = (typeof _THEME_MODES)[number]
export type NavbarPosition = (typeof _NAVBAR_POSITIONS)[number]
export type TimeFormat = (typeof _TIME_FORMATS)[number]
export type LogLevel = (typeof _LOG_LEVELS)[number]
export type IconLayoutMode = (typeof _ICON_LAYOUT_MODES)[number]
export type ProviderType = (typeof _PROVIDER_TYPES)[number]
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Interval between automatic usage refreshes in minutes. */
export interface RefreshSettings {
  minute: number
}

/** Telegram bot delivery channel for threshold notifications. */
export interface TelegramSettings {
  token: string | null
  chatId: string
  enabled: boolean
}

/** Discord webhook delivery channel for threshold notifications. */
export interface DiscordSettings {
  webhookUrl: string | null
  username: string
  enabled: boolean
}

/** Threshold notification preferences shared across channels. */
export interface NotificationSettings {
  high: number
  critical: number
  telegram: TelegramSettings
  discord: DiscordSettings
  enabled: boolean
}

/** Defines how provider bars fill the tray icon. */
export interface TrayIconLayoutSettings {
  mode: IconLayoutMode
  bars: Record<string, number>
}

/** Tray icon and tooltip presentation preferences. */
export interface VisualSettings {
  scale: number
  iconLayout: TrayIconLayoutSettings
}

/** Small-model selector used to warm windows after a reset. */
export interface ModelSettings {
  smallModelSelector: string
}

/** A single persisted provider entry reconciled against the registered catalog. */
export interface ProviderSettings {
  name: string
  type: ProviderType
  credential: string | null
  apiKey: string | null
  enabled: boolean
  refreshToken: boolean
  id: string | null
  startWindowAfterReset: boolean | null
}

/** Static identity and presentation metadata for a supported provider. */
export interface ProviderDescriptor {
  id: string
  name: string
  displayOrder: number
  authenticationKind: ProviderType
  credentialName: string | null
  settingsOrder: number
  iconKey: string | null
  startWindowAfterReset: boolean
  /** True when the provider reports usage windows that can fill tray bars. */
  barProvider: boolean
}

export interface AppSettings {
  settingsRevision: 4
  uiLanguage: AppLocale
  theme: ThemeMode
  navbarPosition: NavbarPosition
  pageZoom: number
  timeFormat: TimeFormat
  startOnStartup: boolean
  alwaysOnTop: boolean
  showTrayIcon: boolean
  minimizeToTrayOnClose: boolean
  autoUpdate: boolean
  telemetryEnabled: boolean
  unattendedUpdates: boolean
  logLevel: LogLevel
  refresh: RefreshSettings
  notification: NotificationSettings
  visual: VisualSettings
  providers: ProviderSettings[]
  models: ModelSettings
}

export type AppSettingsPatch = {
  [Key in keyof Omit<AppSettings, 'settingsRevision'>]?: AppSettings[Key] | undefined
}

// ---------------------------------------------------------------------------
// Usage data pipeline
// ---------------------------------------------------------------------------

/** Severity of a threshold notification. */
export type NotificationLevel = 'reset' | 'high' | 'critical'

/** A single rolling usage window reported by a metric provider. */
export interface UsageWindow {
  providerName: string
  label: string
  usedPercent: number
  resetText?: string | null
  subLabel?: string | null
  resetAt?: string | null
}

/** A metric provider's result: usage windows plus an optional plan/tier label. */
export interface MetricResult {
  providerName: string
  plan?: string | null
  windows: UsageWindow[]
  notice?: string | null
}

/** A balance provider's result: pre-formatted balance plus raw amounts. */
export interface BalanceResult {
  providerName: string
  balanceText: string
  usdAmount?: number | null
  cnyAmount?: number | null
}

export type ProviderResult = MetricResult | BalanceResult

/** Aggregated results of one refresh across all configured providers. */
export interface UsageSnapshot {
  results: ProviderResult[]
  windows: UsageWindow[]
}

/** One metric row inside a tooltip card. */
export interface TooltipMetric {
  label: string
  percent: number
  detail: string
  sub?: string | null
}

/** One provider card pushed to the tooltip window. */
export interface TooltipCard {
  title: string
  plan?: string | null
  metrics: TooltipMetric[]
  lines: string[]
  hide?: boolean
  icon?: string | null
  notice?: string | null
}

/** Payload pushed to the renderer whenever a refresh completes. */
export interface UsageSnapshotEvent {
  cards: TooltipCard[]
  scale: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

/** Settings metadata resolved in the main process for the settings page. */
export interface SettingsStatePayload {
  settings: AppSettings
  environmentApiKeys: Record<string, string>
  version: string
}

export interface BootstrapPayload {
  settings: AppSettings
  platform: DesktopPlatform
  version: string
  /** Environment variables available as provider credentials. */
  environmentApiKeys: Record<string, string>
}

export interface RendererLogEntry {
  level: LogLevel
  module: string
  message: string
  details?: string
}

export interface UpdateStateEvent {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  releaseNotes?: string
  message?: string
  pageUrl?: string
}

// ---------------------------------------------------------------------------
// Renderer API contract (mirrored in preload)
// ---------------------------------------------------------------------------

export interface SessionLensApi {
  /** Loads persisted settings and application metadata. */
  bootstrap(): Promise<BootstrapPayload>
  /** Atomically merges and persists validated application settings fields. */
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  /** Changes the native always-on-top state. */
  setAlwaysOnTop(enabled: boolean): Promise<void>
  /** Minimises the main application window. */
  minimizeWindow(): Promise<void>
  /** Toggles maximised state and returns the resulting state. */
  toggleMaximizeWindow(): Promise<boolean>
  /** Closes the main application window. */
  closeWindow(): Promise<void>
  /** Reports whether the main application window is maximised. */
  isWindowMaximized(): Promise<boolean>
  /** Synchronises native window chrome with the resolved renderer theme. */
  setTheme(theme: Exclude<ThemeMode, 'system'>): Promise<void>
  /** Opens an allow-listed URL in the system browser. */
  openExternal(url: string): Promise<void>
  /** Opens the application log directory in the operating-system file manager. */
  openLogsDirectory(): Promise<void>
  /** Persists one validated renderer diagnostic through the main logger. */
  writeLog(entry: RendererLogEntry): void
  /** Checks GitHub Releases for an application update. */
  checkForUpdates(): Promise<void>
  /** Restarts and installs a downloaded update. */
  installUpdate(): Promise<void>
  /** Subscribes to updater lifecycle events. */
  onUpdateState(listener: (event: UpdateStateEvent) => void): () => void
  /** Subscribes to native maximise and restore state changes. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Subscribes to settings navigation requested from native desktop UI. */
  onSettingsOpenRequested(listener: () => void): () => void
  /** Resolves settings plus main-process metadata for the usage settings page. */
  getSettingsState(): Promise<SettingsStatePayload>
  /** Requests an immediate usage refresh through the running refresh loop. */
  requestUsageRefresh(): Promise<void>
  /** Sends a test threshold notification through every enabled channel. */
  sendTestNotification(): Promise<void>
  /** Returns the latest tooltip card snapshot produced by a refresh. */
  getUsageSnapshot(): Promise<UsageSnapshotEvent | null>
  /** Subscribes to usage snapshot updates produced by each completed refresh. */
  onUsageSnapshot(listener: (event: UsageSnapshotEvent) => void): () => void
}
