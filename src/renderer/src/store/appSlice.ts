/**
 * Stores application settings and update progress.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BootstrapPayload,
  type UpdateStateEvent,
} from '@shared/types'

export type SettingsSection = 'general' | 'display' | 'updates' | 'about' | 'logging'
export interface AppState {
  initialized: boolean
  settingsSection: SettingsSection
  settings: AppSettings
  platform: BootstrapPayload['platform']
  version: string
  update: UpdateStateEvent
}

const initialState: AppState = {
  initialized: false,
  settingsSection: 'general',
  settings: DEFAULT_SETTINGS,
  platform: 'win32',
  version: '0.0.0',
  update: { state: 'idle' },
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    /** Hydrates the renderer with persisted main-process state. */
    hydrate(state, action: PayloadAction<BootstrapPayload>) {
      if (state.initialized) return
      state.initialized = true
      state.settings = action.payload.settings
      state.platform = action.payload.platform
      state.version = action.payload.version
    },
    /** Selects the settings category shown when the settings page is opened. */
    setSettingsSection(state, action: PayloadAction<SettingsSection>) {
      state.settingsSection = action.payload
    },
    /** Replaces settings after successful persistence. */
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload
    },
    /** Applies desktop updater progress. */
    setUpdateState(state, action: PayloadAction<UpdateStateEvent>) {
      state.update = action.payload
    },
  },
})

export const { hydrate, setSettings, setSettingsSection, setUpdateState } = appSlice.actions

export default appSlice.reducer
