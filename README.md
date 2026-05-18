# Focus Timer

A compact macOS desktop app for keeping your computer awake during focused work, long-running tasks, calls, and presentations.

Focus Timer is built with Electrobun, Bun, React, Vite, and Tailwind CSS. It provides a small desktop window with a session timer, activity status, and manual refresh control.

## Features

- Start and stop focus sessions from a simple desktop window
- Keeps macOS awake during active sessions using `caffeinate`
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

## Scripts

| Command | Description |
| --- | --- |
| `bun run icons` | Generate macOS icon assets from `assets/logo.svg` |
| `bun run start` | Build the Vite view and run Electrobun dev |
| `bun run dev` | Run Electrobun in watch mode |
| `bun run dev:hmr` | Run Vite HMR and Electrobun together |
| `bun run hmr` | Start the Vite dev server on port `5173` |
| `bun run build:canary` | Build the canary desktop app |

## Project Structure

```text
.
├── assets/
│   └── logo.svg
├── scripts/
│   └── build-icons.ts
├── src/
│   ├── bun/
│   │   └── index.ts
│   ├── mainview/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── rpc.ts
│   └── shared/
│       └── types.ts
├── electrobun.config.ts
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## How It Works

The Bun main process owns the desktop window and session state. When a session starts, it launches `caffeinate` to prevent macOS from sleeping and schedules the next refresh cycle.

The React view talks to the Bun process through Electrobun RPC:

- `setEnabled` starts or stops a session
- `getStatus` reads the current session state
- `triggerNow` runs a manual refresh
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
- The window is fixed at `380x460`.
- Refresh timing is randomized between 90 and 180 seconds.
- Built files are generated under `build/`.
