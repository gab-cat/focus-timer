import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type {
	AppInfo,
	JigglerRPC,
	JigglerStatus,
	PauseReason,
	Settings,
	Stats,
	UpdatePhase,
} from "../shared/types";
import { runAction } from "./actions";
import {
	loadSettings,
	loadStats,
	rollStatsDay,
	saveSettings,
	saveStats,
	todayISO,
} from "./settings";
import {
	getIdleMs,
	isOnBattery,
	isOnCall,
	isScreenLocked,
} from "./system";
import { setupTray, tickTray, updateTray } from "./tray";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const WINDOW_POLL_MS = 2_000;

let caffeinate: Subprocess | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindow: BrowserWindow | null = null;

const status: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	actionCount: 0,
	sessionStartedAt: null,
	autoStopAt: null,
	pauseReason: null,
};

let settings: Settings = (await loadSettings());
let stats: Stats = rollStatsDay(await loadStats());

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
	updateTray(status, settings);
}

function pushAppInfo() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { appInfoChanged: (i: AppInfo) => void } }
		| undefined;
	rpc?.send.appInfoChanged({ ...appInfo });
}

function pushSettings() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { settingsChanged: (s: Settings) => void } }
		| undefined;
	rpc?.send.settingsChanged({ ...settings });
	updateTray(status, settings);
}

function pushStats() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { statsChanged: (s: Stats) => void } }
		| undefined;
	rpc?.send.statsChanged({ ...stats });
}

function setUpdatePhase(phase: UpdatePhase, extra?: Partial<AppInfo>) {
	appInfo.updatePhase = phase;
	if (extra) Object.assign(appInfo, extra);
	pushAppInfo();
}

function randomDelay() {
	const { minDelayMs, maxDelayMs } = settings;
	const lo = Math.max(1000, minDelayMs);
	const hi = Math.max(lo, maxDelayMs);
	return Math.floor(lo + Math.random() * (hi - lo));
}

async function checkPauseReason(): Promise<PauseReason> {
	if (settings.pauseOnLock && (await isScreenLocked())) return "lock";
	if (settings.pauseOnBattery && (await isOnBattery())) return "battery";
	if (settings.pauseOnCall && (await isOnCall())) return "call";
	return null;
}

async function performJiggle() {
	await runAction(settings.actionType);
	status.actionCount += 1;
	status.lastActionAt = Date.now();
	stats = rollStatsDay(stats);
	stats.totalActions += 1;
	stats.today.count += 1;
	void saveStats(stats);
	pushStats();
}

