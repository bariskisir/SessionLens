/**
 * Exposes a typed, capability-limited IPC API to the sandboxed renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import type { SessionLensApi, UpdateStateEvent, UsageSnapshotEvent } from '@shared/types'
/** Subscribes to one approved event and returns a cleanup callback. */
const subscribe = <T>(channel: IpcChannel, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: SessionLensApi = {
  /** Loads persisted settings and application metadata. */
  bootstrap: () => ipcRenderer.invoke(IpcChannel.AppBootstrap),
  /** Atomically merges validated application settings fields. */
  saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
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
  /** Subscribes to updater lifecycle progress. */
  onUpdateState: (listener) => subscribe<UpdateStateEvent>(IpcChannel.UpdateState, listener),
  /** Subscribes to maximize and restore state changes. */
  onWindowMaximizedChange: (listener) =>
    subscribe<boolean>(IpcChannel.WindowMaximizedChanged, listener),
  /** Subscribes to settings navigation requested by the tray menu. */
  onSettingsOpenRequested: (listener) =>
    subscribe<void>(IpcChannel.SettingsOpenRequested, listener),
  /** Resolves settings plus main-process metadata for the usage settings page. */
  getSettingsState: () => ipcRenderer.invoke(IpcChannel.SettingsState),
  /** Requests an immediate usage refresh through the running refresh loop. */
  requestUsageRefresh: () => ipcRenderer.invoke(IpcChannel.UsageRefreshRequest),
  /** Sends a test threshold notification through every enabled channel. */
  sendTestNotification: () => ipcRenderer.invoke(IpcChannel.NotificationTest),
  /** Returns the latest tooltip card snapshot produced by a refresh. */
  getUsageSnapshot: () => ipcRenderer.invoke(IpcChannel.UsageSnapshot),
  /** Subscribes to usage snapshot updates produced by each completed refresh. */
  onUsageSnapshot: (listener) =>
    subscribe<UsageSnapshotEvent>(IpcChannel.UsageSnapshotChanged, listener),
}

contextBridge.exposeInMainWorld('app', api)
