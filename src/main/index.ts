/**
 * Composes main-process services and controls the application lifecycle.
 */

import { app, BrowserWindow } from 'electron'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import { configureStartOnLogin, isHiddenStartupLaunch } from './startup'
import AppUpdater from './services/AppUpdater'
import LoggerService from './services/LoggerService'
import StorageService from './services/StorageService'
import TrayService from './services/TrayService'
import WindowService from './services/WindowService'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const productApplicationUserModelId = 'com.bariskisir.lens'
const applicationUserModelId = app.isPackaged
  ? productApplicationUserModelId
  : `${productApplicationUserModelId}.development`
if (process.platform === 'win32') {
  app.setAppUserModelId(applicationUserModelId)
}
const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null

/** Creates all services and binds them to a newly opened window. */
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

  window.on('close', (event) => {
    if (!tray.shouldMinimizeOnClose()) return
    event.preventDefault()
    window.hide()
  })
  registerIpc(window, { storage, tray, updater, logger })

  if (shouldStartHidden) {
    logger.info('Application', 'Lens started hidden in the system tray.')
  }

  logger.info('Application', 'Lens desktop started.', {
    version: app.getVersion(),
    platform: process.platform,
  })
  if (settings.autoUpdate && app.isPackaged) {
    void updater.checkForUpdates().catch((error: unknown) => {
      logger.warn('Application', 'Startup update check failed.', error)
    })
  }
}

/** Opens a replacement macOS window and records initialization failures. */
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
