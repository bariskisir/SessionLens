/**
 * @file types.ts
 * @description Defines serializable domain models, cross-process application contracts, provider descriptors, and default settings.
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

export const ICON_LAYOUT_MODES = ['auto', 'manual'] as const
export type IconLayoutMode = (typeof ICON_LAYOUT_MODES)[number]

export const PROVIDER_TYPES = ['oauth', 'apiKey'] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

export const DEFAULT_SMALL_MODEL_SELECTOR = 'nano,mini,haiku,lite,flash,oss'
export const REFRESH_MAX_MINUTES = 1440
export const VISUAL_SCALE_LIMITS = { min: 50, max: 1000, default: 100 } as const

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

/** Registered provider catalog ordered by settings order then display order. */
export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: 'codex',
    name: 'Codex',
    displayOrder: 0,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 0,
    iconKey: 'openai',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    displayOrder: 10,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 1,
    iconKey: 'claude',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    displayOrder: 5,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 2,
    iconKey: 'antigravity',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    displayOrder: 100,
    authenticationKind: 'apiKey',
    credentialName: 'DEEPSEEK_API_KEY',
    settingsOrder: 3,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    displayOrder: 110,
    authenticationKind: 'apiKey',
    credentialName: 'OPENROUTER_API_KEY',
    settingsOrder: 4,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    displayOrder: 6,
    authenticationKind: 'apiKey',
    credentialName: 'COMMANDCODE_API_KEY',
    settingsOrder: 5,
    iconKey: 'commandcode',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    displayOrder: 5,
    authenticationKind: 'apiKey',
    credentialName: 'COPILOT_API_KEY',
    settingsOrder: 12,
    iconKey: 'copilot',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'warp',
    name: 'Warp',
    displayOrder: 13,
    authenticationKind: 'apiKey',
    credentialName: 'WARP_API_KEY',
    settingsOrder: 15,
    iconKey: 'warp',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'synthetic',
    name: 'Synthetic',
    displayOrder: 15,
    authenticationKind: 'apiKey',
    credentialName: 'SYNTHETIC_API_KEY',
    settingsOrder: 17,
    iconKey: 'synthetic',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'chutes',
    name: 'Chutes',
    displayOrder: 17,
    authenticationKind: 'apiKey',
    credentialName: 'CHUTES_API_KEY',
    settingsOrder: 18,
    iconKey: 'chutes',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'zai',
    name: 'Zai',
    displayOrder: 19,
    authenticationKind: 'apiKey',
    credentialName: 'ZAI_API_KEY',
    settingsOrder: 16,
    iconKey: 'zai',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    displayOrder: 20,
    authenticationKind: 'apiKey',
    credentialName: 'ELEVENLABS_API_KEY',
    settingsOrder: 8,
    iconKey: 'elevenlabs',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'alibaba',
    name: 'Alibaba',
    displayOrder: 23,
    authenticationKind: 'apiKey',
    credentialName: 'ALIBABA_API_KEY',
    settingsOrder: 21,
    iconKey: 'alibaba',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    displayOrder: 25,
    authenticationKind: 'apiKey',
    credentialName: 'MINIMAX_API_KEY',
    settingsOrder: 19,
    iconKey: 'minimax',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'kilo',
    name: 'Kilo',
    displayOrder: 30,
    authenticationKind: 'apiKey',
    credentialName: 'KILO_API_KEY',
    settingsOrder: 9,
    iconKey: 'kilo',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    displayOrder: 40,
    authenticationKind: 'apiKey',
    credentialName: 'CODEBUFF_API_KEY',
    settingsOrder: 22,
    iconKey: 'codebuff',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    displayOrder: 105,
    authenticationKind: 'apiKey',
    credentialName: 'OPENAI_API_KEY',
    settingsOrder: 10,
    iconKey: 'openai',
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'venice',
    name: 'Venice',
    displayOrder: 108,
    authenticationKind: 'apiKey',
    credentialName: 'VENICE_API_KEY',
    settingsOrder: 11,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'zenmux',
    name: 'ZenMux',
    displayOrder: 111,
    authenticationKind: 'apiKey',
    credentialName: 'ZENMUX_MANAGEMENT_API_KEY',
    settingsOrder: 6,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'crof',
    name: 'Crof',
    displayOrder: 112,
    authenticationKind: 'apiKey',
    credentialName: 'CROF_API_KEY',
    settingsOrder: 13,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    displayOrder: 115,
    authenticationKind: 'apiKey',
    credentialName: 'MOONSHOT_API_KEY',
    settingsOrder: 7,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'poe',
    name: 'Poe',
    displayOrder: 118,
    authenticationKind: 'apiKey',
    credentialName: 'POE_API_KEY',
    settingsOrder: 20,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    displayOrder: 120,
    authenticationKind: 'apiKey',
    credentialName: 'DEEPGRAM_API_KEY',
    settingsOrder: 14,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
]

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

export interface SessionLensApi {
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
