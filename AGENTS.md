# Session Lens -- Development Guide

## Project Overview

Session Lens is a desktop AI-coding usage monitor built with Electron. It queries the usage
(rate-limit) endpoints of AI coding assistant providers through their official APIs, renders
live quota bars on the system tray icon, shows a per-provider usage card tooltip on tray hover,
detects threshold crossings, and delivers notifications natively and through Telegram/Discord
webhooks. When a provider's reset deadline advances, it optionally starts a minimal session so
the new quota is consumed immediately.

The product version is `1.0.0`. The internal TypeScript model and persistence use the
`settings`/`provider` naming, while the UI groups provider configuration under the **Providers**
settings section.

## Tech Stack

| Layer              | Technology                                                |
| ------------------ | --------------------------------------------------------- |
| Desktop shell      | Electron 43.2 with `vite-plugin-electron` 1.1             |
| Build              | Vite 8.1, with separate main, preload, and renderer bundles |
| Language           | TypeScript 7.0                                            |
| UI framework       | React 19.2                                                |
| State              | Redux Toolkit 2.12                                        |
| Component library  | Ant Design 6.5                                            |
| Drag and drop      | `@hello-pangea/dnd` 18 (provider list ordering)           |
| Icons              | `lucide-react`                                            |
| Validation         | Zod 4.4                                                   |
| Localization       | i18next and react-i18next; 10 locales                     |
| Logging            | electron-log 5.4 in main, custom IPC log bridge in renderer |
| Styling            | SCSS Modules and CSS custom properties                    |
| Linting/formatting | Biome and Prettier                                        |
| Testing            | Vitest 4.1, Node environment                              |
| Packaging          | electron-builder: NSIS (Windows), AppImage (Linux), DMG (macOS) |

## Directory Structure

