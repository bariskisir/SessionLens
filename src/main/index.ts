/**
 * @file index.ts
 * @description Composes main-process services, initializes application paths, and controls the Electron app lifecycle.
 */

import { app, BrowserWindow, Notification } from 'electron'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import { configureStartOnLogin, isHiddenStartupLaunch } from './startup'
import AppUpdater from './services/AppUpdater'
import LoggerService from './services/LoggerService'
import StorageService from './services/StorageService'
import TrayService from './services/TrayService'
import WindowService from './services/WindowService'
import CodexAuthReader from './services/usage/CodexAuthReader'
import ClaudeAuthReader from './services/usage/ClaudeAuthReader'
import AntigravityAuthReader from './services/usage/AntigravityAuthReader'
import UsageAggregator from './services/usage/UsageAggregator'
import UsageRefreshService from './services/usage/UsageRefreshService'
import UsageWindowStartService from './services/usage/UsageWindowStartService'
import WindowStartRequestSender from './services/usage/WindowStartRequestSender'
import NotificationDispatcher from './services/usage/NotificationDispatcher'
import CodexProvider from './services/usage/providers/CodexProvider'
import ClaudeProvider from './services/usage/providers/ClaudeProvider'
import DeepSeekProvider from './services/usage/providers/DeepSeekProvider'
import OpenRouterProvider from './services/usage/providers/OpenRouterProvider'
import AntigravityProvider from './services/usage/providers/AntigravityProvider'
import CommandCodeProvider from './services/usage/providers/CommandCodeProvider'
import CopilotProvider from './services/usage/providers/CopilotProvider'
import WarpProvider from './services/usage/providers/WarpProvider'
import SyntheticProvider from './services/usage/providers/SyntheticProvider'
import ChutesProvider from './services/usage/providers/ChutesProvider'
import ZaiProvider from './services/usage/providers/ZaiProvider'
import ElevenLabsProvider from './services/usage/providers/ElevenLabsProvider'
import AlibabaProvider from './services/usage/providers/AlibabaProvider'
import MiniMaxProvider from './services/usage/providers/MiniMaxProvider'
import KiloProvider from './services/usage/providers/KiloProvider'
import CodebuffProvider from './services/usage/providers/CodebuffProvider'
import OpenAIProvider from './services/usage/providers/OpenAIProvider'
import VeniceProvider from './services/usage/providers/VeniceProvider'
import ZenMuxProvider from './services/usage/providers/ZenMuxProvider'
import CrofProvider from './services/usage/providers/CrofProvider'
import MoonshotProvider from './services/usage/providers/MoonshotProvider'
import PoeProvider from './services/usage/providers/PoeProvider'
import DeepgramProvider from './services/usage/providers/DeepgramProvider'
import type { NotificationLevel } from '@shared/types'
import { IpcChannel } from '@shared/IpcChannel'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.disableHardwareAcceleration()
app.setName('Session Lens')
const productApplicationUserModelId = 'com.bariskisir.sessionlens'
if (process.platform === 'win32') {
  // Match the Start Menu shortcut created by electron-builder so Windows attributes
  // toast notifications to Session Lens instead of the Electron host process.
  app.setAppUserModelId(app.isPackaged ? productApplicationUserModelId : 'Session Lens')
}
const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null
let refreshService: UsageRefreshService | null = null

/**
 * Emits a native OS notification from the main process.
 *
 * @param level - Notification severity level
 * @param message - Formatted notification body message
 */
const emitNativeNotification = (level: NotificationLevel, message: string): void => {
  try {
    if (trayService?.showNotification(level, message)) return
    const notification = new Notification({
      body: message,
      silent: false,
    })
    notification.show()
  } catch (error) {
    loggerService?.error('Application', 'Native notification could not be shown.', error)
  }
}

/**
 * Creates all services and binds them to a newly opened application window.
 *
 * @param startHidden - Whether to initialize the window hidden in system tray
 */
