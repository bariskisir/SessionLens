# Earthquake Signal -- Development Guide

## Project Overview

Earthquake Signal is a desktop earthquake receiver built with Electron. It maintains one fixed
user-selected location, registers an FCM-compatible push receiver with the Earthquake Network
backend, receives both realtime alerts and normal seismic-network reports, stores every received
event locally, and presents the event relative to the user's location on a map.

The product version is `1.2.0`. The UI calls stored event history **Earthquakes**, while the
internal persistence and TypeScript model continue to use the established `session` naming.

## Tech Stack

| Layer              | Technology                                                |
| ------------------ | --------------------------------------------------------- |
| Desktop shell      | Electron 43 with `vite-plugin-electron`                   |
| Build              | Vite 8, with separate main, preload, and renderer bundles |
| Language           | TypeScript 7.0                                            |
| UI framework       | React 19.2                                                |
| State              | Redux Toolkit 2.12                                        |
| Component library  | Ant Design 6.5                                            |
| Maps               | Leaflet 1.9 with CARTO light/dark tiles                   |
| Push receiver      | `@eneris/push-receiver` 4.3                               |
| Validation         | Zod 4.4                                                   |
| Localization       | i18next and react-i18next; 10 locales                     |
| Logging            | electron-log in main, custom IPC log bridge in renderer   |
| Styling            | SCSS Modules and CSS custom properties                    |
| Linting/formatting | Biome and Prettier                                        |
| Testing            | Vitest 4.1, Node environment                              |
| Packaging          | electron-builder: NSIS, DMG, and AppImage definitions     |

## Directory Structure

