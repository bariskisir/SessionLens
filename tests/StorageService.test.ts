/**
 * Verifies generic settings persistence against an isolated temporary directory.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorageService from '../src/main/services/StorageService'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types'

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
      expect.objectContaining({ settingsRevision: 4, theme: 'system' }),
    )
  })

  it('serializes and persists settings patches', async () => {
    const saved = await storage.updateSettings({ theme: 'light', logLevel: 'debug' })
    expect(saved).toMatchObject({ theme: 'light', logLevel: 'debug' })
    await expect(storage.loadSettings()).resolves.toEqual(saved)
  })

  it('drops obsolete fields while saving complete settings', async () => {
    const candidate = structuredClone(DEFAULT_SETTINGS) as AppSettings & {
      obsoleteSetting?: boolean
    }
    candidate.obsoleteSetting = true
    const saved = await storage.saveSettings(candidate)
    expect(saved).not.toHaveProperty('obsoleteSetting')
  })
})
