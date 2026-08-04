/**
 * Verifies generic settings and session persistence against an isolated temporary directory.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorageService from '../src/main/services/StorageService'
import type { EarthquakeEvent } from '../src/shared/types'

let rootPath = ''
let storage: StorageService

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'earthquake-signal-test-'))
  storage = new StorageService(rootPath)
  await storage.initialize()
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

describe('StorageService', () => {
  it('creates and lists generic sessions', async () => {
    const created = await storage.createSession()
    const sessions = await storage.listSessions()

    expect(created.title).toBe('New Session')
    expect(created.isDefaultTitle).toBe(true)
    expect(sessions).toEqual([created])
  })

  it('renames and reloads a session', async () => {
    const created = await storage.createSession()
    const renamed = await storage.renameSession(created.id, 'My Session')

    expect(renamed).toMatchObject({ title: 'My Session', isDefaultTitle: false })
    await expect(storage.getSession(created.id)).resolves.toEqual(renamed)
  })

  it('allows the final session to be deleted', async () => {
    const only = await storage.createSession()
    await expect(storage.deleteSession(only.id)).resolves.toEqual({ deleted: true })
    expect(await storage.listSessions()).toHaveLength(0)
  })

  it('deletes all sessions in one operation', async () => {
    const first = await storage.createSession('First')
    const second = await storage.createSession('Second')

    await expect(storage.deleteAllSessions()).resolves.toEqual(
      expect.arrayContaining([first.id, second.id]),
    )

    expect(await storage.listSessions()).toHaveLength(0)
  })

  it('deletes only earthquakes matching the selected magnitude filter', async () => {
    const createEarthquake = (id: string, magnitude: number, minute: number): EarthquakeEvent => ({
      id,
      kind: 'seismic-network',
      source: 'test',
      latitude: 39.9,
      longitude: 32.8,
      receivedAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`,
      magnitude,
    })
    const belowFour = await storage.upsertEarthquakeSession(
      createEarthquake('below-four', 3.9, 1),
      'Below four',
    )
    const fourPlus = await storage.upsertEarthquakeSession(
      createEarthquake('four-plus', 4.2, 2),
      'Four plus',
    )
    const fivePlus = await storage.upsertEarthquakeSession(
      createEarthquake('five-plus', 5.1, 3),
      'Five plus',
    )

    await expect(storage.deleteAllSessions('5')).resolves.toEqual([fivePlus.id])
    expect((await storage.listSessions()).map((session) => session.id)).toEqual([
      fourPlus.id,
      belowFour.id,
    ])

    await expect(storage.deleteAllSessions('4')).resolves.toEqual([fourPlus.id])
    expect((await storage.listSessions()).map((session) => session.id)).toEqual([belowFour.id])
    await expect(storage.deleteAllSessions('5')).resolves.toEqual([])
  })

  it('drops obsolete fields while loading older session documents', async () => {
    const created = await storage.createSession()
    const filePath = join(rootPath, 'sessions', `${created.id}.json`)
    const legacy = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    await writeFile(filePath, JSON.stringify({ ...legacy, removedContent: ['old'] }), 'utf8')

    const loaded = await storage.getSession(created.id)
    expect(loaded).toEqual(created)
    expect(loaded).not.toHaveProperty('removedContent')
  })

  it('serializes and persists settings patches', async () => {
    const saved = await storage.updateSettings({ theme: 'light', logLevel: 'debug' })
    expect(saved).toMatchObject({ theme: 'light', logLevel: 'debug' })
    await expect(storage.loadSettings()).resolves.toEqual(saved)
  })

  it('persists an earthquake and updates later revisions in the same session', async () => {
    const first: EarthquakeEvent = {
      id: 'event-42',
      kind: 'realtime',
      source: 'test',
      latitude: 39.9,
      longitude: 32.8,
      receivedAt: '2026-01-01T00:00:00.000Z',
      occurredAt: '2025-12-31T23:59:00.000Z',
      magnitude: 4.6,
      place: 'Ankara',
      revision: 1,
      estimatedIntensity: 2.4,
    }
    const created = await storage.upsertEarthquakeSession(first, 'Realtime Ankara')
    const updated = await storage.upsertEarthquakeSession(
      { ...first, receivedAt: '2026-01-01T00:01:00.000Z', revision: 2 },
      'Realtime Ankara update',
    )

    expect(updated.id).toBe(created.id)
    expect(updated.earthquake?.revision).toBe(2)
    expect(await storage.listSessions()).toEqual([
      expect.objectContaining({
        id: created.id,
        latitude: 39.9,
        longitude: 32.8,
        magnitude: 4.6,
        place: 'Ankara',
        occurredAt: '2025-12-31T23:59:00.000Z',
      }),
    ])
  })
})
