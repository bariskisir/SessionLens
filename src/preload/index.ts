/**
 * Exposes a typed, capability-limited IPC API to the sandboxed renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  EarthquakeNotificationOpenEvent,
  EarthquakeReceivedEvent,
  EarthquakeServiceStatus,
  EarthquakeSignalApi,
  UpdateStateEvent,
} from '@shared/types'

/** Subscribes to one approved event and returns a cleanup callback. */
const subscribe = <T>(channel: IpcChannel, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: EarthquakeSignalApi = {
  /** Loads settings, session history, and application metadata. */
  bootstrap: () => ipcRenderer.invoke(IpcChannel.AppBootstrap),
  /** Atomically merges validated application settings fields. */
  saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
  /** Loads one complete local session. */
  getSession: (id) => ipcRenderer.invoke(IpcChannel.SessionGet, id),
  /** Renames one local session. */
  renameSession: (id, title) => ipcRenderer.invoke(IpcChannel.SessionRename, { id, title }),
  /** Deletes one local session. */
  deleteSession: (id) => ipcRenderer.invoke(IpcChannel.SessionDelete, id),
  /** Deletes local sessions visible under one earthquake magnitude filter. */
  deleteAllSessions: (filter) => ipcRenderer.invoke(IpcChannel.SessionDeleteAll, filter),
  /** Changes the native always-on-top window state. */
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IpcChannel.WindowAlwaysOnTop, enabled),
  /** Minimizes the main application window. */
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
  /** Toggles the main application window between maximized and restored states. */
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
  /** Closes the main application window. */
  closeWindow: () => ipcRenderer.invoke(IpcChannel.WindowClose),
  /** Retrieves the main application window's maximized state. */
  isWindowMaximized: () => ipcRenderer.invoke(IpcChannel.WindowIsMaximized),
  /** Synchronizes native title-bar colors with the renderer theme. */
  setTheme: (theme) => ipcRenderer.invoke(IpcChannel.ThemeSet, theme),
  /** Opens one allow-listed HTTPS URL in the system browser. */
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url),
  /** Opens the AppData log directory in the operating-system file manager. */
  openLogsDirectory: () => ipcRenderer.invoke(IpcChannel.LogsOpenDirectory),
  /** Forwards one renderer diagnostic to the configured main logger. */
  writeLog: (entry) => ipcRenderer.send(IpcChannel.LogWrite, entry),
  /** Checks GitHub Releases for a newer application version. */
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.UpdatesCheck),
  /** Restarts and installs a downloaded update. */
  installUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesInstall),
  /** Immediately reconnects the earthquake FCM receiver. */
  refreshEarthquakeConnection: () => ipcRenderer.invoke(IpcChannel.EarthquakeRefresh),
  /** Deletes and recreates the local Firebase and backend registration. */
  resetEarthquakeRegistration: () => ipcRenderer.invoke(IpcChannel.EarthquakeResetRegistration),
  /** Simulates one realtime or seismic-network event in the main process. */
  testEarthquake: (kind) => ipcRenderer.invoke(IpcChannel.EarthquakeTest, kind),
  /** Restores the main window after a fullscreen earthquake alert. */
  dismissFullscreenEarthquake: () => ipcRenderer.invoke(IpcChannel.EarthquakeDismissFullscreen),
  /** Subscribes to updater lifecycle progress. */
  onUpdateState: (listener) => subscribe<UpdateStateEvent>(IpcChannel.UpdateState, listener),
  /** Subscribes to maximize and restore state changes. */
  onWindowMaximizedChange: (listener) =>
    subscribe<boolean>(IpcChannel.WindowMaximizedChanged, listener),
  /** Subscribes to settings navigation requested by the tray menu. */
  onSettingsOpenRequested: (listener) =>
    subscribe<void>(IpcChannel.SettingsOpenRequested, listener),
  /** Subscribes to earthquake receiver status changes. */
  onEarthquakeStatus: (listener) =>
    subscribe<EarthquakeServiceStatus>(IpcChannel.EarthquakeStatus, listener),
  /** Subscribes to newly persisted earthquake sessions. */
  onEarthquakeReceived: (listener) =>
    subscribe<EarthquakeReceivedEvent>(IpcChannel.EarthquakeReceived, listener),
  /** Subscribes to a native earthquake notification activation. */
  onEarthquakeNotificationOpened: (listener) =>
    subscribe<EarthquakeNotificationOpenEvent>(IpcChannel.EarthquakeNotificationOpened, listener),
}

contextBridge.exposeInMainWorld('app', api)
