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
export const EARTHQUAKE_NOTIFICATION_PRESENTATIONS = ['fullscreen', 'normal'] as const

export type AppLocale = (typeof APP_LOCALES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type NavbarPosition = (typeof NAVBAR_POSITIONS)[number]
export type TimeFormat = (typeof TIME_FORMATS)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]
export type EarthquakeNotificationPresentation =
  (typeof EARTHQUAKE_NOTIFICATION_PRESENTATIONS)[number]
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'
/** Selects all earthquakes or those at-or-above one supported magnitude threshold. */
export type EarthquakeFilter = 'all' | '3' | '4' | '5'

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
  earthquakeLatitude: number
  earthquakeLongitude: number
  fcmCheckIntervalMinutes: number
  realtimeAlertsEnabled: boolean
  realtimeSilentWhenMild: boolean
  realtimeNotificationPresentation: EarthquakeNotificationPresentation
  seismicNotificationsEnabled: boolean
  seismicMinimumMagnitude: number
  seismicMaximumDistanceKm: number
  seismicNotificationPresentation: EarthquakeNotificationPresentation
  earthquakeFilter: EarthquakeFilter
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
  earthquakeLatitude: 40,
  earthquakeLongitude: 32,
  fcmCheckIntervalMinutes: 480,
  realtimeAlertsEnabled: true,
  realtimeSilentWhenMild: false,
  realtimeNotificationPresentation: 'fullscreen',
  seismicNotificationsEnabled: true,
  seismicMinimumMagnitude: 4,
  seismicMaximumDistanceKm: 1_000,
  seismicNotificationPresentation: 'normal',
  earthquakeFilter: 'all',
}

export type EarthquakeEventKind = 'realtime' | 'seismic-network'

/** Represents one normalized earthquake push message stored as a local session. */
export interface EarthquakeEvent {
  id: string
  kind: EarthquakeEventKind
  source: string
  latitude: number
  longitude: number
  receivedAt: string
  occurredAt?: string | undefined
  magnitude?: number | undefined
  depthKm?: number | undefined
  place?: string | undefined
  revision?: number | undefined
  sourceIntensity?: number | undefined
  estimatedIntensity?: number | undefined
  waveSpeedKmPerSecond?: number | undefined
  alertDelaySeconds?: number | undefined
  distanceKm?: number | undefined
  magnitudeRange?: number | undefined
  reportCount?: number | undefined
  providerData?: string | undefined
  warning?: string | undefined
}

export interface SessionDocument {
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
  earthquake?: EarthquakeEvent | undefined
  magnitude?: number | undefined
}

export interface SessionSummary {
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
  magnitude?: number | undefined
  latitude?: number | undefined
  longitude?: number | undefined
  place?: string | undefined
  occurredAt?: string | undefined
}

export interface BootstrapPayload {
  settings: AppSettings
  sessions: SessionSummary[]
  currentSession: SessionDocument | null
  platform: DesktopPlatform
  version: string
  earthquakeStatus: EarthquakeServiceStatus
}

export type EarthquakeConnectionState =
  'not-configured' | 'connecting' | 'connected' | 'disconnected' | 'error'

/** Reports FCM registration and the next user-configured health check. */
export interface EarthquakeServiceStatus {
  state: EarthquakeConnectionState
  topics: string[]
  subscribedTopics: string[]
  token?: string
  backendUserId?: string
  backendRegistered?: boolean
  tileRegistered?: boolean
  locationSynchronized?: boolean
  topicMembershipConfirmed?: boolean
  firebaseInstallationId?: string
  gcmAndroidId?: string
  gcmAppId?: string
  firebaseProjectId?: string
  packageId?: string
  installationCreatedAt?: string
  authTokenExpiresAt?: string
  persistentMessageCount?: number
  lastCheckedAt?: string
  nextCheckAt?: string
  message?: string
}

/** Delivers a newly persisted earthquake and its notification presentation. */
export interface EarthquakeReceivedEvent {
  session: SessionDocument
  presentation: EarthquakeNotificationPresentation | 'none'
  shouldAlarm: boolean
}

/** Identifies the stored event and home view requested by a clicked notification. */
export interface EarthquakeNotificationOpenEvent {
  sessionId: string
}

export interface DeleteSessionResult {
  deleted: boolean
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

export interface EarthquakeSignalApi {
  /** Loads persisted settings, session list, and application metadata. */
  bootstrap(): Promise<BootstrapPayload>
  /** Atomically merges and persists validated application settings fields. */
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  /** Loads one complete session. */
  getSession(id: string): Promise<SessionDocument>
  /** Renames one session and returns the updated document. */
  renameSession(id: string, title: string): Promise<SessionDocument>
  /** Deletes one session. */
  deleteSession(id: string): Promise<DeleteSessionResult>
  /** Deletes sessions visible under the selected earthquake magnitude filter. */
  deleteAllSessions(filter: EarthquakeFilter): Promise<string[]>
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
  /** Reconnects FCM and refreshes the token/topic gateway immediately. */
  refreshEarthquakeConnection(): Promise<EarthquakeServiceStatus>
  /** Deletes the local FCM identity and creates a completely new registration. */
  resetEarthquakeRegistration(): Promise<EarthquakeServiceStatus>
  /** Simulates one event through the production persistence and notification pipeline. */
  testEarthquake(kind: EarthquakeEventKind): Promise<SessionDocument>
  /** Closes the renderer alert and restores the main window from fullscreen. */
  dismissFullscreenEarthquake(): Promise<void>
  /** Subscribes to updater lifecycle events. */
  onUpdateState(listener: (event: UpdateStateEvent) => void): () => void
  /** Subscribes to native maximize and restore state changes. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Subscribes to settings navigation requested from native desktop UI. */
  onSettingsOpenRequested(listener: () => void): () => void
  /** Subscribes to FCM lifecycle status updates. */
  onEarthquakeStatus(listener: (status: EarthquakeServiceStatus) => void): () => void
  /** Subscribes to newly received and persisted earthquakes. */
  onEarthquakeReceived(listener: (event: EarthquakeReceivedEvent) => void): () => void
  /** Subscribes to a native earthquake notification activation. */
  onEarthquakeNotificationOpened(
    listener: (event: EarthquakeNotificationOpenEvent) => void,
  ): () => void
}
