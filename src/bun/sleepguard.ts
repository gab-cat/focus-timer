// Session-scoped `pmset -a disablesleep 1`.
//
// pmset needs root. If the optional sudoers helper is installed we run it via
// `sudo -n` with no prompt; otherwise macOS shows its standard admin dialog.
//
// SleepDisabled persists across app restarts and reboots, so a marker file
// records that *we* turned it on. If the app dies mid-session, the next launch
// sees the marker and restores normal sleep.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SleepGuardState, SleepHelperInfo } from "../shared/types";
import { SUPPORT_DIR } from "./settings";

const PMSET = "/usr/bin/pmset";
const SUDOERS_FILE = "/etc/sudoers.d/focus-timer";
// sudo's #includedir skips names containing a dot, so the staging file is
// never live while it's being validated.
const SUDOERS_STAGING = "/etc/sudoers.d/.focus-timer.new";
const MARKER_PATH = `${SUPPORT_DIR}/sleep-guard.lock`;

const ENGAGE_PROMPT =
	"Focus Timer wants to block system sleep for this session (pmset disablesleep).";
const RELEASE_PROMPT = "Focus Timer wants to restore normal system sleep.";
const RECOVER_PROMPT =
	"Focus Timer quit while blocking system sleep. Restore normal sleep?";

type RunResult = { code: number; out: string };

async function run(cmd: string[]): Promise<RunResult> {
	try {
		const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
		const out = await new Response(proc.stdout).text();
		const code = await proc.exited;
		return { code, out };
	} catch {
		return { code: -1, out: "" };
	}
}

function runSync(cmd: string[]): number {
	try {
		return Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).exitCode ?? -1;
	} catch {
		return -1;
	}
}

// Runs `shell` as root through the standard macOS authorization dialog.
// argv keeps the command out of AppleScript string-escaping entirely.
function adminCmd(shell: string, prompt: string): string[] {
	return [
		"osascript",
		"-e",
		"on run argv",
		"-e",
		"do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges",
		"-e",
		"end run",
		shell,
		prompt,
	];
}

const pmsetArgs = (on: boolean) => [PMSET, "-a", "disablesleep", on ? "1" : "0"];

export async function isSleepDisabled(): Promise<boolean> {
	const { out } = await run([PMSET, "-g"]);
	return /SleepDisabled\s+1/.test(out);
}

export async function isHelperInstalled(): Promise<boolean> {
	// -l <cmd> exits 0 only if that exact command is allowed; -n fails instead
	// of prompting when a password would be required.
	const { code } = await run(["sudo", "-n", "-l", ...pmsetArgs(true)]);
	return code === 0;
}

async function setSleepDisabled(on: boolean, prompt: string): Promise<boolean> {
	if ((await run(["sudo", "-n", ...pmsetArgs(on)])).code === 0) return true;
	return (await run(adminCmd(pmsetArgs(on).join(" "), prompt))).code === 0;
}

function writeMarker() {
	try {
		mkdirSync(SUPPORT_DIR, { recursive: true });
		writeFileSync(MARKER_PATH, String(Date.now()));
	} catch {}
}

function clearMarker() {
	try {
		unlinkSync(MARKER_PATH);
	} catch {}
}

// ── Desired-state reconciler ────────────────────────────────────────────────
// Start/stop can race with a pending admin prompt, so callers only declare
// what they want and one loop converges on the latest request.

let desired = false;
let generation = 0;
let failedGeneration = -1;
let engagedByUs = false;
// Sleep was already disabled by someone else — leave it as we found it.
let external = false;
let loop: Promise<void> | null = null;
let recovery: Promise<void> = Promise.resolve();
let listener: (s: SleepGuardState) => void = () => {};

export function onSleepGuardChange(fn: (s: SleepGuardState) => void) {
	listener = fn;
}

export function sleepGuardState(): SleepGuardState {
	if (!desired) return "off";
	if (engagedByUs || external) return "on";
	if (failedGeneration === generation) return "failed";
	return "pending";
}