const openApplicationWindow = async (startHidden = false): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot)
  await storage.initialize()
  const settings = await storage.loadSettings()
  configureStartOnLogin(app, process.platform, settings.startOnStartup)
  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger
  const updater = new AppUpdater(logger)
  updater.applySettings(settings)
  const shouldStartHidden = startHidden
  const window = await windowService.createWindow(logger, !shouldStartHidden)
  trayService?.dispose()
  const tray = new TrayService(
    window,
    shouldStartHidden ? { ...settings, showTrayIcon: true } : settings,
    logger,
  )
  trayService = tray

  const codexAuthReader = new CodexAuthReader()
  const claudeAuthReader = new ClaudeAuthReader()
  const antigravityAuthReader = new AntigravityAuthReader()
  const aggregator = new UsageAggregator(
    {
      codex: new CodexProvider(codexAuthReader),
      claude: new ClaudeProvider(claudeAuthReader),
      deepseek: new DeepSeekProvider(),
      openrouter: new OpenRouterProvider(),
      antigravity: new AntigravityProvider(antigravityAuthReader),
      commandcode: new CommandCodeProvider(),
      copilot: new CopilotProvider(),
      warp: new WarpProvider(),
      synthetic: new SyntheticProvider(),
      chutes: new ChutesProvider(),
      zai: new ZaiProvider(),
      elevenlabs: new ElevenLabsProvider(),
      alibaba: new AlibabaProvider(),
      minimax: new MiniMaxProvider(),
      kilo: new KiloProvider(),
      codebuff: new CodebuffProvider(),
      openai: new OpenAIProvider(),
      venice: new VeniceProvider(),
      zenmux: new ZenMuxProvider(),
      crof: new CrofProvider(),
      moonshot: new MoonshotProvider(),
      poe: new PoeProvider(),
      deepgram: new DeepgramProvider(),
    },
    logger,
  )
  const notifications = new NotificationDispatcher(logger)
  const windowStartSender = new WindowStartRequestSender(
    codexAuthReader,
    claudeAuthReader,
    antigravityAuthReader,
    logger,
  )
  const windowStart = new UsageWindowStartService(windowStartSender, logger)
  refreshService?.stop()
  refreshService = new UsageRefreshService(
    storage,
    aggregator,
    tray,
    notifications,
    logger,
    emitNativeNotification,
    (event) => {
      if (!window.isDestroyed()) window.webContents.send(IpcChannel.UsageSnapshotChanged, event)
    },
    windowStart,
  )
  tray.setRefreshHandler(() => refreshService?.requestManualRefresh())

  window.on('close', (event) => {
    if (!tray.shouldMinimizeOnClose()) return
    event.preventDefault()
    window.hide()
  })
  registerIpc(window, { storage, tray, updater, logger, usage: refreshService })

  void refreshService.start().catch((error: unknown) => {
    logger.error('Application', 'Usage refresh loop failed.', error)
  })

  if (shouldStartHidden) {
    logger.info('Application', 'Session Lens started hidden in the system tray.')
  }

  logger.info('Application', 'Session Lens desktop started.', {
    version: app.getVersion(),
    platform: process.platform,
  })
  if (settings.autoUpdate && app.isPackaged) {
    void updater.checkForUpdates().catch((error: unknown) => {
      logger.warn('Application', 'Startup update check failed.', error)
    })
  }
}

/**
 * Opens a replacement window when activated (e.g. macOS dock click) and records initialization failures.
 */
const reopenApplicationWindow = (): void => {
  void openApplicationWindow().catch((error: unknown) => {
    loggerService?.error('Application', 'Application window could not be reopened.', error)
  })
}

process.on('uncaughtException', (error) =>
  loggerService?.error('Application', 'Uncaught exception.', error),
)
process.on('unhandledRejection', (error) =>
  loggerService?.error('Application', 'Unhandled rejection.', error),
)

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const window = windowService.getMainWindow()
    if (!window) return
    if (isHiddenStartupLaunch(argv)) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      await openApplicationWindow(isHiddenStartupLaunch(process.argv))
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) reopenApplicationWindow()
      })
    })
    .catch((error: unknown) => {
      loggerService?.error('Application', 'Application initialization failed.', error)
      app.quit()
    })
}

app.on('before-quit', () => {
  trayService?.prepareToQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

