#!/usr/bin/env bun
// Compiles native/ai-helper (the Apple Intelligence bridge) with swiftc.
// electrobun.config.ts copies the result into the app bundle. Needs the
// macOS 26 SDK (Xcode 26 or its Command Line Tools); skips work when the
// binary is newer than its source.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "native", "ai-helper", "main.swift");
const output = join(root, "native", "ai-helper", ".build", "ai-helper");

if (process.platform !== "darwin") {
	console.log("build-ai-helper: not on macOS, skipping");
	process.exit(0);
}

if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) {
	process.exit(0);
}

mkdirSync(join(output, ".."), { recursive: true });

// Deploys below macOS 26 with FoundationModels weak-linked, so the helper
// still starts on older systems and reports "unsupportedOS".
const result = Bun.spawnSync(
	[
		"xcrun",
		"swiftc",
		"-O",
		"-target",
		"arm64-apple-macos13.0",
		"-Xlinker",
		"-weak_framework",
		"-Xlinker",
		"FoundationModels",
		source,
		"-o",
		output,
	],
	{ stdio: ["ignore", "inherit", "inherit"] },
);

if (result.exitCode !== 0) {
	console.error(
		"build-ai-helper: swiftc failed. Building needs the macOS 26 SDK (Xcode 26 or matching Command Line Tools).",
	);
	process.exit(result.exitCode ?? 1);
}

console.log("build-ai-helper: built native/ai-helper/.build/ai-helper");
