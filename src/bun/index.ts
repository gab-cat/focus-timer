import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { Subprocess } from "bun";
import type { AppInfo, JigglerRPC, JigglerStatus, UpdatePhase } from "../shared/types";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const MIN_DELAY_MS = 90 * 1000;
const MAX_DELAY_MS = 180 * 1000;
const IDLE_THRESHOLD_MS = 2 * 60 * 1000;
const TAB_COUNT_CHOICES = [2, 4, 6] as const;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let caffeinate: Subprocess | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindow: BrowserWindow | null = null;

const status: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	actionCount: 0,
};

const appInfo: AppInfo = {
	version: "",
	channel: "",
	updateAvailable: false,
	updateReady: false,
	updatePhase: "idle",
	updateProgress: null,
	availableVersion: null,
	error: null,
};

function pushStatus() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { statusChanged: (s: JigglerStatus) => void } }
		| undefined;
	rpc?.send.statusChanged({ ...status });
}

function pushAppInfo() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { appInfoChanged: (i: AppInfo) => void } }
		| undefined;
	rpc?.send.appInfoChanged({ ...appInfo });
}

function setUpdatePhase(phase: UpdatePhase, extra?: Partial<AppInfo>) {
	appInfo.updatePhase = phase;
	if (extra) Object.assign(appInfo, extra);
	pushAppInfo();
}