export function requestSleepGuard(on: boolean, retry = false): Promise<void> {
	if (on !== desired || retry) {
		desired = on;
		generation++;
	}
	listener(sleepGuardState());
	if (!loop) loop = reconcile().finally(() => (loop = null));
	return loop;
}

async function reconcile() {
	await recovery;
	for (;;) {
		const gen = generation;
		if (desired && !engagedByUs && !external && failedGeneration !== gen) {
			if (await isSleepDisabled()) {
				// Marker present means it's ours from an earlier, unreleased session.
				if (existsSync(MARKER_PATH)) engagedByUs = true;
				else external = true;
			} else if (await setSleepDisabled(true, ENGAGE_PROMPT)) {
				engagedByUs = true;
				writeMarker();
			} else {
				failedGeneration = gen;
			}
		} else if (!desired && (engagedByUs || external)) {
			if (engagedByUs && (await setSleepDisabled(false, RELEASE_PROMPT))) clearMarker();
			// If restoring failed (prompt cancelled) the marker stays, and the
			// next launch offers to restore again.
			engagedByUs = false;
			external = false;
		}
		listener(sleepGuardState());
		if (gen === generation) return;
	}
}

// Blocking release for quit paths, where async work won't get to finish.
export function releaseSleepGuardSync() {
	desired = false;
	if (!engagedByUs && !existsSync(MARKER_PATH)) return;
	engagedByUs = false;
	const ok =
		runSync(["sudo", "-n", ...pmsetArgs(false)]) === 0 ||
		runSync(adminCmd(pmsetArgs(false).join(" "), RELEASE_PROMPT)) === 0;
	if (ok) clearMarker();
}

// Call once on launch: undo a sleep block left behind by a crash.
export function recoverSleepGuard(): Promise<void> {
	recovery = (async () => {
		if (!existsSync(MARKER_PATH)) return;
		if (!(await isSleepDisabled())) {
			clearMarker();
			return;
		}
		if (await setSleepDisabled(false, RECOVER_PROMPT)) clearMarker();
	})();
	return recovery;
}

// ── Optional passwordless helper ────────────────────────────────────────────

export async function getHelperInfo(error: string | null = null): Promise<SleepHelperInfo> {
	return { installed: await isHelperInstalled(), error };
}

export async function installHelper(): Promise<SleepHelperInfo> {
	const user = (await run(["/usr/bin/id", "-un"])).out.trim();
	if (!/^[A-Za-z0-9._-]+$/.test(user)) {
		return getHelperInfo("Unsupported user name");
	}
	// Scoped to exactly these two invocations — nothing else gains root.
	const rule =
		"# Installed by Focus Timer. Lets it toggle system sleep without a password.\n" +
		`${user} ALL=(root) NOPASSWD: ${PMSET} -a disablesleep 0, ${PMSET} -a disablesleep 1\n`;

	const dir = await mkdtemp(join(tmpdir(), "focus-timer-"));
	const src = join(dir, "sudoers");
	try {
		if (src.includes("'")) return getHelperInfo("Unsupported temp path");
		await writeFile(src, rule, { mode: 0o600 });
		// Copy in as root first, then validate the root-owned copy, so nothing
		// can swap the file between check and install.
		const shell = [
			`/usr/bin/install -m 0440 -o root -g wheel '${src}' ${SUDOERS_STAGING}`,
			`if /usr/sbin/visudo -cf ${SUDOERS_STAGING} >/dev/null; then /bin/mv -f ${SUDOERS_STAGING} ${SUDOERS_FILE}; else /bin/rm -f ${SUDOERS_STAGING}; exit 1; fi`,
		].join(" && ");
		const { code } = await run(
			adminCmd(
				shell,
				"Focus Timer wants to install a helper so it can block system sleep without asking for your password each session.",
			),
		);
		if (code !== 0) return getHelperInfo("Install cancelled or failed");
		return getHelperInfo();
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

export async function removeHelper(): Promise<SleepHelperInfo> {
	const { code } = await run(
		adminCmd(
			`/bin/rm -f ${SUDOERS_FILE}`,
			"Focus Timer wants to remove its passwordless sleep helper.",
		),
	);
	return getHelperInfo(code === 0 ? null : "Remove cancelled or failed");
}
