/**
 * Keeps operating-system login registration and hidden-start argument handling consistent.
 */

import type { App } from 'electron'

export const START_HIDDEN_ARGUMENT = '--hidden'

/** Windows COM local-server activation argument used when a toast launches the app. */
const EMBEDDING_ARGUMENTS = ['-Embedding', '/Embedding']

type LoginItemRegistrar = Pick<App, 'isPackaged' | 'setLoginItemSettings'>
type LoginItemSettings = Parameters<App['setLoginItemSettings']>[0]

/** Registers packaged desktop startup and requests a tray-only launch on Windows. */
export const configureStartOnLogin = (
  registrar: LoginItemRegistrar,
  platform: NodeJS.Platform,
  enabled: boolean,
): void => {
  if (!registrar.isPackaged || platform === 'linux') return
  const settings: LoginItemSettings = {
    openAtLogin: enabled,
    ...(platform === 'win32' ? { args: [START_HIDDEN_ARGUMENT] } : {}),
  }
  registrar.setLoginItemSettings(settings)
}

/**
 * Detects launches that must not open the main window: the operating-system startup
 * registration and Windows COM activation (a toast click launching the local server).
 */
export const isHiddenStartupLaunch = (argv: readonly string[]): boolean =>
  argv.includes(START_HIDDEN_ARGUMENT) || EMBEDDING_ARGUMENTS.some((arg) => argv.includes(arg))
