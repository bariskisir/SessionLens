# Repository Guidelines

## Project Structure & Module Organization

Session Lens is an Electron desktop application. `src/main/` owns native windows, IPC,
providers, persistence, and tray services; `src/preload/index.ts` exposes the secure renderer
bridge. The React UI lives in `src/renderer/src/`, with co-located `*.module.scss` styles;
`src/renderer/public/tray-tooltip/` is a deliberately dependency-free popup. Put shared,
serializable contracts and configuration in `src/shared/`. Tests mirror production units in
`tests/`. Installer assets are in `build/`; screenshots are in `images/`.

## Build, Test, and Development Commands

Use Node 24 or later and install dependencies with `npm ci` (or `npm install` for local work).

- `npm run dev` starts Vite and Electron for development.
- `npm run build` typechecks and creates the production bundles in `out/`.
- `npm run typecheck`, `npm run lint`, and `npm run format:check` validate types, Biome rules,
  and Prettier formatting.
- `npm test` runs Vitest once; `npm run test:watch` keeps it running.

Avoid `package`, platform-specific packaging, and `release` unless creating artifacts is part of
the task.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, LF endings, no semicolons, single quotes, and trailing
commas; Prettier enforces these settings. Use `PascalCase` for React components and classes,
`camelCase` for functions and variables, and descriptive service filenames such as
`UsageRefreshService.ts`. Prefer `@main`, `@shared`, and `@renderer` aliases where supported.
Do not use `any`: validate IPC, file, and network input as `unknown`. Keep renderer code free of
direct Node/Electron access, and add user-facing strings to every locale.

## Testing Guidelines

Vitest uses the Node environment. Add or update `tests/<Unit>.test.ts` with behavior-focused
names, especially for schemas, IPC, provider failure isolation, and services. Run the focused test
while iterating, then run `npm run typecheck && npm test`. Changes to settings or IPC should update
their schemas/contracts and corresponding tests together.

## Commit & Pull Request Guidelines

Follow the history’s concise, imperative convention: `fix(tray): avoid native tooltip` or
`feat: add provider setting`; use `chore:` for maintenance. Keep commits narrowly scoped. PRs
should explain the user-visible change, list validation commands run, link relevant issues, and
include screenshots for renderer or tray UI changes. Never commit credentials, tokens, or local
settings data.
