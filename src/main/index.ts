/**
 * Composes main-process services and controls the application lifecycle.
 */

import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import {
  EARTHQUAKE_NOTIFICATION_PROTOCOL,
  parseEarthquakeNotificationUrl,
} from '@shared/earthquakeNotification'
import type { EarthquakeNotificationOpenEvent } from '@shared/types'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import { configureStartOnLogin, isHiddenStartupLaunch } from './startup'
import AppUpdater from './services/AppUpdater'
import EarthquakeService from './services/EarthquakeService'
import LoggerService from './services/LoggerService'
import StorageService from './services/StorageService'
import TrayService from './services/TrayService'
import WindowService from './services/WindowService'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const productApplicationUserModelId = 'com.bariskisir.earthquakesignal'
const applicationUserModelId = app.isPackaged
  ? productApplicationUserModelId
  : `${productApplicationUserModelId}.development`
const developmentToastActivatorClsid = '{5AAEFD93-CF8E-47D7-A64B-B4C444502C09}'
if (process.platform === 'win32') {
  app.setAppUserModelId(applicationUserModelId)
  if (!app.isPackaged) app.setToastActivatorCLSID(developmentToastActivatorClsid)
}
const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null
let earthquakeService: EarthquakeService | null = null

/** Parses one validated notification protocol URL from process launch arguments. */
const parseNotificationActivation = (argv: string[]): EarthquakeNotificationOpenEvent | null => {
  const argument = argv.find((value) => value.startsWith(`${EARTHQUAKE_NOTIFICATION_PROTOCOL}://`))
  return argument ? parseEarthquakeNotificationUrl(argument) : null
}

/** Registers Windows toast identity, protocol activation, and the development launch shortcut. */
const configureWindowsNotificationIntegration = (logger: LoggerService): void => {
  if (process.platform !== 'win32') return
  const protocolArgs = app.isPackaged ? [] : [app.getAppPath()]
  if (
    !app.setAsDefaultProtocolClient(
      EARTHQUAKE_NOTIFICATION_PROTOCOL,
      process.execPath,
      protocolArgs,
    )
  ) {
    logger.warn('Application', 'Windows notification protocol could not be registered.')
  }
  if (app.isPackaged) return
  const shortcutPath = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Earthquake Signal Development.lnk',
  )
  try {
    const created = shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      description: 'Earthquake Signal development application',
      icon: process.execPath,
      iconIndex: 0,
      appUserModelId: applicationUserModelId,
      toastActivatorClsid: developmentToastActivatorClsid,
    })
    if (!created) {
      logger.warn('Application', 'Windows development notification shortcut could not be created.')
    }
  } catch (error) {
    logger.warn('Application', 'Windows development notification shortcut failed.', error)
  }
}

/** Creates all services and binds them to a newly opened window. */
const openApplicationWindow = async (startHidden = false): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot)
  await storage.initialize()
  const settings = await storage.loadSettings()
  configureStartOnLogin(app, process.platform, settings.startOnStartup)
  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger
  configureWindowsNotificationIntegration(logger)
  const updater = new AppUpdater(logger)
  updater.applySettings(settings)
  const initialNotificationActivation = parseNotificationActivation(process.argv)
  const shouldStartHidden = startHidden && initialNotificationActivation === null
  const window = await windowService.createWindow(logger, !shouldStartHidden)
  earthquakeService?.dispose()
  const earthquake = new EarthquakeService(
    storage,
    logger,
    applicationPaths.dataRoot,
    window,
    settings,
    process.platform === 'win32' ? EARTHQUAKE_NOTIFICATION_PROTOCOL : null,
  )
  earthquakeService = earthquake
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
  registerIpc(window, { storage, tray, updater, logger, earthquake })
  if (initialNotificationActivation) {
    setTimeout(() => earthquake.openNotification(initialNotificationActivation.sessionId), 750)
  }
  window.on('closed', () => earthquake.dispose())
  void earthquake.start()

  if (shouldStartHidden) {
    logger.info('Application', 'Earthquake Signal started hidden in the system tray.')
  }

  logger.info('Application', 'Earthquake Signal desktop started.', {
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
    const activation = parseNotificationActivation(argv)
    if (!activation && isHiddenStartupLaunch(argv)) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (activation) earthquakeService?.openNotification(activation.sessionId)
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
  earthquakeService?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
