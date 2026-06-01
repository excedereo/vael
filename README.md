# Vael

A clean, minimal desktop interface for Claude Code — built for people who want to work with Claude without touching the terminal.

![version](https://img.shields.io/badge/version-0.1.5-a78bfa)
![platform](https://img.shields.io/badge/platform-Windows-blue)

## What is this

Vael is an Electron app that wraps Claude Code CLI with a proper chat UI. It handles sessions, accounts, file attachments, and all the settings you'd otherwise configure through config files — presented in a way that actually makes sense.

## Features

- **Chat** — clean message view with thinking indicators, tool use display, and compact summaries
- **Sessions** — persistent history, rename, delete, quick switching
- **Multiple accounts** — add, switch, log out and back in without losing sessions
- **Model & effort control** — pick any model including custom IDs, set effort and permission mode per message
- **Settings** — all relevant Claude CLI options in one place, no config files needed
- **Themes** — dark by default, customizable via JSON theme files
- **Custom avatar slots** — replace the default icons with your own

## Requirements

- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
- Node.js 18+
- Windows (other platforms untested)

## Getting started

```bash
git clone https://github.com/stralitz/vael
cd vael
npm install
npm run dev
```

To build:

```bash
npm run build
```

## License

MIT
