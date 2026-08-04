/**
 * Stores application settings, session history, and update progress.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BootstrapPayload,
  type EarthquakeFilter,
  type EarthquakeServiceStatus,
  type SessionDocument,
  type SessionSummary,
  type UpdateStateEvent,
} from '@shared/types'

export type AppPage = 'home' | 'settings'
export type SettingsSection = 'general' | 'earthquake' | 'display' | 'updates' | 'about' | 'logging'
export interface AppState {
  initialized: boolean
  page: AppPage
  settingsSection: SettingsSection
  settings: AppSettings
  platform: BootstrapPayload['platform']
  version: string
  sessions: SessionSummary[]
  currentSession: SessionDocument | null
  sessionViewNonce: number
  update: UpdateStateEvent
  sessionsSidebarOpen: boolean
  earthquakeStatus: EarthquakeServiceStatus
  fullscreenEarthquake: SessionDocument | null
  earthquakeFilter: EarthquakeFilter
}

const initialState: AppState = {
  initialized: false,
  page: 'home',
  settingsSection: 'general',
  settings: DEFAULT_SETTINGS,
  platform: 'win32',
  version: '0.0.0',
  sessions: [],
  currentSession: null,
  sessionViewNonce: 0,
  update: { state: 'idle' },
  sessionsSidebarOpen: true,
  earthquakeStatus: { state: 'disconnected', topics: [], subscribedTopics: [] },
  fullscreenEarthquake: null,
  earthquakeFilter: 'all',
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
      state.sessions = action.payload.sessions
      state.currentSession = action.payload.currentSession
      state.earthquakeStatus = action.payload.earthquakeStatus
      state.earthquakeFilter = action.payload.settings.earthquakeFilter
    },
    /** Opens a top-level application page. */
    setPage(state, action: PayloadAction<AppPage>) {
      state.page = action.payload
    },
    /** Selects the settings category shown when the settings page is opened. */
    setSettingsSection(state, action: PayloadAction<SettingsSection>) {
      state.settingsSection = action.payload
    },
    /** Replaces settings after successful persistence. */
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload
      state.earthquakeFilter = action.payload.earthquakeFilter
    },
    /** Inserts a newly created summary at the front without duplicating its identifier. */
    addSessionSummary(state, action: PayloadAction<SessionSummary>) {
      state.sessions = [
        action.payload,
        ...state.sessions.filter((item) => item.id !== action.payload.id),
      ]
    },
    /** Replaces a known summary in place, or inserts it when not yet synchronized. */
    replaceSessionSummary(state, action: PayloadAction<SessionSummary>) {
      const index = state.sessions.findIndex((item) => item.id === action.payload.id)
      if (index === -1) state.sessions.unshift(action.payload)
      else state.sessions[index] = action.payload
    },
    /** Removes one session summary by its durable identifier. */
    removeSessionSummary(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((item) => item.id !== action.payload)
    },
    /** Replaces the complete session summary list. */
    setSessions(state, action: PayloadAction<SessionSummary[]>) {
      state.sessions = action.payload
    },
    /** Sets the session displayed in the main workspace and forces its view to remount. */
    setCurrentSession(state, action: PayloadAction<SessionDocument | null>) {
      state.currentSession = action.payload
      state.sessionViewNonce += 1
    },
    /** Refreshes a document only when it is still the active session. */
    replaceCurrentSession(state, action: PayloadAction<SessionDocument>) {
      if (state.currentSession?.id === action.payload.id) {
        state.currentSession = action.payload
      }
    },
    /** Applies desktop updater progress. */
    setUpdateState(state, action: PayloadAction<UpdateStateEvent>) {
      state.update = action.payload
    },
    /** Shows or hides the session management sidebar. */
    setSessionsSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sessionsSidebarOpen = action.payload
    },
    /** Applies FCM receiver status without affecting persisted settings. */
    setEarthquakeStatus(state, action: PayloadAction<EarthquakeServiceStatus>) {
      state.earthquakeStatus = action.payload
    },
    /** Shows or dismisses the application-level fullscreen earthquake warning. */
    setFullscreenEarthquake(state, action: PayloadAction<SessionDocument | null>) {
      state.fullscreenEarthquake = action.payload
    },
    /** Selects the earthquake magnitude filter shown in the sidebar. */
    setEarthquakeFilter(state, action: PayloadAction<EarthquakeFilter>) {
      state.earthquakeFilter = action.payload
    },
  },
})

export const {
  addSessionSummary,
  hydrate,
  removeSessionSummary,
  replaceCurrentSession,
  replaceSessionSummary,
  setCurrentSession,
  setPage,
  setSessions,
  setSettings,
  setSettingsSection,
  setSessionsSidebarOpen,
  setEarthquakeStatus,
  setFullscreenEarthquake,
  setUpdateState,
  setEarthquakeFilter,
} = appSlice.actions

export default appSlice.reducer
