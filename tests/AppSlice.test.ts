/**
 * Verifies renderer state hydration, session management, settings, and UI toggles.
 */

import { describe, expect, it } from 'vitest'
import reducer, {
  addSessionSummary,
  hydrate,
  removeSessionSummary,
  replaceCurrentSession,
  replaceSessionSummary,
  setCurrentSession,
  setPage,
  setSettings,
  setSettingsSection,
  setSessionsSidebarOpen,
  setUpdateState,
} from '../src/renderer/src/store/appSlice'
import { DEFAULT_SETTINGS, type BootstrapPayload, type SessionDocument } from '../src/shared/types'

const session = (id: string, title = 'New Session'): SessionDocument => ({
  id,
  title,
  isDefaultTitle: title === 'New Session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('appSlice', () => {
  it('hydrates application state once', () => {
    const payload: BootstrapPayload = {
      settings: { ...DEFAULT_SETTINGS, theme: 'light' },
      sessions: [session('00000000-0000-4000-8000-000000000001')],
      currentSession: session('00000000-0000-4000-8000-000000000001'),
      platform: 'linux',
      version: '1.0.0',
      earthquakeStatus: {
        state: 'connected',
        topics: ['global', 'x21y12'],
        subscribedTopics: ['global', 'x21y12'],
      },
    }
    const hydrated = reducer(undefined, hydrate(payload))
    const repeated = reducer(hydrated, hydrate({ ...payload, version: '2.0.0' }))

    expect(hydrated.initialized).toBe(true)
    expect(hydrated.settings.theme).toBe('light')
    expect(hydrated.version).toBe('1.0.0')
    expect(repeated.version).toBe('1.0.0')
  })

  it('changes page and settings section', () => {
    const settingsPage = reducer(undefined, setPage('settings'))
    const logging = reducer(settingsPage, setSettingsSection('logging'))
    expect(logging.page).toBe('settings')
    expect(logging.settingsSection).toBe('logging')
  })

  it('replaces persisted settings', () => {
    const state = reducer(undefined, setSettings({ ...DEFAULT_SETTINGS, logLevel: 'debug' }))
    expect(state.settings.logLevel).toBe('debug')
  })

  it('adds, replaces, and removes session summaries', () => {
    const first = session('00000000-0000-4000-8000-000000000001')
    const added = reducer(undefined, addSessionSummary(first))
    const replaced = reducer(
      added,
      replaceSessionSummary({ ...first, title: 'Renamed', isDefaultTitle: false }),
    )
    const removed = reducer(replaced, removeSessionSummary(first.id))

    expect(replaced.sessions[0]?.title).toBe('Renamed')
    expect(removed.sessions).toHaveLength(0)
  })

  it('updates only the active session document', () => {
    const first = session('00000000-0000-4000-8000-000000000001')
    const selected = reducer(undefined, setCurrentSession(first))
    const ignored = reducer(
      selected,
      replaceCurrentSession(session('00000000-0000-4000-8000-000000000002', 'Other')),
    )
    const replaced = reducer(
      ignored,
      replaceCurrentSession({ ...first, title: 'Renamed', isDefaultTitle: false }),
    )

    expect(ignored.currentSession?.title).toBe('New Session')
    expect(replaced.currentSession?.title).toBe('Renamed')
  })

  it('updates sidebar visibility and updater state', () => {
    const hidden = reducer(undefined, setSessionsSidebarOpen(false))
    const updated = reducer(hidden, setUpdateState({ state: 'available', version: '1.1.0' }))
    expect(updated.sessionsSidebarOpen).toBe(false)
    expect(updated.update).toEqual({ state: 'available', version: '1.1.0' })
  })
})