```text
EarthquakeSignal/
|-- src/
|   |-- shared/                         # Cross-process contracts and pure helpers
|   |   |-- appInfo.ts                  # Author and repository constants
|   |   |-- earthquake.ts               # Topic, distance, destination, wavefront helpers
|   |   |-- earthquakeNotification.ts   # Windows notification protocol URL and toast XML
|   |   |-- IpcChannel.ts               # Colon-delimited IPC channel enum
|   |   `-- types.ts                    # Settings, earthquake, session, status, and API types
|   |-- main/
|   |   |-- index.ts                    # App lifecycle, single instance, startup, composition
|   |   |-- ipc.ts                      # Validated IPC handlers and sender checks
|   |   |-- ApplicationPaths.ts         # Data, Logs, Runtime, and Session AppData roots
|   |   |-- earthquakeNetworkConfig.ts  # Authorized APK Firebase/backend client constants
|   |   |-- settingsSchema.ts            # Settings v3 validation and migration
|   |   |-- startup.ts                   # Windows start-on-login and hidden-launch helpers
|   |   |-- security/
|   |   |   `-- RendererNavigationPolicy.ts
|   |   `-- services/
|   |       |-- EarthquakeService.ts     # FCM, backend registration, parsing, alerts, tests
|   |       |-- StorageService.ts        # Settings and earthquake-session JSON persistence
|   |       |-- LoggerService.ts         # Daily logs and retention
|   |       |-- TrayService.ts           # Tray menu and close-to-tray behavior
|   |       |-- WindowService.ts         # Hardened BrowserWindow and diagnostics
|   |       |-- AppUpdater.ts            # Update orchestration
|   |       `-- GitHubReleaseClient.ts   # GitHub release metadata/downloads
|   |-- preload/
|   |   `-- index.ts                    # Typed `window.app` context bridge
|   `-- renderer/
|       |-- index.html
|       `-- src/
|           |-- entryPoint.tsx           # React/i18n/Redux provider bootstrap
|           |-- App.tsx                  # Shell, page routing, update notice, alert overlay
|           |-- components/
|           |   |-- app/                 # Titlebar, navigation, window controls, fullscreen alert
|           |   |-- earthquake/          # Event/user map and distance line
|           |   `-- sidebar/             # Earthquake history; internally SessionsSidebar
|           |-- context/                 # Ant Design and theme providers
|           |-- hooks/                   # Bootstrap, desktop, session, and settings actions
|           |-- i18n/locales/            # en, tr, de, fr, pt, zh, es, ru, ja, ko
|           |-- pages/
|           |   |-- home/                # Earthquake list, map, and event details
|           |   `-- settings/            # General, Display, Earthquake, Updates, Logging, About
|           |-- services/                # Renderer logger, settings queue, bundled alarm
|           |-- store/                   # Single Redux app slice
|           `-- utils/                   # Date and session-summary formatting
|-- tests/                               # 13 Vitest files / 100 tests at time of writing
|-- build/                               # Product icon used by Electron and the tray
|-- images/                              # README screenshots
|-- vite.config.ts
|-- vitest.config.ts
|-- tsconfig.json
|-- tsconfig.node.json
|-- tsconfig.web.json
`-- package.json
```

Generated directories such as `node_modules/`, `out/`, and `release/` are not source. The
`Runtime/Code Cache/electron-preload` directory under AppData is Chromium/V8 cache and is not
application data.

## Commands

```bash
npm run dev            # Vite development server + Electron
npm run start          # Preview the production build from out/
npm run build          # Typecheck, then build main/preload/renderer
npm run typecheck      # Node and web TypeScript projects
npm run typecheck:node # Main, preload, and tests
npm run typecheck:web  # Renderer
npm run test           # Run Vitest once
npm run test:watch     # Watch mode
npm run lint           # Biome lint
npm run format         # Prettier write
npm run format:check   # Prettier verification
npm run package        # Unpacked electron-builder output
npm run package:win    # Windows x64 and arm64 NSIS installers
npm run package:linux  # Linux x64 and arm64 AppImages
npm run release        # Windows and Linux packages
```

For ordinary implementation work, verification means:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

Do not run `package`, `package:win`, `package:linux`, or `release` unless packaging is explicitly
requested. A normal request to verify or build does not authorize creating an EXE/installer.

## Architecture

### Three-Process Separation

1. **Main process** (`src/main/`): owns network access, FCM credentials, filesystem persistence,
   native notifications, tray/startup integration, full-screen window transitions, logs, and
   updates.
2. **Preload** (`src/preload/index.ts`): the only renderer bridge. It exposes a typed
   `EarthquakeSignalApi` as `window.app` using `contextBridge` and whitelisted IPC channels.
3. **Renderer** (`src/renderer/src/`): sandboxed React UI. It has no Node or direct filesystem
   access; system work goes through `window.app`.

The BrowserWindow must retain `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
and `webSecurity: true`. Popups are denied and renderer navigation is allow-listed.

### IPC Design

- Channels live only in `src/shared/IpcChannel.ts` and use `namespace:action` values.
- Commands use `ipcRenderer.invoke` / `ipcMain.handle`.
- Renderer logs use `ipcRenderer.send` / `ipcMain.on`.
- Main-to-renderer updates cover FCM status, newly received earthquakes, clicked notifications,
  updater state, window maximize state, and tray-requested settings navigation.
- Every handler checks the sender against the main window. Unknown IPC input is parsed with Zod or
  explicitly narrowed before use.
- New main capabilities require coordinated edits to the channel enum, shared API type, preload,
  main handler, and relevant IPC tests.

### State Flow

```text
Application startup
  -> StorageService loads settings and earthquake history
  -> EarthquakeService starts/reuses FCM registration
  -> token is registered with Earthquake Network backend
  -> fixed location and 10-degree tile metadata are synchronized
  -> Firebase installation subscribes to global and the fixed-location topic
  -> receiver maintains an MCS connection
  <- raw FCM envelope arrives and is logged
  <- EarthquakePayloadParser normalizes realtime/seismic payload aliases
  -> StorageService upserts one earthquake session
  -> notification policy selects none/normal/fullscreen and alarm state
  -> event:earthquake-received crosses preload
  -> Redux replaces/adds the session and updates the active map
```

