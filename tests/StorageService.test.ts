/**
 * Verifies generic settings persistence against an isolated temporary directory.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorageService from '../src/main/services/StorageService'

let rootPath = ''
let storage: StorageService

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'lens-test-'))
  storage = new StorageService(rootPath)
  await storage.initialize()
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

describe('StorageService', () => {
  it('loads defaults for missing data', async () => {
    await expect(storage.loadSettings()).resolves.toEqual(
      expect.objectContaining({ settingsRevision: 3, theme: 'system' }),
    )
  })

  it('serializes and persists settings patches', async () => {
    const saved = await storage.updateSettings({ theme: 'light', logLevel: 'debug' })
    expect(saved).toMatchObject({ theme: 'light', logLevel: 'debug' })
    await expect(storage.loadSettings()).resolves.toEqual(saved)
  })

  it('drops obsolete fields while saving complete settings', async () => {
    const saved = await storage.saveSettings({
      settingsRevision: 3,
      uiLanguage: 'en',
      theme: 'system',
      navbarPosition: 'top',
      pageZoom: 1,
      timeFormat: '24-hour',
      startOnStartup: true,
      alwaysOnTop: false,
      showTrayIcon: true,
      minimizeToTrayOnClose: true,
      autoUpdate: true,
      unattendedUpdates: true,
      logLevel: 'info',
      removedFeature: true,
    } as Parameters<typeof storage.saveSettings>[0])
    expect(saved).not.toHaveProperty('removedFeature')
  })
})
