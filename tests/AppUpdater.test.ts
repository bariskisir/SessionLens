/**
 * Verifies attended and unattended desktop update installation behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import AppUpdater, {
  type UpdateClient,
  type UpdateLogger,
  type UpdateRuntime,
} from '../src/main/services/AppUpdater'
import type { UpdateStateEvent } from '../src/shared/types'

const release = {
  version: '1.1.0',
  name: 'Earthquake Signal 1.1.0',
  pageUrl: 'https://github.com/ysfgrl/earthquake-signal/releases/tag/v1.1.0',
  assets: [
    {
      name: 'earthquake-signal-1.1.0-windows-x64-setup.exe',
      downloadUrl:
        'https://github.com/ysfgrl/earthquake-signal/releases/download/v1.1.0/earthquake-signal-1.1.0-windows-x64-setup.exe',
      size: 1,
    },
  ],
}

const createHarness = (autoUpdate: boolean, unattendedUpdates: boolean) => {
  const launchInstaller = vi.fn(async (): Promise<void> => undefined)
  const quit = vi.fn()
  const events: UpdateStateEvent[] = []
  const client: UpdateClient = {
    getLatestRelease: vi.fn(async () => release),
    downloadInstaller: vi.fn(async (_asset, _directory, onProgress) => {
      onProgress(50)
      return { filePath: 'C:\\Temp\\earthquake-signal-update.exe', sha256: 'abc123' }
    }),
  }
  const runtime: UpdateRuntime = {
    isPackaged: true,
    version: '1.0.0',
    architecture: 'x64',
    platform: 'win32',
    temporaryDirectory: 'C:\\Temp\\Earthquake Signal\\Updates',
    quit,
    launchInstaller,
  }
  const logger: UpdateLogger = {
    error: vi.fn(),
    info: vi.fn(),
  }
  const updater = new AppUpdater(logger, client, runtime)
  updater.initialize((event) => events.push(event))
  updater.applySettings({ autoUpdate, unattendedUpdates })
  return { events, launchInstaller, quit, updater }
}

describe('AppUpdater unattended updates', () => {
  it('silently launches a downloaded installer and exits when enabled', async () => {
    const harness = createHarness(true, true)

    await harness.updater.checkForUpdates()

    expect(harness.launchInstaller).toHaveBeenCalledWith('C:\\Temp\\earthquake-signal-update.exe')
    expect(harness.quit).toHaveBeenCalledOnce()
    expect(harness.events.at(-1)).toMatchObject({ state: 'downloaded', percent: 100 })
  })

  it.each([
    { autoUpdate: false, unattendedUpdates: true },
    { autoUpdate: true, unattendedUpdates: false },
  ])(
    'keeps the downloaded update attended with $autoUpdate/$unattendedUpdates',
    async ({ autoUpdate, unattendedUpdates }) => {
      const harness = createHarness(autoUpdate, unattendedUpdates)

      await harness.updater.checkForUpdates()

      expect(harness.launchInstaller).not.toHaveBeenCalled()
      expect(harness.quit).not.toHaveBeenCalled()
      expect(harness.events.at(-1)).toMatchObject({ state: 'downloaded', percent: 100 })
    },
  )
})