Settings changes are serialized by `SettingsPersistenceQueue`. Saving a changed location triggers
an immediate FCM/backend refresh because the location tile has changed.

## Firebase and Earthquake Network Integration

### Receiver Identity

The Firebase client constants in `src/main/earthquakeNetworkConfig.ts` were read from the authorized
Earthquake Network Android APK:

- Android package: `com.finazzi.distquake`
- Firebase project: `hybrid-bastion-406`
- Sender ID: `899482329945`

Native Electron on Windows cannot run the Android Firebase SDK. The project therefore uses
`@eneris/push-receiver`, which creates a Chromium-compatible WebPush transport. Its bundle ID is
the APK package.

### Topics and Fixed Location

The application has exactly two desired channels:

```text
global
x{floor((longitude + 180) / 10)}y{floor((latitude + 90) / 10)}
```

The default coordinate is longitude `32`, latitude `40`, displayed as `32,40`; its tile is
`x21y13`. A location is selected on the settings map rather than typed manually. The 10-by-10-degree
tile remains stable until the selected point crosses a tile boundary.

There is no periodic topic-comparison feature. The FCM receiver is refreshed at startup, after an
application upgrade/restart, after saving a location, when the user requests a check, and on the
configured minute interval. The default interval is 480 minutes.

### Backend Registration

The mobile-compatible registration request is form encoded:

```text
POST https://srv.earthquakenetwork.it/distquake_upload_gcm_regid2.php
u_id=<existing backend ID or 0>
r_id=<complete FCM registration token>
lat=<fixed latitude>
lon=<fixed longitude>
```

The nonzero numeric response is persisted as `backendUserId`. Tile reporting is:

```text
POST https://srv.earthquakenetwork.it/distquake_update_tile.php
u_id=<backend ID>
tile=<xNyN topic>
```

Fixed-location synchronization mirrors the APK's separate location request:

```text
POST https://srv.earthquakenetwork.it/distquake_upload_gcm_latlon.php
u_id=<backend ID>
lat=<fixed latitude>
lon=<fixed longitude>
acc=-1
upd=<1 when either coordinate changed by at least 0.1 degree, otherwise 0>
```

Backend registration, tile reporting, and location synchronization do **not** prove Firebase topic
membership. Although `@eneris/push-receiver` has no topic helper, the application mirrors the APK's
Firebase Messaging SDK request directly:

```text
POST https://fcmregistrations.googleapis.com/v1/projects/<project>/registrations/<fid>/topicSubscriptions/<topic>:subscribe
x-goog-api-key: <Firebase API key>
x-goog-firebase-installations-auth: <installation auth token>
```

The previous fixed-location topic is removed through the corresponding `:unsubscribe` operation.
Only successful Firebase 2xx responses may populate `subscribedTopics`; never infer membership from
backend registration. Runtime Firebase config and VAPID overrides are accepted through
`EARTHQUAKE_FIREBASE_CONFIG` and `EARTHQUAKE_FIREBASE_VAPID_KEY`.

### Firebase Installation Lifecycle

`fcm-state.json` contains WebPush keys, GCM check-in credentials, the final FCM token, Firebase
Installation auth/refresh data, confirmed topics and their FID, persistent message IDs, and the
Earthquake Network backend ID.
Firebase Installation auth tokens last seven days and are refreshed one hour before expiry using
the APK-compatible FIS v2 flow. If refresh fails, the service creates a new installation.

The user intentionally requested that `fcm-state.json` be readable plaintext and that connection
logs contain complete, unredacted FCM tokens and full structured details. Do not silently add
encryption, token shortening, copy controls, or log truncation. This means Data and Logs contain
sensitive credentials; avoid echoing them in development tool output unless the task explicitly
requires it.

