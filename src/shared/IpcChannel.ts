/**
 * Enumerates every IPC channel exposed by the desktop application.
 */

export enum IpcChannel {
  AppBootstrap = 'app:bootstrap',
  SettingsSave = 'settings:save',
  WindowAlwaysOnTop = 'window:always-on-top',
  WindowMinimize = 'window:minimize',
  WindowToggleMaximize = 'window:toggle-maximize',
  WindowClose = 'window:close',
  WindowIsMaximized = 'window:is-maximized',
  ThemeSet = 'theme:set',
  ShellOpenExternal = 'shell:open-external',
  LogsOpenDirectory = 'logs:open-directory',
  LogWrite = 'logs:write',
  UpdatesCheck = 'updates:check',
  UpdatesInstall = 'updates:install',
  UpdateState = 'event:update-state',
  WindowMaximizedChanged = 'event:window-maximized-changed',
  SettingsOpenRequested = 'event:settings-open-requested',
  SettingsState = 'settings:state',
  UsageRefreshRequest = 'usage:refresh-request',
  NotificationTest = 'notification:test',
  UsageSnapshot = 'usage:snapshot',
  UsageSnapshotChanged = 'event:usage-snapshot-changed',
}
