// The Electrobun CLI ships as a Bun-compiled binary whose ad-hoc signature is
// invalid (the JS payload is appended after linking). Recent macOS SIGKILLs it
// on launch, and the npm wrapper reports that as exit 0 — so `bun dev` just
// silently does nothing. Re-sign it ad hoc so it can run.

import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin") process.exit(0);

const root = join(import.meta.dir, "..", "node_modules", "electrobun");
const binaries = [join(root, "bin", "electrobun"), join(root, ".cache", "electrobun")];

const run = (cmd: string[]) =>
	Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).exitCode;

// The wrapper downloads the CLI lazily on first use; trigger that if needed.
if (!existsSync(binaries[0]) && existsSync(join(root, "bin", "electrobun.cjs"))) {
	run([process.execPath, join(root, "bin", "electrobun.cjs"), "--version"]);
}

for (const bin of binaries) {
	if (!existsSync(bin)) continue;
	if (run(["codesign", "-v", bin]) === 0) continue;
	if (run(["codesign", "--force", "--sign", "-", bin]) === 0) {
		console.log(`Re-signed ${bin.slice(root.length - "electrobun".length)}`);
	} else {
		console.warn(`Could not re-sign ${bin}; run: codesign --force --sign - "${bin}"`);
	}
}
