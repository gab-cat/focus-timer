#!/usr/bin/env bun
// Ad-hoc codesign the macOS wrapper bundle so Gatekeeper opens it with the
// milder "unidentified developer" prompt instead of refusing as "damaged".
// Real Developer ID signing is a separate path (mac.codesign + secrets).

const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
const targetOS = process.env.ELECTROBUN_OS;

if (targetOS !== "macos") {
	console.log(`post-wrap-sign: target OS is ${targetOS}, skipping`);
	process.exit(0);
}

if (process.platform !== "darwin") {
	console.log("post-wrap-sign: not running on macOS host, skipping");
	process.exit(0);
}

if (!wrapperPath) {
	console.error("post-wrap-sign: ELECTROBUN_WRAPPER_BUNDLE_PATH is not set");
	process.exit(1);
}

console.log(`post-wrap-sign: ad-hoc signing ${wrapperPath}`);
const result = Bun.spawnSync(
	["codesign", "--force", "--deep", "--sign", "-", wrapperPath],
	{ stdio: ["ignore", "inherit", "inherit"] },
);

if (result.exitCode !== 0) {
	console.error(`post-wrap-sign: codesign failed with exit code ${result.exitCode}`);
	process.exit(result.exitCode ?? 1);
}

const verify = Bun.spawnSync(
	["codesign", "--verify", "--verbose=2", wrapperPath],
	{ stdio: ["ignore", "inherit", "inherit"] },
);

if (verify.exitCode !== 0) {
	console.error("post-wrap-sign: codesign verification failed");
	process.exit(verify.exitCode ?? 1);
}

console.log("post-wrap-sign: ad-hoc signature applied and verified");