`Reset registration` stops the receiver, waits for pending writes, deletes the exact local
`Data/fcm-state.json`, and registers again with `u_id=0`. Token, Firebase Installation ID, GCM
Android ID, GCM app ID, and backend user ID should all change. The operation recreates local/server
registration but does not currently call a remote Firebase Installation delete endpoint.

## Earthquake and Notification Behavior

### Event Types

- `realtime`: preliminary immediate alert data, often with estimated local intensity and revisions.
- `seismic-network`: normal/official network earthquake report with magnitude, depth, place, and
  coordinates.

For realtime payloads, `intensity` is the source classification, not the expected intensity at the
fixed user location. Expected local intensity uses the APK attenuation formula when the payload
does not contain an explicit local-intensity field. Wave visualization/countdown uses the payload's
`wave_speed` and `delay` values. Official payload metadata such as `magnitude_range`, `reports`, and
`data` is retained. Community and social types (`manual`, chat, friendship) are intentionally
ignored.

Both types are always persisted when valid, even if notification preferences suppress UI delivery.
Repeated event IDs are upserted so newer revisions replace the existing stored earthquake.

### Notification Policy

- Realtime notifications require realtime alerts to be enabled and estimated local intensity at
  least 1.5.
- If realtime presentation is `normal`, no bundled alarm sound plays.
- With realtime presentation `fullscreen`, only intensity 3 or greater becomes fullscreen; lower
  intensity remains normal and silent.
- The bundled mobile alarm loops only for an actual fullscreen realtime alert and stops after at
  most three minutes or when the alert is dismissed with Escape.
- Seismic-network notifications require the feature enabled, magnitude at least the configured
  minimum, and distance within the configured maximum. Defaults are magnitude 3 and 1000 km.
- The old Relevant/Custom notification-filter selector has been removed; do not reintroduce it.
- The seismic presentation default is normal; realtime presentation default is fullscreen.
- Clicking any normal native notification opens the Earthquakes list and selects the stored event.

### Maps and Fullscreen Alert

- Settings use a compact Leaflet map with CARTO `light_all`/`dark_all` tiles.
- Event maps show the fixed user location, earthquake epicenter, connecting distance line, and km.
- The home event map does not show the realtime wave circle or “Wave arrived” text.
- Fullscreen realtime alerts show a continuously expanding wavefront calculated at 3.5 km/s and a
  remaining-seconds countdown.
- The fullscreen information box is intentionally compact: alert, magnitude/location, and distance.
  There is no dismiss button; Escape closes the alert.

## Persistence, Sessions, and AppData

`ApplicationPaths` separates durable data from Chromium runtime state:

```text
%APPDATA%/Earthquake Signal/
|-- Data/
|   |-- settings.json
|   |-- fcm-state.json
|   `-- sessions/<uuid>.json
|-- Logs/
|   |-- app.YYYY-MM-DD.log
|   `-- app-error.YYYY-MM-DD.log
`-- Runtime/
    `-- Chromium profile, cache, and session data
```

- Settings are schema revision 3 and migrate old 2/500 seismic defaults to 3/1000.
- Session documents are an internal storage abstraction for earthquake history. The UI calls them
  Earthquakes/Depremler, but code, IPC, Redux, filenames, and types remain `session`.
- Users cannot manually create earthquake sessions. Startup does not create an empty session.
- Zero sessions is valid. Delete and Delete All may leave the history empty; never restore the old
  “at least one session” invariant.
- Rename, delete, and delete-all operations are serialized and session IDs must remain UUID-validated
  to prevent path traversal.
- Logs rotate at 10 MB; general logs retain 30 days and warning/error logs retain 60 days.
- Raw FCM envelopes are logged before parsing. Structured log data is intentionally not truncated.

## Startup, Tray, and Window Rules

- The application is single-instance. A second launch restores/focuses the existing window unless
  it is a hidden startup invocation.
