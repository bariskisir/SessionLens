/**
 * Defines serializable domain models and cross-process application contracts.
 */

export const APP_LOCALES = ['en', 'tr', 'de', 'fr', 'pt', 'zh', 'es', 'ru', 'ja', 'ko'] as const
export const THEME_MODES = ['system', 'light', 'dark'] as const
export const NAVBAR_POSITIONS = ['left', 'top'] as const
/** Defines the supported page zoom range and control increment. */
export const PAGE_ZOOM_LIMITS = { min: 0.5, max: 2, step: 0.1, default: 1 } as const
export const TIME_FORMATS = ['24-hour', '12-hour'] as const
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const

export type AppLocale = (typeof APP_LOCALES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type NavbarPosition = (typeof NAVBAR_POSITIONS)[number]
export type TimeFormat = (typeof TIME_FORMATS)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'

export interface AppSettings {
  settingsRevision: 3
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
  unattendedUpdates: boolean
  logLevel: LogLevel
}

export type AppSettingsPatch = {
  [Key in keyof Omit<AppSettings, 'settingsRevision'>]?: AppSettings[Key] | undefined
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsRevision: 3,
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
  unattendedUpdates: true,
  logLevel: 'info',
}

export interface BootstrapPayload {
  settings: AppSettings
  platform: DesktopPlatform
  version: string
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

export interface LensApi {
  /** Loads persisted settings and application metadata. */
  bootstrap(): Promise<BootstrapPayload>
  /** Atomically merges and persists validated application settings fields. */
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  /** Changes the native always-on-top state. */
  setAlwaysOnTop(enabled: boolean): Promise<void>
  /** Minimizes the main application window. */
  minimizeWindow(): Promise<void>
  /** Toggles maximized state and returns the resulting state. */
  toggleMaximizeWindow(): Promise<boolean>
  /** Closes the main application window. */
  closeWindow(): Promise<void>
  /** Reports whether the main application window is maximized. */
  isWindowMaximized(): Promise<boolean>
  /** Synchronizes native window chrome with the resolved renderer theme. */
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
  /** Subscribes to native maximize and restore state changes. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Subscribes to settings navigation requested from native desktop UI. */
  onSettingsOpenRequested(listener: () => void): () => void
}
