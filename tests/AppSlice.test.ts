/**
 * Verifies renderer state hydration, settings, and UI toggles.
 */

import { describe, expect, it } from 'vitest'
import reducer, {
  hydrate,
  setSettings,
  setSettingsSection,
  setUpdateState,
} from '../src/renderer/src/store/appSlice'
import { DEFAULT_SETTINGS, type BootstrapPayload } from '../src/shared/types'

describe('appSlice', () => {
  it('hydrates application state once', () => {
    const payload: BootstrapPayload = {
      settings: { ...DEFAULT_SETTINGS, theme: 'light' },
      platform: 'linux',
      version: '1.0.0',
      environmentApiKeys: {},
    }
    const hydrated = reducer(undefined, hydrate(payload))
    const repeated = reducer(hydrated, hydrate({ ...payload, version: '2.0.0' }))

    expect(hydrated.initialized).toBe(true)
    expect(hydrated.settings.theme).toBe('light')
    expect(hydrated.version).toBe('1.0.0')
    expect(repeated.version).toBe('1.0.0')
  })

  it('changes the settings section', () => {
    const logging = reducer(undefined, setSettingsSection('logging'))
    expect(logging.settingsSection).toBe('logging')
  })

  it('replaces persisted settings', () => {
    const state = reducer(undefined, setSettings({ ...DEFAULT_SETTINGS, logLevel: 'debug' }))
    expect(state.settings.logLevel).toBe('debug')
  })

  it('updates updater state', () => {
    const updated = reducer(undefined, setUpdateState({ state: 'available', version: '1.1.0' }))
    expect(updated.update).toEqual({ state: 'available', version: '1.1.0' })
  })
})
