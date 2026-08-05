/**
 * @file ipc.ts
 * @description Defines the validated IPC boundary between renderer and main-process services.
 */

import { app, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_AUTHOR_URL } from '@shared/appInfo'
import { LOG_LEVELS, PROVIDER_DESCRIPTORS, type UpdateStateEvent } from '@shared/types'
import { z } from 'zod'
import { settingsPatchSchema } from './settingsSchema'
import { configureStartOnLogin } from './startup'
import type AppUpdater from './services/AppUpdater'
import type LoggerService from './services/LoggerService'
import type StorageService from './services/StorageService'
import type TrayService from './services/TrayService'
import type UsageRefreshService from './services/usage/UsageRefreshService'

/** Validation schema for renderer log write requests. */
const rendererLogSchema = z.object({
  level: z.enum(LOG_LEVELS),
  module: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  details: z.string().max(8_000).optional(),
})

/** Trusted external web origins allowed for shell.openExternal calls. */
const TRUSTED_EXTERNAL_ORIGINS = new Set(['https://github.com', APP_AUTHOR_URL])

/** Context interface for registered IPC main-process services. */
interface IpcServices {
  storage: StorageService
  tray: TrayService
  updater: AppUpdater
  logger: LoggerService
  usage: UsageRefreshService
}

/**
 * Removes previous IPC handlers and listeners before a replacement window is attached.
 */
export const removeIpcHandlers = (): void => {
  Object.values(IpcChannel).forEach((channel) => {
    ipcMain.removeHandler(channel)
  })
  ipcMain.removeAllListeners(IpcChannel.LogWrite)
}

/**
 * Registers all renderer command handlers against main-process services.
 *
 * @param window - Active BrowserWindow instance
 * @param services - Dictionary of main-process services
 */
export const registerIpc = (window: BrowserWindow, services: IpcServices): void => {
  removeIpcHandlers()

  /**
   * Rejects any IPC call not originating from the active renderer window.
   *
   * @param sender - Sender WebContents instance
   */
  const assertSender = (sender: WebContents): void => {
    if (sender.id !== window.webContents.id) throw new Error('Untrusted IPC sender.')
  }

  /**
   * Sends a typed event to the renderer window while it is alive.
   *
   * @param channel - Target IPC channel enum value
   * @param payload - Payload object
   */
  const send = <T>(channel: IpcChannel, payload: T): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.updater.initialize((event: UpdateStateEvent) => send(IpcChannel.UpdateState, event))
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

    return {
      settings,
      platform: process.platform,
      version: app.getVersion(),
      environmentApiKeys: PROVIDER_DESCRIPTORS.reduce<Record<string, string>>(
        (keys, descriptor) => {
          if (descriptor.credentialName && process.env[descriptor.credentialName]) {
            keys[descriptor.credentialName] = process.env[descriptor.credentialName] ?? ''
          }
          return keys
        },
        {},
      ),
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
    services.tray.setTooltipScale(savedSettings.visual.scale)
    services.logger.setLevel(savedSettings.logLevel)
    services.updater.applySettings(savedSettings)
    if (patch.providers !== undefined || patch.visual?.iconLayout !== undefined) {
      services.usage.requestManualRefresh()
    }
    return savedSettings
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
  ipcMain.handle(IpcChannel.NotificationTest, async (event) => {
    assertSender(event.sender)
    await services.usage.sendTestNotificationAsync()
  })
  ipcMain.handle(IpcChannel.UsageRefreshRequest, async (event) => {
    assertSender(event.sender)
    services.usage.requestManualRefresh()
  })
  ipcMain.handle(IpcChannel.UsageSnapshot, async (event) => {
    assertSender(event.sender)
    return services.usage.getSnapshot()
  })
}

