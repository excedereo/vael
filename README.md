# Vael

A clean, minimal desktop interface for Claude Code — built for people who want to work with Claude without touching the terminal.

![version](https://img.shields.io/badge/version-0.1.5-a78bfa)
![platform](https://img.shields.io/badge/platform-Windows-blue)
![downloads](https://img.shields.io/github/downloads/excedereo/vael/total?label=downloads&color=a78bfa)

## What is this

Vael is an Electron app that wraps Claude Code CLI with a proper chat UI. It handles sessions, accounts, file attachments, and all the settings you'd otherwise configure through config files — presented in a way that actually makes sense.

## Download

Grab the latest installer from the [Releases](https://github.com/excedereo/vael/releases/latest) page.

**Requirements before installing:**
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
- Windows (other platforms untested)

## Features

- **Chat** — clean message view with thinking indicators, tool use display, and compact summaries
- **Sessions** — persistent history, rename, delete, quick switching
- **Multiple accounts** — add, switch, log out and back in without losing sessions
- **Model & effort control** — pick any model including custom IDs, set effort and permission mode per message
- **Settings** — all relevant Claude CLI options in one place, no config files needed
- **Themes** — dark by default, customizable via JSON theme files
- **Custom avatar slots** — replace the default icons with your own

## Building from source

```bash
git clone https://github.com/excedereo/vael
cd vael
npm install
npm run dev
```

To build:

```bash
npm run build
```

## License

AGPL-3.0 license