function scheduleNext(overrideDelay?: number) {
	if (nextTimer) clearTimeout(nextTimer);
	const delay = overrideDelay ?? randomDelay();
	status.nextActionAt = Date.now() + delay;
	pushStatus();
	nextTimer = setTimeout(async () => {
		if (!status.enabled) return;
		try {
			const reason = await checkPauseReason();
			if (reason) {
				if (status.pauseReason !== reason) {
					status.pauseReason = reason;
					pushStatus();
				}
				scheduleNext(60_000);
				return;
			}
			if (status.pauseReason) {
				status.pauseReason = null;
				pushStatus();
			}
			const idle = await getIdleMs();
			if (idle < settings.idleThresholdMs) {
				const wait =
					settings.idleThresholdMs - idle + 5_000 + Math.floor(Math.random() * 10_000);
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

function clearAutoStop() {
	if (autoStopTimer) clearTimeout(autoStopTimer);
	autoStopTimer = null;
	status.autoStopAt = null;
}

function scheduleAutoStop() {
	clearAutoStop();
	if (!settings.autoStopMs || settings.autoStopMs <= 0) return;
	status.autoStopAt = Date.now() + settings.autoStopMs;
	autoStopTimer = setTimeout(() => {
		autoStopTimer = null;
		if (status.enabled) setEnabled(false);
	}, settings.autoStopMs);
}

function setEnabled(enabled: boolean): JigglerStatus {
	if (enabled === status.enabled) return { ...status };
	status.enabled = enabled;
	if (enabled) {
		status.sessionStartedAt = Date.now();
		status.actionCount = 0;
		status.pauseReason = null;
		scheduleAutoStop();
		startCaffeinate();
		scheduleNext();
	} else {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = null;
		status.nextActionAt = null;
		status.sessionStartedAt = null;
		status.pauseReason = null;
		clearAutoStop();
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

function applySettingsSideEffects(prev: Settings) {
	if (prev.autoStopMs !== settings.autoStopMs) {
		if (status.enabled) scheduleAutoStop();
	}
	if (
		status.enabled &&
		(prev.minDelayMs !== settings.minDelayMs ||
			prev.maxDelayMs !== settings.maxDelayMs)
	) {
		// Reschedule so the new window takes effect immediately.
		scheduleNext();
	}
}

function updateSettings(patch: Partial<Settings>): Settings {
	const prev = { ...settings };
	settings = { ...settings, ...patch };
	void saveSettings(settings);
	applySettingsSideEffects(prev);
	pushSettings();
	return { ...settings };
}

function resetStats(): Stats {
	stats = { totalActions: 0, today: { date: todayISO(), count: 0 }, history: {} };
	void saveStats(stats);
	pushStats();
	return { ...stats };
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
			getSettings: () => ({ ...settings }),
			updateSettings: (patch) => updateSettings(patch),
			getStats: () => ({ ...stats }),
			resetStats: () => resetStats(),
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

function resolveStartPosition(): { x: number; y: number } {
	const fallback = { x: 200, y: 200 };
	if (settings.windowX == null || settings.windowY == null) return fallback;
	// Clamp to a reasonable region — better to land on-screen than match exactly.
	const x = Math.max(0, Math.min(settings.windowX, 4000));
	const y = Math.max(0, Math.min(settings.windowY, 3000));
	return { x, y };
}

await loadAppInfo();

const url = await getMainViewUrl();
const startPos = resolveStartPosition();

mainWindow = new BrowserWindow({
	title: "Focus Timer",
	url,
	rpc,
	frame: {
		width: 380,
		height: 520,
		x: startPos.x,
		y: startPos.y,
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

// Poll window position every 2s; persist on change (debounced via the poll cadence itself).
let lastSavedX = settings.windowX;
let lastSavedY = settings.windowY;
setInterval(() => {
	if (!mainWindow) return;
	try {
		const frame = mainWindow.getFrame();
		if (frame.x !== lastSavedX || frame.y !== lastSavedY) {
			lastSavedX = frame.x;
			lastSavedY = frame.y;
			settings = { ...settings, windowX: frame.x, windowY: frame.y };
			void saveSettings(settings);
		}
	} catch {}
}, WINDOW_POLL_MS);

// Tray icon — `views://` resolves to the bundled app's Resources/app/views
// dir in production. In dev (electrobun dev), fall back to the source PNG so
// the icon still appears in the menu bar while iterating.
const devTrayIcon = join(
	import.meta.dir,
	"..",
	"mainview",
	"public",
	"tray-icon.png",
);
const trayIconPath =
	appInfo.channel === "dev" ? devTrayIcon : "views://mainview/tray-icon.png";
setupTray(trayIconPath, {
	toggleEnabled: () => setEnabled(!status.enabled),
	triggerNow: () => {
		void triggerNow();
	},
	setActionType: (type) => {
		updateSettings({ actionType: type });
	},
	showWindow: () => {
		try {
			mainWindow?.show();
		} catch (err) {
			console.error("Show window failed:", err);
		}
	},
	quit: () => {
		process.exit(0);
	},
});
updateTray(status, settings);

// Refresh the tray's countdown label every second while active.
setInterval(() => {
	tickTray();
}, 1000);

process.on("exit", () => stopCaffeinate());

console.log("Focus Timer started");

pushAppInfo();
pushSettings();
pushStats();

if (appInfo.channel !== "dev") {
	setTimeout(() => {
		void runUpdateCycle();
	}, 5_000);
	setInterval(() => {
		if (!appInfo.updateReady) void runUpdateCycle();
	}, UPDATE_CHECK_INTERVAL_MS);
}
