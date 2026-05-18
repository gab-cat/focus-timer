import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json" with { type: "json" };

export default {
	app: {
		name: "Focus Timer",
		identifier: "com.focustimer.app",
		version: pkg.version,
	},
	release: {
		// Each GitHub Release must include the artifacts named
		// stable-macos-arm64-update.json and stable-macos-arm64-FocusTimer.app.tar.zst
		// (and matching .patch files when present). `/latest/download/<asset>`
		// redirects to the newest release's asset of that name.
		baseUrl: "https://github.com/gab-cat/focus-timer/releases/latest/download",
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