```text
SessionLens/
|-- src/
|   |-- shared/                         # Cross-process contracts and pure helpers
|   |   |-- appInfo.ts                  # Author and repository constants
|   |   |-- IpcChannel.ts               # Colon-delimited IPC channel enum
|   |   |-- types.ts                    # Re-exports from @shared/config/*
|   |   |-- config/
|   |   |   |-- constants.ts            # Locales, theme modes, zoom/scale limits, log levels
|   |   |   |-- defaults.ts             # DEFAULT_SETTINGS and DEFAULT_NOTIFICATION
|   |   |   `-- providers.ts            # PROVIDER_DESCRIPTORS provider catalog
|   |-- main/
|   |   |-- index.ts                    # App lifecycle, single instance, startup, composition
|   |   |-- ipc.ts                      # Validated IPC handlers and sender checks
|   |   |-- ApplicationPaths.ts         # Data, Logs, and Runtime AppData roots
|   |   |-- settingsSchema.ts           # Settings v4 validation, normalization, and migration
|   |   |-- startup.ts                  # Windows start-on-login and --hidden launch helpers
|   |   |-- windowState.ts              # Persisted bounds/maximize/fullscreen and display fitting
|   |   |-- security/
|   |   |   `-- RendererNavigationPolicy.ts
|   |   |-- providers/
|   |   |   |-- registry.ts             # Central provider registry (ALL_PROVIDERS)
|   |   |   |-- IProvider.ts            # Provider contract and query context helpers
|   |   |   |-- BaseOAuthProvider.ts    # Shared OAuth refresh flow
|   |   |   |-- BaseAuthReader.ts       # Credential discovery contract
|   |   |   |-- BaseApiKeyProvider.ts   # Unified API-key provider base
|   |   |   `-- CredentialProbe.ts      # Configured-provider credential detection
|   |   |-- services/
|   |   |   |-- StorageService.ts       # Serialized settings.json persistence
|   |   |   |-- LoggerService.ts        # Daily logs and retention
|   |   |   |-- WindowService.ts        # Hardened BrowserWindow and window-state persistence
|   |   |   |-- TrayService.ts          # Tray icon, quota bars, and hover tooltip popup
|   |   |   |-- AppUpdater.ts           # Update orchestration
|   |   |   |-- GitHubReleaseClient.ts  # GitHub release metadata/downloads
|   |   |   `-- usage/
|   |   |       |-- UsageRefreshService.ts    # Background refresh loop and manual refresh
|   |   |       |-- UsageAggregator.ts        # Concurrent provider queries with fault isolation
|   |   |       |-- UsageWindowStartService.ts # Reset-deadline warm-up start requests
|   |   |       |-- WindowStartRequestSender.ts # Minimal session-start requests
|   |   |       |-- NotificationDispatcher.ts  # Threshold evaluation and native/webhook delivery
|   |   |       |-- ThresholdNotifier.ts       # Baseline tracking and crossing detection
|   |   |       |-- NotificationMessageFormatter.ts
|   |   |       |-- TooltipCardBuilder.ts      # Snapshot -> tooltip card models
|   |   |       |-- IconLayout.ts              # Auto/manual tray bar layout computation
|   |   |       |-- CodexAuthReader.ts         # Codex credential discovery
|   |   |       |-- ClaudeAuthReader.ts        # Claude credential discovery
|   |   |       |-- AntigravityAuthReader.ts   # Antigravity credential discovery
|   |   |       |-- ProviderHttp.ts            # Finite-timeout HTTP helpers for provider calls
|   |   |       |-- ProviderJson.ts            # Typed JSON response parsing
|   |   |       |-- ProviderAuthFlow.ts        # OAuth token acquisition/refresh
|   |   |       |-- UsageFormatting.ts         # Number/percent/duration formatting
|   |   |       |-- TrayIconRenderer.ts        # Tray PNG composition from usage bars
|   |   |       `-- providers/                # One class per provider (Codex, Claude, DeepSeek, ...)
|   |-- preload/
|   |   `-- index.ts                    # Typed `window.SessionLensApi` context bridge
|   `-- renderer/
|       |-- index.html
|       |-- public/
|       |   `-- tray-tooltip/            # Static popup page (no framework, no preload)
|       |       |-- index.html
|       |       |-- tooltip.css
|       |       |-- tooltip.js
|       |       `-- <provider>.svg       # Provider brand icons read by tooltip.js
|       `-- src/
|           |-- entryPoint.tsx           # React/i18n/Redux provider bootstrap
|           |-- App.tsx                  # Shell, titlebar, sidebar, lazy settings page, update notice
|           |-- components/
|           |   |-- app/                 # Titlebar, AppSidebar, navigation actions, window controls
|           |-- context/                 # Ant Design and theme providers
|           |-- hooks/                   # Bootstrap, desktop, and settings actions
|           |-- i18n/locales/            # en, tr, de, fr, pt, zh, es, ru, ja, ko
|           |-- pages/
|           |   `-- settings/            # Settings page; sections/ holds one section per feature
|           |       |-- sections/        # General, Display, Tray, Icon, Tooltip, Providers, Default models,
|           |       |                    # Notifications, Updates, Logging, About
|           |       `-- components/
|           |-- services/                # Renderer logger bridge, SettingsPersistenceQueue
|           |-- store/                   # Single Redux app slice
|           |-- utils/                   # Formatting helpers
|           `-- assets/styles/           # Shared SCSS variables and resets
|-- tests/                               # 18 Vitest files / 129 tests at time of writing
|-- build/                               # Product and notification icons used by the installer
|-- vite.config.mts
|-- vitest.config.mts
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
npm run package:win:x64 / package:win:arm64
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

1. **Main process** (`src/main/`): owns provider HTTP queries, OAuth token refresh, filesystem
   persistence, native notifications, tray icon rendering and the tooltip popup, startup
   integration, logs, and updates.
2. **Preload** (`src/preload/index.ts`): the only renderer bridge. It exposes a typed
   `SessionLensApi` as `window.SessionLensApi` using `contextBridge` and whitelisted IPC channels.
3. **Renderer** (`src/renderer/src/`): sandboxed React UI. It has no Node or direct filesystem
   access; system work goes through `window.SessionLensApi`.

The BrowserWindow must retain `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
and `webSecurity: true`. Popups are denied and renderer navigation is allow-listed. The tray
tooltip window uses the same isolation defaults and has no preload script.

### IPC Design

- Channels live only in `src/shared/IpcChannel.ts` and use `namespace:action` values.
- Commands use `ipcRenderer.invoke` / `ipcMain.handle`.
- Renderer logs use `ipcRenderer.send` / `ipcMain.on`.
- Main-to-renderer updates cover usage snapshots, updater state, window maximize state, and
  tray-requested settings navigation.
- Every handler checks the sender against the main window. Unknown IPC input is parsed with Zod or
  explicitly narrowed before use.
- New main capabilities require coordinated edits to the channel enum, shared API type, preload,
  main handler, and relevant IPC tests.

### State Flow

```text
Application startup
  -> StorageService loads and validates settings
  -> window bounds are restored and fitted to current displays
  -> TrayService creates the tray icon and pre-loads the tooltip popup
  -> UsageRefreshService starts the background refresh loop
  <- UsageAggregator queries every enabled and configured provider concurrently
  <- each provider returns windows/balance results; failures are isolated and logged
  -> IconLayout computes tray bar proportions and redraws the tray icon
  -> TooltipCardBuilder models the snapshot for the tray tooltip
  -> NotificationDispatcher evaluates thresholds against the baseline
  -> event:usage-snapshot-changed crosses preload into Redux
  -> UsageWindowStartService optionally starts minimal sessions after resets
