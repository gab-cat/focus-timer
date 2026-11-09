#!/usr/bin/env bun
// Compiles native/notify.m into native/build/libftnotify.dylib, which
// electrobun.config.ts copies into the app (Resources/app/native/).
// Skips the compile when the dylib is newer than its source.
//
// Needs the Xcode Command Line Tools (clang). GitHub's macOS runners have them.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin") process.exit(0);

const root = join(import.meta.dir, "..");
const src = join(root, "native", "notify.m");
const outDir = join(root, "native", "build");
const out = join(outDir, "libftnotify.dylib");

if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) process.exit(0);

mkdirSync(outDir, { recursive: true });
const result = Bun.spawnSync(
	[
		"clang",
		"-dynamiclib",
		"-fobjc-arc",
		"-O2",
		"-arch",
		"arm64",
		"-mmacosx-version-min=12.0",
		"-framework",
		"Foundation",
		"-framework",
		"UserNotifications",
		"-framework",
		"AppKit",
		"-framework",
		"QuartzCore",
		"-framework",
		"CoreAudio",
		"-install_name",
		"@rpath/libftnotify.dylib",
		"-o",
		out,
		src,
	],
	{ stdio: ["ignore", "inherit", "inherit"] },
);

if (result.exitCode !== 0) {
	console.error("build-native: clang failed. Install the Xcode Command Line Tools: xcode-select --install");
	process.exit(result.exitCode ?? 1);
}
console.log("build-native: built native/build/libftnotify.dylib");
