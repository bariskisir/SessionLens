/**
 * @file ToastActivatorRepair.ts
 * @description Repairs the Windows toast activator registration so a cold toast activation launches
 * this app instead of the bare executable, which in development would open Electron's default screen.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import type LoggerService from './LoggerService'

const execFileAsync = promisify(execFile)

/** Label Electron writes under the activator CLSID keys. */
const ACTIVATOR_LABEL = 'Electron Notification Activator'
/** Root of the per-user CLSID registration written by Electron. */
const CLSID_ROOT = 'HKCU\\Software\\Classes\\CLSID'

/** Parses activator CLSID keys from `reg query` search output. */
export const parseActivatorClsids = (output: string): string[] => {
  const ids = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\(\{[0-9a-f-]{36}\})/i)
    if (match?.[1]) ids.add(match[1].toUpperCase())
  }
  return [...ids]
}

/** Extracts the default value from a `reg query <key> /ve` output. */
export const parseLocalServerValue = (output: string): string | null => {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s+\(Default\)\s+REG_SZ\s+(.+)$/)
    if (match?.[1] !== undefined) return match[1].trim()
  }
  return null
}

/** Builds a quoted local-server command line that passes the app path after the executable. */
export const buildLocalServerCommand = (execPath: string, appPath: string): string =>
  `"${execPath}" "${appPath}"`

/**
 * Rewrites the toast activator LocalServer32 entries that point at the bare executable so cold
 * toast activations start this app (hidden, via the `-Embedding` switch the COM service appends)
 * instead of Electron's default screen. Retried because Electron writes the bare value
 * asynchronously right after the notification presenter is created.
 *
 * @param logger - System logger for diagnostics
 */
export const repairToastActivatorLaunchPaths = async (logger: LoggerService): Promise<void> => {
  const execPath = process.execPath
  for (const delayMs of [0, 1_200, 3_000]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      const { stdout } = await execFileAsync(
        'reg.exe',
        ['query', CLSID_ROOT, '/f', ACTIVATOR_LABEL, '/d', '/s'],
        { windowsHide: true },
      )
      for (const clsid of parseActivatorClsids(stdout)) {
        const key = `${CLSID_ROOT}\\${clsid}\\LocalServer32`
        const { stdout: valueOut } = await execFileAsync('reg.exe', ['query', key, '/ve'], {
          windowsHide: true,
        })
        const current = parseLocalServerValue(valueOut)
        if (!current || current.toLowerCase() !== execPath.toLowerCase()) continue
        await execFileAsync(
          'reg.exe',
          ['add', key, '/ve', '/d', buildLocalServerCommand(execPath, app.getAppPath()), '/f'],
          { windowsHide: true },
        )
        logger.info('ToastActivatorRepair', 'Toast activator launch path repaired.', { clsid })
      }
    } catch (error) {
      logger.warn('ToastActivatorRepair', 'Toast activator repair failed.', error)
    }
  }
}
