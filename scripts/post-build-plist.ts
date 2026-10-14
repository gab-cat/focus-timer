#!/usr/bin/env bun
// Adds Info.plist keys Electrobun doesn't generate. macOS refuses (or kills)
// Calendar access requests from an app without a usage description, and the
// osascript helper we spawn inherits this app's TCC identity.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
if (process.env.ELECTROBUN_OS !== "macos" || process.platform !== "darwin" || !buildDir) {
	process.exit(0);
}

const CALENDAR_REASON =
	"Focus Timer pauses activity while you're in a meeting. Event details never leave your Mac.";

const KEYS: Record<string, string> = {
	NSCalendarsUsageDescription: CALENDAR_REASON,
	NSCalendarsFullAccessUsageDescription: CALENDAR_REASON,
	NSAppleEventsUsageDescription: "Focus Timer sends keystrokes like ⌘-Tab during sessions.",
};

let apps: string[] = [];
try {
	apps = readdirSync(buildDir).filter((name) => name.endsWith(".app"));
} catch {}

for (const app of apps) {
	const plist = join(buildDir, app, "Contents", "Info.plist");
	for (const [key, value] of Object.entries(KEYS)) {
		// -replace inserts when missing and overwrites when present.
		const r = Bun.spawnSync(["plutil", "-replace", key, "-string", value, plist]);
		if (r.exitCode !== 0) {
			console.error(`post-build-plist: failed to set ${key} in ${plist}`);
			process.exit(1);
		}
	}
	console.log(`post-build-plist: added usage descriptions to ${app}`);
}
