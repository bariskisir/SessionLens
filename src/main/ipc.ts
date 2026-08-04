/**
 * Defines the validated IPC boundary between the renderer and main-process services.
 */

import { app, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_AUTHOR_URL } from '@shared/appInfo'
import {
  LOG_LEVELS,
  type EarthquakeNotificationOpenEvent,
  type EarthquakeReceivedEvent,
  type EarthquakeServiceStatus,
  type UpdateStateEvent,
} from '@shared/types'
import { z } from 'zod'
import { settingsPatchSchema } from './settingsSchema'
import { configureStartOnLogin } from './startup'
import type AppUpdater from './services/AppUpdater'
import type EarthquakeService from './services/EarthquakeService'
import type LoggerService from './services/LoggerService'
import type StorageService from './services/StorageService'
import type TrayService from './services/TrayService'

const sessionIdSchema = z.uuid()
const sessionRenameSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
})
const rendererLogSchema = z.object({
  level: z.enum(LOG_LEVELS),
  module: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  details: z.string().max(8_000).optional(),
})
const earthquakeTestKindSchema = z.enum(['realtime', 'seismic-network'])
const earthquakeFilterSchema = z.enum(['all', '3', '4', '5'])

const TRUSTED_EXTERNAL_ORIGINS = new Set(['https://github.com', APP_AUTHOR_URL])

interface IpcServices {
  storage: StorageService
  tray: TrayService
  updater: AppUpdater
  logger: LoggerService
  earthquake: EarthquakeService
}

/** Removes previous handlers before a replacement window is attached. */
export const removeIpcHandlers = (): void => {
  Object.values(IpcChannel).forEach((channel) => {
    ipcMain.removeHandler(channel)
  })
  ipcMain.removeAllListeners(IpcChannel.LogWrite)
}