```

Settings changes are validated with Zod in `settingsSchema.ts`, written by `StorageService`
(serialized per-file operation locks), and queued in the renderer by `SettingsPersistenceQueue`.

## Provider Integration

### Descriptor Catalog

Every provider is described declaratively in `src/shared/config/providers.ts` as a
`PROVIDER_DESCRIPTORS` entry: id, display name, type (`oauth` | `apiKey`), icon key, optional
environment credential name, tray-bar eligibility, and start-window-after-reset flag. The catalog
drives settings UI, icon resolution, tray bars, and credential fallback; do not hardcode
per-provider mappings elsewhere.

### Provider Contract and Registry

`IProvider` defines `id`, `providerName`, `isConfigured(context)`, and `query(context)`. Each
refresh builds one `ProviderQueryContext` carrying the reference timestamp, resolved API keys
(settings value first, then the same-named environment variable), and the per-provider
token-refresh permission map.

`src/main/providers/registry.ts` is the single place where provider instances are created.
Adding a provider requires only:

1. Create the provider class file in `src/main/services/usage/providers/`.
2. Add one entry to `PROVIDER_DESCRIPTORS`.
3. Add one line to the registry.

Three OAuth providers (Codex, Claude, Antigravity) extend `BaseOAuthProvider` and resolve
credentials through their `*AuthReader`. All API-key providers extend the unified
`BaseApiKeyProvider` from `src/main/providers/`; their class files live in
`src/main/services/usage/providers/` and the registry wires each one to its descriptor from the
catalog.

### Queries and Refresh

- `UsageAggregator` queries all eligible providers concurrently, applies a per-provider timeout,
  and isolates failures so one broken provider cannot block the snapshot. Only enabled providers
  with usable credentials are queried.
- `UsageRefreshService` runs the loop on the configured interval (default 5 minutes, capped at
  1440) and coalesces manual refresh requests.
- `UsageWindowStartService` observes reset deadlines between refreshes. When a reset advances or
  an unused window's reset timestamp moves later, it triggers a warm-up session start request
  (Codex/Claude/Antigravity only) so the new quota starts being consumed.
- Tray icon bars come from `IconLayout`: `auto` distributes height equally over all metric
  windows; `manual` uses user-configured per-provider weights and bar allocation.

### Notifications

`NotificationDispatcher` evaluates windows against a `ThresholdNotifier` baseline. First
observations are recorded silently; crossings are detected from the second observation onward and
emitted in severity order (critical, high, reset). Delivery covers the native OS notification and
every enabled remote channel (Telegram via bot token/chat ID, Discord via webhook). The
`notification:test` IPC channel sends a test alert through the same paths.

Native toasts are read-only: clicking one only dismisses it — never opening a window or launching
a fresh instance. Outstanding toasts are closed on quit so stale Action Center entries cannot
relaunch a bare executable (dev) or a second app instance. The Windows toast activator is
registered eagerly at startup (`Notification.isSupported()`) so toast clicks route into the
running process, and COM activation launches (`-Embedding`) start hidden like `--hidden`.
In development the activator's `LocalServer32` launch command is repaired at startup
(`ToastActivatorRepair`) so a cold toast click starts the app instead of Electron's default screen.

## Persistence and AppData

`ApplicationPaths` separates durable data from Chromium runtime state:

```text
%APPDATA%/Session Lens/
|-- Data/
|   |-- settings.json
|   `-- window-state.json
|-- Logs/
|   |-- app.YYYY-MM-DD.log
|   `-- app-error.YYYY-MM-DD.log
`-- Runtime/
    `-- Chromium profile, cache, and session data
