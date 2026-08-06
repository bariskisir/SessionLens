<p align="center">
  <img src="build/icon.png" alt="Session Lens logo" width="88">
</p>

<h1 align="center">Session Lens</h1>

<p align="center">
  Monitor your AI usage limits at a glance.
</p>

<p align="center">
  <a href="https://github.com/bariskisir/SessionLens/actions/workflows/release.yml"><img src="https://github.com/bariskisir/SessionLens/actions/workflows/release.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/bariskisir/SessionLens/releases/latest"><img src="https://img.shields.io/github/v/release/bariskisir/SessionLens" alt="Latest release"></a>
  <a href="https://github.com/bariskisir/SessionLens/releases"><img src="https://img.shields.io/github/downloads/bariskisir/SessionLens/total" alt="Total downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

<p align="center">
  <img src="images/interface.png" alt="Session Lens interface" width="840">
  <img src="images/interface2.png" alt="Session Lens interface" width="840">
</p>

**Key features**

- **Tray icon** with dynamic quota bars — green through red as limits fill up
- **Tooltip popup** with provider cards, usage percentages, and reset countdowns
- **Threshold notifications** via Windows balloon, Telegram, and Discord when limits cross high or critical levels
- **Warm-window requests** that automatically start a new session window after a usage reset so your tool is ready when you are
- **20+ AI providers** supported out of the box with API-key and OAuth authentication
- **Customizable refresh interval**, notification thresholds, tooltip scale, and icon layout

## Install

Download the latest release for your platform from [Releases](https://github.com/bariskisir/SessionLens/releases/latest).

## Development

```bash
git clone https://github.com/bariskisir/SessionLens.git
cd SessionLens
npm install
npm run dev
```

## License

MIT
