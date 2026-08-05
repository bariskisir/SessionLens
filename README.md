# Session Lens

Monitor your AI usage limits at a glance. Session Lens lives in your system tray and
tracks rate limits, token quotas, and credit balances across 20+ AI providers — Codex,
Claude, Antigravity, Copilot, Warp, Kilo, MiniMax, and more. Color-coded tray bars show
usage at a glance; hover for a detailed tooltip with per-provider breakdowns.

**Key features**

- **Tray icon** with dynamic quota bars — green through red as limits fill up
- **Tooltip popup** with provider cards, usage percentages, and reset countdowns
- **Threshold notifications** via Windows balloon, Telegram, and Discord when limits cross high or critical levels
- **Warm-window requests** that automatically start a new session window after a usage reset so your tool is ready when you are
- **20+ AI providers** supported out of the box with API-key and OAuth authentication
- **Customizable refresh interval**, notification thresholds, tooltip scale, and icon layout

![Session Lens interface](images/interface.png)
![Session Lens interface](images/interface2.png)

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