/** Registers all renderer commands against explicit main-process services. */
export const registerIpc = (window: BrowserWindow, services: IpcServices): void => {
  removeIpcHandlers()

  /** Rejects any IPC call not originating from the main renderer. */
  const assertSender = (sender: WebContents): void => {
    if (sender.id !== window.webContents.id) throw new Error('Untrusted IPC sender.')
  }

  /** Sends a typed event only while the window is alive. */
  const send = <T>(channel: IpcChannel, payload: T): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.updater.initialize((event: UpdateStateEvent) => send(IpcChannel.UpdateState, event))
  services.earthquake.onStatus((status: EarthquakeServiceStatus) =>
    send(IpcChannel.EarthquakeStatus, status),
  )
  services.earthquake.onEarthquake((earthquake: EarthquakeReceivedEvent) =>
    send(IpcChannel.EarthquakeReceived, earthquake),
  )
  services.earthquake.onNotificationOpen((event: EarthquakeNotificationOpenEvent) =>
    send(IpcChannel.EarthquakeNotificationOpened, event),
  )
  window.on('maximize', () => send(IpcChannel.WindowMaximizedChanged, true))
  window.on('unmaximize', () => send(IpcChannel.WindowMaximizedChanged, false))

  ipcMain.handle(IpcChannel.AppBootstrap, async (event) => {
    assertSender(event.sender)
    const settings = await services.storage.loadSettings()
    if (process.platform === 'linux') {
      settings.showTrayIcon = false
      settings.minimizeToTrayOnClose = false
    }
    window.webContents.setZoomFactor(settings.pageZoom)

    const sessions = await services.storage.listSessions()

    return {
      settings,
      sessions,
      currentSession: null,
      platform: process.platform,
      version: app.getVersion(),
      earthquakeStatus: services.earthquake.getStatus(),
    }
  })
  ipcMain.handle(IpcChannel.SettingsSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const patch = settingsPatchSchema.parse(input)
    if (process.platform === 'linux') {
      delete patch.showTrayIcon
      delete patch.minimizeToTrayOnClose
    }
    if (process.platform === 'win32' && patch.startOnStartup === true) {
      patch.showTrayIcon = true
    }
    const savedSettings = await services.storage.updateSettings(patch)
    if (patch.startOnStartup !== undefined) {
      configureStartOnLogin(app, process.platform, savedSettings.startOnStartup)
    }
    window.setAlwaysOnTop(savedSettings.alwaysOnTop)
    window.webContents.setZoomFactor(savedSettings.pageZoom)
    services.tray.applySettings(savedSettings)
    services.logger.setLevel(savedSettings.logLevel)
    services.earthquake.applySettings(savedSettings)
    services.updater.applySettings(savedSettings)
    return savedSettings
  })
  ipcMain.handle(IpcChannel.SessionGet, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.getSession(sessionIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionRename, async (event, input: unknown) => {
    assertSender(event.sender)
    const { id, title } = sessionRenameSchema.parse(input)
    return services.storage.renameSession(id, title)
  })
  ipcMain.handle(IpcChannel.SessionDelete, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.deleteSession(sessionIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionDeleteAll, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.deleteAllSessions(earthquakeFilterSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.WindowAlwaysOnTop, (event, enabled: unknown) => {
    assertSender(event.sender)
    if (typeof enabled !== 'boolean') throw new Error('Invalid window preference.')
    window.setAlwaysOnTop(enabled)
  })
  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    assertSender(event.sender)
    window.minimize()
  })
  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    assertSender(event.sender)
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    assertSender(event.sender)
    window.close()
  })
  ipcMain.handle(IpcChannel.WindowIsMaximized, (event) => {
    assertSender(event.sender)
    return window.isMaximized()
  })
  ipcMain.handle(IpcChannel.ThemeSet, (event, theme: unknown) => {
    assertSender(event.sender)
    if (theme !== 'light' && theme !== 'dark') throw new Error('Invalid theme.')
    if (process.platform === 'darwin') {
      window.setTitleBarOverlay({
        color: theme === 'dark' ? '#1f1f1f' : '#f4f4f4',
        symbolColor: theme === 'dark' ? '#ffffff99' : '#00000099',
        height: 42,
      })
    }
  })
  ipcMain.handle(IpcChannel.ShellOpenExternal, async (event, input: unknown) => {
    assertSender(event.sender)
    if (typeof input !== 'string') throw new Error('Invalid external URL.')
    const url = new URL(input)
    if (!TRUSTED_EXTERNAL_ORIGINS.has(url.origin)) throw new Error('This URL is not allowed.')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle(IpcChannel.LogsOpenDirectory, async (event) => {
    assertSender(event.sender)
    const error = await shell.openPath(services.logger.getLogsDirectory())
    if (error) throw new Error(error)
  })
  ipcMain.on(IpcChannel.LogWrite, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = rendererLogSchema.safeParse(input)
    if (parsed.success) {
      services.logger.writeRenderer({
        level: parsed.data.level,
        module: parsed.data.module,
        message: parsed.data.message,
        ...(parsed.data.details === undefined ? {} : { details: parsed.data.details }),
      })
    }
  })
  ipcMain.handle(IpcChannel.UpdatesCheck, async (event) => {
    assertSender(event.sender)
    await services.updater.checkForUpdates()
  })
  ipcMain.handle(IpcChannel.UpdatesInstall, async (event) => {
    assertSender(event.sender)
    await services.updater.quitAndInstall()
  })
  ipcMain.handle(IpcChannel.EarthquakeRefresh, async (event) => {
    assertSender(event.sender)
    return services.earthquake.refresh()
  })
  ipcMain.handle(IpcChannel.EarthquakeResetRegistration, async (event) => {
    assertSender(event.sender)
    return services.earthquake.resetRegistration()
  })
  ipcMain.handle(IpcChannel.EarthquakeTest, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.earthquake.test(earthquakeTestKindSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.EarthquakeDismissFullscreen, (event) => {
    assertSender(event.sender)
    services.earthquake.dismissFullscreen()
  })
}
