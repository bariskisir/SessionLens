# Lens -- Development Guide

## Project Overview

Lens is a desktop application shell built with Electron. It provides a complete settings
experience — theme, navigation, zoom, system tray, startup, updates, logging, and about — that a
new application can be built on top of. It is intentionally a template: it has no domain features
yet.

The product version is `1.4.0`.

## Tech Stack

| Layer              | Technology                                                |
| ------------------ | --------------------------------------------------------- |
| Desktop shell      | Electron 43 with `vite-plugin-electron`                   |
| Build              | Vite 8, with separate main, preload, and renderer bundles |
| Language           | TypeScript 7.0                                            |
| UI framework       | React 19.2                                                |
| State              | Redux Toolkit 2.12                                        |
| Component library  | Ant Design 6.5                                            |
| Validation         | Zod 4.4                                                   |
| Localization       | i18next and react-i18next; 10 locales                     |
| Logging            | electron-log in main, custom IPC log bridge in renderer   |
| Styling            | SCSS Modules and CSS custom properties                    |
| Linting/formatting | Biome and Prettier                                        |
| Testing            | Vitest 4.1, Node environment                              |
| Packaging          | electron-builder: NSIS, DMG, and AppImage definitions     |

## Directory Structure

```text
Lens/
|-- src/
|   |-- shared/                         # Cross-process contracts and pure helpers
|   |   |-- appInfo.ts                  # Author and repository constants
|   |   |-- IpcChannel.ts               # Colon-delimited IPC channel enum
|   |   `-- types.ts                    # Settings and API types
|   |-- main/
|   |   |-- index.ts                    # App lifecycle, single instance, startup, composition
|   |   |-- ipc.ts                      # Validated IPC handlers and sender checks
|   |   |-- ApplicationPaths.ts         # Data, Logs, Runtime, and Session AppData roots
|   |   |-- settingsSchema.ts            # Settings v3 validation and migration
|   |   |-- startup.ts                   # Windows start-on-login and hidden-launch helpers
|   |   |-- security/
|   |   |   `-- RendererNavigationPolicy.ts
|   |   `-- services/
|   |       |-- StorageService.ts        # Settings JSON persistence
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
|           |-- App.tsx                  # Shell and update notice
|           |-- components/
|           |   `-- app/                 # Titlebar, navigation, window controls
|           |-- context/                 # Ant Design and theme providers
|           |-- hooks/                   # Bootstrap, desktop, and settings actions
|           |-- i18n/locales/            # en, tr, de, fr, pt, zh, es, ru, ja, ko
|           |-- pages/
|           |   `-- settings/            # General, Display, Updates, Logging, About
|           |-- services/                # Renderer logger and settings queue
|           |-- store/                   # Single Redux app slice
|           `-- utils/                   # Date formatting
|-- tests/                               # Vitest test files
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

1. **Main process** (`src/main/`): owns network access, filesystem persistence, native tray/startup
   integration, logs, and updates.
2. **Preload** (`src/preload/index.ts`): the only renderer bridge. It exposes a typed `LensApi` as
   `window.app` using `contextBridge` and whitelisted IPC channels.
3. **Renderer** (`src/renderer/src/`): sandboxed React UI. It has no Node or direct filesystem
   access; system work goes through `window.app`.

The BrowserWindow must retain `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
and `webSecurity: true`. Popups are denied and renderer navigation is allow-listed.

### IPC Design

- Channels live only in `src/shared/IpcChannel.ts` and use `namespace:action` values.
- Commands use `ipcRenderer.invoke` / `ipcMain.handle`.
- Renderer logs use `ipcRenderer.send` / `ipcMain.on`.
- Main-to-renderer updates cover updater state, window maximize state, and tray-requested settings
  navigation.
- Every handler checks the sender against the main window. Unknown IPC input is parsed with Zod or
  explicitly narrowed before use.
- New main capabilities require coordinated edits to the channel enum, shared API type, preload,
  main handler, and relevant IPC tests.

### State Flow

```text
Application startup
  -> StorageService loads settings
  -> WindowService creates the hardened window
  -> renderer bootstraps settings, platform, and version through preload
  -> Redux hydrates the settings shell
  -> user edits settings; SettingsPersistenceQueue serializes writes
```

Settings changes are serialized by `SettingsPersistenceQueue`.

## Persistence and AppData

`ApplicationPaths` separates durable data from Chromium runtime state:

```text
%APPDATA%/Lens/
|-- Data/
|   `-- settings.json
|-- Logs/
|   |-- app.YYYY-MM-DD.log
|   `-- app-error.YYYY-MM-DD.log
`-- Runtime/
    `-- Chromium profile, cache, and session data
```

- Settings are schema revision 3 and migrate old documents by dropping unknown fields.
- Logs rotate at 10 MB; general logs retain 30 days and warning/error logs retain 60 days.

## Startup, Tray, and Window Rules

- The application is single-instance. A second launch restores/focuses the existing window unless
  it is a hidden startup invocation.
- `Start on startup` defaults to enabled. Windows startup uses `--hidden` and opens in the system
  tray without flashing the main window.
- Start-on-login implies a usable tray icon. Closing the window hides it only when close-to-tray is
  enabled and the tray was created successfully.
- Linux disables tray-dependent settings in the IPC layer.

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

### Services and Diagnostics

- Main services use constructor dependency injection; do not introduce mutable singletons.
- Renderer code never imports Node/Electron APIs directly.
- Use `LoggerService`/`createLogger`, never committed `console.log` calls.
- Network requests need finite `AbortSignal.timeout` values and errors should produce actionable
  log records.

## Key Design Decisions and Invariants

- Lens is intentionally a settings-only shell; there is no home/domain page.
- The app opens directly into the Settings page; the titlebar logo navigates to the general section.
- Earthquakes and sessions were removed; do not reintroduce them.
- Auto-update uses GitHub Releases, while installer/package creation remains opt-in during
  development.

## Testing

- Vitest runs in Node; there is no Playwright/Spectron E2E suite.
- Pure helper coverage includes formatters, IPC, startup parsing, settings, localization, and Redux
  transitions.
- Integration-style tests cover StorageService, LoggerService, TrayService, renderer navigation, and
  serialized settings writes.
- When changing settings, update `DEFAULT_SETTINGS`, shared types, Zod schemas, migration tests,
  renderer controls, and locale strings together.
- When changing IPC, update all five surfaces: channel enum, API type, preload, main handler, and
  channel tests.

Before handing off a code change, run the full verification sequence. If a command fails because of
an unrelated pre-existing issue, report it precisely rather than hiding or mass-reformatting
unrelated files.
