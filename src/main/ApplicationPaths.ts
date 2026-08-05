/**
 * Defines the durable, log, and isolated Electron runtime directories for the application.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface ApplicationPaths {
  applicationDataRoot: string
  dataRoot: string
  logsRoot: string
  runtimeRoot: string
}

/** Configures Electron paths before ready so Chromium files stay outside durable app data. */
export const configureApplicationPaths = (): ApplicationPaths => {
  const applicationDataRoot = join(app.getPath('appData'), 'Session Lens')
  const dataRoot = join(applicationDataRoot, 'Data')
  const logsRoot = join(applicationDataRoot, 'Logs')
  const runtimeRoot = join(applicationDataRoot, 'Runtime')

  ;[applicationDataRoot, dataRoot, logsRoot, runtimeRoot].forEach((directory) => {
    mkdirSync(directory, { recursive: true })
  })
  app.setPath('userData', runtimeRoot)
  app.setAppLogsPath(logsRoot)

  return {
    applicationDataRoot,
    dataRoot,
    logsRoot,
    runtimeRoot,
  }
}