function randomDelay() {
	return Math.floor(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

async function runShell(cmd: string[]) {
	const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
	await proc.exited;
}

async function runShellOutput(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

// Returns milliseconds since last HID input (keyboard/mouse) on macOS.
async function getIdleMs(): Promise<number> {
	try {
		const out = await runShellOutput(["sh", "-c", "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'"]);
		const ns = Number(out.trim());
		if (!Number.isFinite(ns)) return Number.POSITIVE_INFINITY;
		return ns / 1_000_000;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

async function moveMouseRandomly() {
	const dx = Math.floor(Math.random() * 20) - 10;
	const dy = Math.floor(Math.random() * 20) - 10;
	// ~1s total: 25 steps × ~0.04s per step, with small jitter.
	const steps = 25;
	const jxa = `
ObjC.import("CoreGraphics");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
var sx = loc.x, sy = loc.y;
var tx = sx + ${dx};
var ty = sy + ${dy};
var steps = ${steps};
for (var i = 1; i <= steps; i++) {
  var t = i / steps;
  var ease = t * t * (3 - 2 * t);
  var x = sx + (tx - sx) * ease;
  var y = sy + (ty - sy) * ease;
  var ev = $.CGEventCreateMouseEvent($(), 5, {x: x, y: y}, 0);
  $.CGEventPost(0, ev);
  delay(0.035 + Math.random() * 0.01);
}
`;
	await runShell(["osascript", "-l", "JavaScript", "-e", jxa]);
}

// Move the cursor with a few small human-ish eased steps, then press Cmd+Tab
// a random number of times (2, 4, or 6).
async function performJiggle() {
	await moveMouseRandomly();

	const tabCount = TAB_COUNT_CHOICES[Math.floor(Math.random() * TAB_COUNT_CHOICES.length)];
	for (let i = 0; i < tabCount; i++) {
		await runShell([
			"osascript",
			"-e",
			'tell application "System Events" to key code 48 using command down',
		]);
		if (i < tabCount - 1) {
			await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
		}
	}

	status.actionCount += 1;
	status.lastActionAt = Date.now();
}

function scheduleNext(overrideDelay?: number) {
	if (nextTimer) clearTimeout(nextTimer);
	const delay = overrideDelay ?? randomDelay();
	status.nextActionAt = Date.now() + delay;
	pushStatus();
	nextTimer = setTimeout(async () => {
		if (!status.enabled) return;
		try {
			const idle = await getIdleMs();
			if (idle < IDLE_THRESHOLD_MS) {
				// User is active — postpone until the idle threshold could be reached,
				// plus a small jitter so we don't fire the instant they pause.
				const wait = IDLE_THRESHOLD_MS - idle + 5_000 + Math.floor(Math.random() * 10_000);
				scheduleNext(wait);
				return;
			}
			await performJiggle();
		} catch (err) {
			console.error("Jiggle failed:", err);
		}
		if (status.enabled) scheduleNext();
	}, delay);
}

function startCaffeinate() {
	if (caffeinate) return;
	caffeinate = Bun.spawn(["caffeinate", "-dimsu"], {
		stdout: "ignore",
		stderr: "ignore",
	});
}

function stopCaffeinate() {
	caffeinate?.kill();
	caffeinate = null;
}

function setEnabled(enabled: boolean): JigglerStatus {
	if (enabled === status.enabled) return { ...status };
	status.enabled = enabled;
	if (enabled) {
		startCaffeinate();
		scheduleNext();
	} else {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = null;
		status.nextActionAt = null;
		stopCaffeinate();
		pushStatus();
	}
	return { ...status };
}

async function triggerNow(): Promise<JigglerStatus> {
	try {
		await performJiggle();
	} catch (err) {
		console.error("Manual jiggle failed:", err);
	}
	if (status.enabled) scheduleNext();
	else pushStatus();
	return { ...status };
}

let updateCheckInFlight: Promise<void> | null = null;

async function runUpdateCycle(): Promise<void> {
	if (updateCheckInFlight) return updateCheckInFlight;
	if (appInfo.channel === "dev") return;
	updateCheckInFlight = (async () => {
		setUpdatePhase("checking", { error: null });
		try {
			const check = await Updater.checkForUpdate();
			if (check.error) {
				setUpdatePhase("error", { error: check.error });
				return;
			}
			appInfo.availableVersion = check.version || null;
			if (!check.updateAvailable) {
				setUpdatePhase("idle", { updateAvailable: false });
				return;
			}
			setUpdatePhase("downloading", {
				updateAvailable: true,
				updateProgress: 0,
			});
			await Updater.downloadUpdate();
			const after = Updater.updateInfo();
			if (after?.updateReady) {
				setUpdatePhase("ready", {
					updateReady: true,
					updateProgress: 100,
				});
			} else {
				setUpdatePhase("error", {
					error: after?.error || "Download did not produce a ready update",
				});
			}
		} catch (err) {
			setUpdatePhase("error", { error: (err as Error).message });
		}
	})();
	try {
		await updateCheckInFlight;
	} finally {
		updateCheckInFlight = null;
	}
}

Updater.onStatusChange((entry) => {
	if (entry.status === "download-progress" && entry.details?.progress != null) {
		appInfo.updateProgress = entry.details.progress;
		pushAppInfo();
	}
});

const rpc = BrowserView.defineRPC<JigglerRPC>({
	handlers: {
		requests: {
			setEnabled: ({ enabled }) => setEnabled(enabled),
			getStatus: () => ({ ...status }),
			triggerNow: () => triggerNow(),
			getAppInfo: () => ({ ...appInfo }),
			checkForUpdate: async () => {
				await runUpdateCycle();
				return { ...appInfo };
			},
			applyUpdate: async () => {
				if (appInfo.updateReady) await Updater.applyUpdate();
			},
		},
		messages: {},
	},
});

async function loadAppInfo() {
	try {
		appInfo.version = await Updater.localInfo.version();
		appInfo.channel = await Updater.localInfo.channel();
	} catch (err) {
		console.error("Failed to read local app info:", err);
	}
}

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

mainWindow = new BrowserWindow({
	title: "Focus Timer",
	url,
	rpc,
	frame: {
		width: 380,
		height: 460,
		x: 200,
		y: 200,
	},
	styleMask: {
		Titled: true,
		Closable: true,
		Resizable: false,
		Miniaturizable: true,
		Borderless: false,
		FullSizeContentView: false,
		FullScreen: false,
		UnifiedTitleAndToolbar: false,
		UtilityWindow: false,
	},
});

process.on("exit", () => stopCaffeinate());

console.log("Focus Timer started");

await loadAppInfo();
pushAppInfo();

if (appInfo.channel !== "dev") {
	// Kick off an initial check shortly after launch so we don't slow startup.
	setTimeout(() => {
		void runUpdateCycle();
	}, 5_000);
	setInterval(() => {
		if (!appInfo.updateReady) void runUpdateCycle();
	}, UPDATE_CHECK_INTERVAL_MS);
}
