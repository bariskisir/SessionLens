/**
 * @file index.ts
 * @description Electron app lifecycle — delegates service composition to the provider registry and factory helpers.
 */

import { app, BrowserWindow, Menu, Notification } from 'electron'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import { configureStartOnLogin, isHiddenStartupLaunch } from './startup'
import AppUpdater from './services/AppUpdater'
import LoggerService from './services/LoggerService'
import StorageService from './services/StorageService'
import TrayService from './services/TrayService'
import WindowService from './services/WindowService'
import UsageAggregator from './services/usage/UsageAggregator'
import UsageRefreshService from './services/usage/UsageRefreshService'
import UsageWindowStartService from './services/usage/UsageWindowStartService'
import WindowStartRequestSender from './services/usage/WindowStartRequestSender'
import NotificationDispatcher from './services/usage/NotificationDispatcher'
import CodexAuthReader from './services/usage/CodexAuthReader'
import ClaudeAuthReader from './services/usage/ClaudeAuthReader'
import AntigravityAuthReader from './services/usage/AntigravityAuthReader'
import { ALL_PROVIDERS } from './providers/registry'
import { probeConfiguredProviderIds } from './providers/CredentialProbe'
import type { NotificationLevel } from '@shared/types'
import { IpcChannel } from '@shared/IpcChannel'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('wm-window-animations-disabled')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-direct-composition')
app.disableHardwareAcceleration()
app.setName('Session Lens')
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

const productApplicationUserModelId = 'com.bariskisir.sessionlens'
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? productApplicationUserModelId : 'Session Lens')
}

const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null
let refreshService: UsageRefreshService | null = null

const emitNativeNotification = (level: NotificationLevel, message: string): void => {
  try {
    if (trayService?.showNotification(level, message)) return
    const notification = new Notification({ body: message, silent: false })
    notification.show()
  } catch (error) {
    loggerService?.error('Application', 'Native notification could not be shown.', error)
  }
}

const openApplicationWindow = async (startHidden = false): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot, probeConfiguredProviderIds)
  await storage.initialize()
  const settings = await storage.loadSettings()
  configureStartOnLogin(app, process.platform, settings.startOnStartup)

  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger

  const updater = new AppUpdater(logger)
  updater.applySettings(settings)

  const window = await windowService.createWindow(logger, !startHidden)

  trayService?.dispose()
  const tray = new TrayService(
    window,
    startHidden ? { ...settings, showTrayIcon: true } : settings,
    logger,
  )
  trayService = tray

  // Wire usage pipeline from the shared provider registry
  const aggregator = new UsageAggregator(ALL_PROVIDERS, logger)
  const notifications = new NotificationDispatcher(logger)

  const codexAuth = new CodexAuthReader()
  const claudeAuth = new ClaudeAuthReader()
  const antigravityAuth = new AntigravityAuthReader()
  const windowStartSender = new WindowStartRequestSender(
    codexAuth,
    claudeAuth,
    antigravityAuth,
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

  if (startHidden) {
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
