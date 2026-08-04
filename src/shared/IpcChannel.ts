/**
 * Enumerates every IPC channel exposed by the desktop application.
 */

export enum IpcChannel {
  AppBootstrap = 'app:bootstrap',
  SettingsSave = 'settings:save',
  SessionGet = 'session:get',
  SessionRename = 'session:rename',
  SessionDelete = 'session:delete',
  SessionDeleteAll = 'session:delete-all',
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
  EarthquakeRefresh = 'earthquake:refresh',
  EarthquakeResetRegistration = 'earthquake:reset-registration',
  EarthquakeTest = 'earthquake:test',
  EarthquakeDismissFullscreen = 'earthquake:dismiss-fullscreen',
  UpdateState = 'event:update-state',
  EarthquakeStatus = 'event:earthquake-status',
  EarthquakeReceived = 'event:earthquake-received',
  EarthquakeNotificationOpened = 'event:earthquake-notification-opened',
  WindowMaximizedChanged = 'event:window-maximized-changed',
  SettingsOpenRequested = 'event:settings-open-requested',
}