```

- Settings are schema revision 4; `parsePersistedSettings` and `normalizeSettings` validate and
  repair documents, falling back to `DEFAULT_SETTINGS` when malformed.
- `StorageService` serializes file operations per path so concurrent writes cannot interleave;
  writes are atomic whole-file JSON replacements.
- Window state (bounds, maximized, fullscreen) is persisted and fitted back onto the current
  display work areas at startup.
- Logs rotate at 10 MB; general logs retain 30 days and warning/error logs retain 60 days.
- API keys and OAuth tokens are stored in the user's settings and local credential files; never
  log or echo resolved credentials.

## Startup, Tray, and Window Rules

- The application is single-instance. A second launch restores/focuses the existing window unless
  it is a hidden startup invocation.
- `Start on startup` defaults to enabled. Windows startup uses `--hidden` and opens in the system
  tray without flashing the main window; the tray icon is forced on for hidden launches.
- Start-on-login is skipped on Linux in the IPC layer.
- `Minimize to tray on close` defaults to enabled; closing the window hides it only when the tray
  was created successfully.
- Tray settings default to enabled (`showTrayIcon`, `minimizeToTrayOnClose`, `startMinimized`). The
  start-minimized preference hides the window to the tray on launch whenever the tray icon is
  enabled.
- The tray icon shows per-provider quota bars and rebuilds them on every snapshot.
- The hover tooltip is a pre-created, non-focusable, transparent popup (`showInactive`, mouse
  events ignored) that is hidden on hover-out and destroyed only on dispose. Its renderer keeps
  background throttling disabled so `executeJavaScript` measurement keeps working after
  hide/show cycles.
- The popup stays closed and the tray glyph stays default while no usage data has been collected
  yet (offline or before the first refresh); hovering does nothing until the first card exists.
  A hung or dead popup renderer is discarded and rebuilt on the next hover, and the
  Windows-native tray hover tooltip is suppressed so it cannot overlap the custom popup.
- Windows window animations are disabled via the `wm-window-animations-disabled` switch.
- The window is frameless (Windows/Linux) with a custom titlebar; macOS uses a hidden title bar
  with overlay controls.
- Updates are checked against GitHub Releases when `autoUpdate` is enabled; the NSIS installer is
  launched silently with `--updated --force-run` for unattended updates.

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
- Use `@hello-pangea/dnd` only for the provider list ordering; keep it out of shared code.

### Styling and Localization

- Use co-located SCSS Modules and existing theme CSS variables.
- Avoid new global styles unless they are true application resets/tokens.
- Keep Ant Design controls compatible with both light and dark themes.
- All user-visible text belongs in locale resources. The supported locale list and every locale's
  key shape must stay consistent.
- The tooltip popup under `public/tray-tooltip` is intentionally plain HTML/CSS/JS with no
  framework and no preload; keep it dependency-free and locale-agnostic.

### Services and Diagnostics

- Main services use constructor dependency injection; do not introduce mutable singletons.
- Renderer code never imports Node/Electron APIs directly.
- Use `LoggerService`, never committed `console.log` calls.
- Network requests need finite timeouts and errors should produce actionable log records without
  crashing the long-lived refresh loop.
- Provider failures are logged with provider name and reason; never log credentials.

## Key Design Decisions and Invariants

- Provider behavior is data-driven: one descriptor catalog drives settings, icons, bars, and
  credentials; no per-provider hardcoding outside the catalog.
- All providers share one `IProvider` contract; OAuth and API-key flows differ only in credential
  resolution.
- Query failures are isolated per provider; a broken provider must never block the snapshot or
  crash the tray.
- The tray tooltip is a static, preloaded page bridged only by a base64-encoded measure payload;
  it has no Node access and is never destroyed on hover-out.
- Threshold crossings are detected only from the second observation onward (first observation
  establishes the baseline).
- Tray icon layout can be fully manual: users control which providers occupy bars and their
  relative weights.
- Window start requests are warm-up-only and limited to providers that support it
  (`startWindowAfterReset`); they must not be triggered on ordinary refresh cycles.
- Auto-update uses GitHub Releases, while installer/package creation remains opt-in during
  development.
- API keys fall back to environment variables named after the provider credential; this keeps
  development setups secret-free.

## Testing

- Vitest runs in Node; there is no Playwright/Spectron E2E suite.
- Pure helper coverage includes IPC channels, icon layout, formatters, settings schema,
  localization, window state, and Redux transitions.
- Integration-style tests cover StorageService, LoggerService, TrayService, UsageWindowStartService,
  AppUpdater, startup parsing, renderer navigation, and serialized settings writes.
- When changing settings, update `DEFAULT_SETTINGS`, shared types, Zod schemas, migration tests,
  renderer controls, and locale strings together.
- When changing IPC, update all five surfaces: channel enum, API type, preload, main handler, and
  channel tests.
- When adding or changing a provider, update the descriptor catalog, the registry, and verify
  that a failing provider is isolated (aggregator fault-isolation tests).

Before handing off a code change, run the full verification sequence. If a command fails because of
an unrelated pre-existing issue, report it precisely rather than hiding or mass-reformatting
unrelated files.
