# Focus Timer

A compact macOS desktop app for keeping your computer awake during focused work, long-running tasks, calls, and presentations.

**Website:** [gab-cat.github.io/focus-timer](https://gab-cat.github.io/focus-timer/) · **Download:** [latest release](https://github.com/gab-cat/focus-timer/releases/latest/download/stable-macos-arm64-FocusTimer.dmg)

Focus Timer is built with Electrobun, Bun, React, Vite, and Tailwind CSS. It provides a small desktop window with a session timer, activity status, and manual refresh control.

## Features

- Start and stop focus sessions from a simple desktop window
- Keeps macOS awake during active sessions using `caffeinate`
- Optionally blocks system sleep entirely (`pmset -a disablesleep 1`) for the session, even with the lid closed, and restores it afterwards, including after a crash
- Four actions: ⌘-Tab (default), Mouse only, Scroll, Shift tap
- Acts only once you've been idle for a while, and pauses when the screen is locked, you're on a call, or (optionally) on battery
- **Calls**: notices a call when any app uses the microphone (Zoom, Teams, FaceTime, Slack, Meet in a browser). Moves pause, and a notification offers **End session**; if you end it, the session starts again when the call ends, keeping its stop time
- **Auto-stop**: end a session after a set time (30m, 1h, 2h, 4h or any number of minutes) or at a clock time like 6:30 PM. The Focus screen shows when it will stop before you start
- **Insights**: today / 7-day / all-time totals, a 7×24 heatmap of when it moved, and the action mix
- Runs periodic refresh cycles at randomized intervals
- Shows the next cycle countdown, last refresh time, and total cycle count
- Includes a manual refresh button
- Supports local development with Vite HMR
- Builds as a native Electrobun desktop app

## Responsible Use

Focus Timer is intended for legitimate situations where you need your Mac to stay awake, such as presenting, reading, monitoring a process, joining long calls, or preventing a screen from sleeping during a focus block.

Use it only in ways that comply with your workplace, client, school, and software policies.

## Requirements

- macOS
- Bun
- Electrobun dependencies installed through this project

This app uses macOS command-line tools including `caffeinate` and `osascript`.

## Getting Started

Install dependencies:

```bash
bun install
```

Run the app in development mode:

```bash
bun run dev
```

Run with React hot module replacement:

```bash
bun run dev:hmr
```

Build a canary app:

```bash
bun run build:canary
```

## Blocking System Sleep

With **Settings → Keep awake → Block system sleep** on (the default), starting a session runs `pmset -a disablesleep 1` and ending it runs `pmset -a disablesleep 0`. `pmset` needs root, so macOS asks for your password at session start and end.

To skip the prompts, use **Settings → No password → Set up**. This installs `/etc/sudoers.d/focus-timer`, which allows only those two exact `pmset` commands without a password. The rule is checked with `visudo` before it goes live. **Remove** deletes it.

If the app quits unexpectedly mid-session, the next launch restores normal sleep.

## Calls

A call is any app using the microphone for more than 10 seconds, read from CoreAudio (the same signal as the orange microphone dot). It ends after 30 seconds of quiet. Siri, dictation and Voice Control are ignored. **Settings → Calls → When a call starts** has three modes:

- **Ask** (default): moves pause and a notification offers **End session** or **Keep running**. If you end it, the session starts again when the call ends, with the same stop time. The sleep block stays on in between, so no password prompt appears mid-call.
- **Pause**: moves pause until the call ends.
- **Off**: calls change nothing.

The notification buttons come from a small native library, `native/notify.m`, built by `bun run native` (Xcode Command Line Tools) and bundled at `Resources/app/native/libftnotify.dylib`. Without it, the app falls back to plain notifications and the prompt shows in the window and the menu bar menu.

## Permissions

| Permission | Why | When it's asked |
| --- | --- | --- |
| Accessibility | Posting mouse, scroll and key events | First session |
| Administrator (once, optional) | `pmset disablesleep` | Session start, or once with **Skip the password** |
| Notifications | The call prompt and the auto-stop notice | First session, or **Settings → Calls → Allow** |

## Troubleshooting

**`bun dev` exits immediately with no output.** The Electrobun CLI binary ships with an invalid ad-hoc code signature, and newer macOS kills it on launch. The npm wrapper then exits 0 without saying anything. `bun install` (postinstall) and every `dev`/`start`/`build` script now run `scripts/ensure-electrobun-cli.ts`, which re-signs it. To fix it by hand:

```bash
codesign --force --sign - node_modules/electrobun/bin/electrobun
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run icons` | Generate macOS icon assets from `assets/logo.svg` |
| `bun run start` | Build the Vite view and run Electrobun dev |
| `bun run dev` | Run Electrobun in watch mode |
| `bun run dev:hmr` | Run Vite HMR and Electrobun together |
| `bun run hmr` | Start the Vite dev server on port `5173` |
| `bun run build:canary` | Build the canary desktop app |
| `bun run ensure-cli` | Re-sign the Electrobun CLI if macOS would kill it |
| `bun run native` | Build the notification library in `native/` (runs before `start`, `dev` and `build`) |
| `bun test` | Run the unit tests (auto-stop times, call detection, settings migration) |

## Project Structure

```text
.
├── assets/
│   └── logo.svg
├── native/
│   └── notify.m          # notifications with buttons (UserNotifications)
├── scripts/
│   ├── build-icons.ts
│   └── build-native.ts   # compiles native/notify.m
├── src/
│   ├── bun/
│   │   ├── index.ts      # session, auto-stop and call flow
│   │   ├── calltracker.ts
│   │   ├── mic.ts        # microphone-in-use check via CoreAudio
│   │   ├── notify.ts
│   │   ├── settings.ts
│   │   ├── sleepguard.ts
│   │   └── tray.ts
│   ├── mainview/
│   │   ├── App.tsx
│   │   ├── AutoStop.tsx
│   │   ├── Focus.tsx
│   │   ├── Settings.tsx
│   │   └── rpc.ts
│   └── shared/
│       ├── time.ts       # auto-stop times and labels
│       └── types.ts
├── electrobun.config.ts
├── package.json
└── vite.config.ts
```

## How It Works

The Bun main process owns the desktop window and session state. When a session starts, it launches `caffeinate` to prevent macOS from sleeping and schedules the next refresh cycle.

The React view talks to the Bun process through Electrobun RPC:

- `setEnabled` starts or stops a session
- `getStatus` reads the current session state
- `triggerNow` runs a manual refresh
- `endForCall`, `dismissCallPrompt` and `cancelCallHold` answer the call prompt
- `statusChanged` pushes updates back to the UI

In development, the app attempts to load the Vite dev server from `http://localhost:5173`. If the dev server is not running, it falls back to the bundled `views://mainview/index.html` asset.

## App Metadata

The desktop app metadata lives in `electrobun.config.ts`:

```ts
app: {
  name: "Focus Timer",
  identifier: "com.focustimer.app",
  version: "0.0.1",
}
```

The main window title is configured in `src/bun/index.ts`.

## Notes

- The app is currently optimized for macOS.
- The window is fixed at `380x600` (the same size as Voice Notes), with content drawn under a hidden-inset title bar. The Focus dial scales to the height it has.
- Refresh timing defaults to 90–180 seconds, picked uniformly at random.
- Built files are generated under `build/`.