- `Start on startup` defaults to enabled. Windows startup uses `--hidden` and opens in the system
  tray without flashing the main window.
- Start-on-login implies a usable tray icon. Closing the window hides it only when close-to-tray is
  enabled and the tray was created successfully.
- Linux disables tray-dependent settings in the IPC layer.
- Windows native toast clicks use the `earthquake-signal://notification?sessionId=<uuid>` protocol.
- Fullscreen transitions save and restore prior window bounds, maximize state, visibility, and
  always-on-top state.

## Coding Conventions

### TypeScript

- Strict mode is enabled with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Use the `@shared/*`, `@main/*`, and `@renderer/*` aliases in their supported projects.
- Do not use `any`. Treat IPC/network/file content as `unknown` and validate or narrow it.
- Public/exported functions, classes, interfaces, and type aliases should have explicit types and
  JSDoc. File-level comments describe module purpose.
- Prefer const arrays plus derived union types for closed domain sets.
- Preserve serializable shared types: no Electron, React, or Node runtime dependencies in
  `src/shared/`.

### React and State

- Use functional components and hooks; there are no class components.
- Shared application state belongs in the single Redux `appSlice`.
- Keep side effects in hooks/services and components primarily presentational.
- Settings writes go through `useSettingsActions` and `SettingsPersistenceQueue`.
- The Settings page remains lazy-loaded.
- Use Ant Design v6 hook-based app APIs rather than deprecated static message/notification APIs.

### Styling and Localization

- Use co-located SCSS Modules and existing theme CSS variables.
- Avoid new global styles unless they are true application resets/tokens.
- Keep Ant Design controls compatible with both light and dark themes.
- All user-visible text belongs in locale resources. The supported locale list and every locale's
  key shape must stay consistent.
- Internal `sessions` locale keys may remain for code compatibility, but their displayed values
  must describe earthquakes.

### Services and Diagnostics

- Main services use constructor dependency injection; do not introduce mutable singletons.
- Renderer code never imports Node/Electron APIs directly.
- Use `LoggerService`/`createLogger`, never committed `console.log` calls.
- Preserve full raw FCM logging and complete connection metadata per current product requirements.
- Network requests need finite `AbortSignal.timeout` values and errors should produce actionable
  log records without crashing the long-lived receiver.

## Key Design Decisions and Invariants

- Fixed-location receiver: no background GPS movement and no topic polling.
- Exactly two desired channels: `global` plus the selected 10-degree tile.
- Mobile-compatible backend payloads: do not add desktop/developer fields to APK endpoint forms.
- WebPush transport on desktop does not go to the Earthquake Network backend.
- Earthquake history is server-driven: no Add/+ button and no initial placeholder event.
- Internal `session` naming is intentionally retained even though the UI says Earthquakes.
- Alarm audio is the static asset extracted from the mobile application and there is no sound picker.
- Normal realtime presentation is silent; only actual fullscreen realtime presentation plays the
  alarm.
- Auto-update uses GitHub Releases, while installer/package creation remains opt-in during
  development.

## Testing

- Vitest runs in Node; there is no Playwright/Spectron E2E suite.
- Pure helper coverage includes topics, distances, wave timing, notification URLs, formatters, IPC,
  startup parsing, settings, localization, and Redux transitions.
- Integration-style tests cover StorageService, LoggerService, TrayService, renderer navigation, and
  serialized settings writes.
- When changing settings, update `DEFAULT_SETTINGS`, shared types, Zod schemas, migration tests,
  renderer controls, and locale strings together.
- When changing IPC, update all five surfaces: channel enum, API type, preload, main handler, and
  channel tests.
- When changing earthquake parsing/notification behavior, verify that persistence still occurs even
  when notifications are suppressed.

Before handing off a code change, run the full verification sequence. If a command fails because of
an unrelated pre-existing issue, report it precisely rather than hiding or mass-reformatting
unrelated files.
