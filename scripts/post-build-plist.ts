#!/usr/bin/env bun
// Adds Info.plist keys Electrobun doesn't generate. The osascript helper we
// spawn inherits this app's TCC identity, so the Apple Events prompt shows
// this description.
// NSAppSleepDisabled keeps App Nap off for the whole app.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
if (process.env.ELECTROBUN_OS !== "macos" || process.platform !== "darwin" || !buildDir) {
	process.exit(0);
}

const KEYS: Record<string, string | boolean> = {
	NSAppleEventsUsageDescription: "Focus Timer sends keystrokes like ⌘-Tab during sessions.",
	// Opt out of App Nap. A napped app fires its timers late (so moves drift)
	// and takes seconds to wake when you bring the window back.
	NSAppSleepDisabled: true,
};

let apps: string[] = [];
try {
	apps = readdirSync(buildDir).filter((name) => name.endsWith(".app"));
} catch {}

for (const app of apps) {
	const plist = join(buildDir, app, "Contents", "Info.plist");
	for (const [key, value] of Object.entries(KEYS)) {
		// -replace inserts when missing and overwrites when present.
		const type = typeof value === "boolean" ? "-bool" : "-string";
		const r = Bun.spawnSync(["plutil", "-replace", key, type, String(value), plist]);
		if (r.exitCode !== 0) {
			console.error(`post-build-plist: failed to set ${key} in ${plist}`);
			process.exit(1);
		}
	}
	console.log(`post-build-plist: updated Info.plist keys in ${app}`);
}
