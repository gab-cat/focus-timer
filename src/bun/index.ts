import Electrobun, { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type {
	AppInfo,
	JigglerRPC,
	JigglerStatus,
	PauseReason,
	RhythmInfo,
	Settings,
	Stats,
	UpdatePhase,
} from "../shared/types";
import { resetPersona, runAction } from "./actions";
import {
	currentMeeting,
	getCalendarInfo,
	openCalendarPrivacy,
	requestCalendarAccess,
} from "./calendar";
import { breakGapMs, breakLengthMs, naturalDelay } from "./humanize";
import {
	initRhythm,
	markSyntheticEnd,
	markSyntheticStart,
	onActiveMinute,
	onRhythmChange,
	resetRhythm,
	rhythmInfo,
	setRhythmLearning,
	stopRhythm,
} from "./rhythm";
import {
	bumpHour,
	emptyStatsValue,
	loadSettings,
	loadStats,
	rollStatsDay,
	saveSettings,
	saveStats,
} from "./settings";
import {
	getIdleMs,
	isOnBattery,
	isOnCall,
	isScreenLocked,
} from "./system";
import {
	getHelperInfo,
	installHelper,
	onSleepGuardChange,
	recoverSleepGuard,
	releaseSleepGuardSync,
	removeHelper,
	requestSleepGuard,
} from "./sleepguard";
import { setupTray, tickTray, updateTray } from "./tray";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const WINDOW_POLL_MS = 2_000;

let caffeinate: Subprocess | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindow: BrowserWindow | null = null;
// End of our most recent synthetic action; 0 when unknown or the user
// interrupted it. Lets the idle check tell our own input from the user's.
let lastSyntheticAt = 0;
let nextBreakAt: number | null = null;
let breakUntil: number | null = null;

const status: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	waitStartedAt: null,
	actionCount: 0,
	sessionStartedAt: null,
	autoStopAt: null,
	pauseReason: null,
	pauseDetail: null,
	lastRoutine: null,
	lastApp: null,
	sleepGuard: "off",
	recent: [],
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

function pushRhythm(info: RhythmInfo) {
	const rpc = mainWindow?.webview.rpc as
		| { send: { rhythmChanged: (i: RhythmInfo) => void } }
		| undefined;
	rpc?.send.rhythmChanged(info);
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
	if (settings.actionType === "natural") return naturalDelay(lo, hi);
	return Math.floor(lo + Math.random() * (hi - lo));
}

// True once the user has been away long enough for us to act. Our own
// synthetic input resets the HID idle clock too, so when nothing has happened
// since our last action we treat the user as still away.
async function userIsAway(): Promise<{ away: boolean; idle: number }> {
	const idle = await getIdleMs();
	if (idle >= settings.idleThresholdMs) return { away: true, idle };
	const lastInputWasOurs =
		lastSyntheticAt > 0 && idle + 1_500 >= Date.now() - lastSyntheticAt;
	return { away: lastInputWasOurs, idle };
}

// Handles natural breaks. Returns a delay to wait if we're on a break.
function breakDelay(): number | null {
	const now = Date.now();
	if (breakUntil) {
		if (now < breakUntil) return breakUntil - now;
		breakUntil = null;
		nextBreakAt = now + breakGapMs();
		if (status.pauseReason === "break") setPause(null);
		pushStatus();
		return null;
	}
	if (settings.naturalBreaks && nextBreakAt && now >= nextBreakAt) {
		breakUntil = now + breakLengthMs();
		setPause("break");
		return breakUntil - now;
	}
	return null;
}

function setPause(reason: PauseReason, detail: string | null = null) {
	status.pauseReason = reason;
	status.pauseDetail = reason ? detail : null;
}

function endBreak() {
	breakUntil = null;
	if (status.pauseReason === "break") setPause(null);
}

type Pause = { reason: PauseReason; detail: string | null; recheckMs: number };

async function checkPause(): Promise<Pause | null> {
	if (settings.pauseOnLock && (await isScreenLocked()))
		return { reason: "lock", detail: null, recheckMs: 60_000 };
	if (settings.pauseOnBattery && (await isOnBattery()))
		return { reason: "battery", detail: null, recheckMs: 60_000 };
	if (settings.pauseOnCall && (await isOnCall()))
		return { reason: "call", detail: null, recheckMs: 60_000 };
	if (settings.pauseOnMeeting) {
		const meeting = await currentMeeting();
		if (meeting) {
			// Wake shortly after it ends, but re-check at least every minute.
			const untilEnd = meeting.end - Date.now() + 5_000 + Math.random() * 20_000;
			return {
				reason: "meeting",
				detail: JSON.stringify({ title: meeting.title, end: meeting.end }),
				recheckMs: Math.max(5_000, Math.min(60_000, untilEnd)),
			};
		}
	}
	return null;
}

async function performJiggle() {
	markSyntheticStart();
	let result;
	try {
		result = await runAction({
			type: settings.actionType,
			appAware: settings.appAware,
			scrollStyle: settings.scrollStyle,
		});
	} finally {
		markSyntheticEnd();
	}
	lastSyntheticAt = result.interrupted ? 0 : Date.now();
	status.lastRoutine = result.routine;
	status.lastApp = result.app;
	status.actionCount += 1;
	status.lastActionAt = Date.now();
	status.recent = [...status.recent, { at: status.lastActionAt, routine: result.routine }].slice(-60);
	stats = rollStatsDay(stats);
	stats.totalActions += 1;
	stats.today.count += 1;
	bumpHour(stats.hourly);
	stats.routines[result.routine] = (stats.routines[result.routine] ?? 0) + 1;
	void saveStats(stats);
	pushStats();
}

function scheduleNext(overrideDelay?: number) {
	if (nextTimer) clearTimeout(nextTimer);
	const delay = overrideDelay ?? randomDelay();
	status.waitStartedAt = Date.now();
	status.nextActionAt = status.waitStartedAt + delay;
	pushStatus();
	nextTimer = setTimeout(async () => {
		if (!status.enabled) return;
		try {
			const onBreak = breakDelay();
			if (onBreak != null) {
				scheduleNext(onBreak);
				return;
			}
			const pause = await checkPause();
			if (pause) {
				if (status.pauseReason !== pause.reason || status.pauseDetail !== pause.detail) {
					setPause(pause.reason, pause.detail);
				}
				scheduleNext(pause.recheckMs);
				return;
			}
			if (status.pauseReason) {
				setPause(null);
				pushStatus();
			}
			const { away, idle } = await userIsAway();
			if (!away) {
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
	// -w ties caffeinate's lifetime to ours, so a crash can't orphan it.
	caffeinate = Bun.spawn(["caffeinate", "-dimsu", "-w", String(process.pid)], {
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
		setPause(null);
		status.lastRoutine = null;
		status.lastApp = null;
		status.recent = [];
		lastSyntheticAt = 0;
		endBreak();
		nextBreakAt = Date.now() + breakGapMs();
		resetPersona();
		scheduleAutoStop();
		startCaffeinate();
		void requestSleepGuard(settings.preventSystemSleep);
		scheduleNext();
	} else {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = null;
		status.nextActionAt = null;
		status.waitStartedAt = null;
		status.sessionStartedAt = null;
		setPause(null);
		endBreak();
		nextBreakAt = null;
		clearAutoStop();
		stopCaffeinate();
		void requestSleepGuard(false);
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
	if (status.enabled && prev.preventSystemSleep !== settings.preventSystemSleep) {
		void requestSleepGuard(settings.preventSystemSleep);
	}
	if (prev.learnRhythm !== settings.learnRhythm) {
		setRhythmLearning(settings.learnRhythm);
	}
	if (status.enabled && prev.pauseOnMeeting !== settings.pauseOnMeeting) {
		// Re-evaluate right away rather than waiting out the current timer.
		if (status.pauseReason === "meeting" && !settings.pauseOnMeeting) setPause(null);
		scheduleNext(1_000);
	}
	if (status.enabled && prev.naturalBreaks !== settings.naturalBreaks) {
		nextBreakAt = Date.now() + breakGapMs();
		if (!settings.naturalBreaks && breakUntil) {
			endBreak();
			scheduleNext();
		}
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
	stats = emptyStatsValue();
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
			retrySleepGuard: async () => {
				if (status.enabled && settings.preventSystemSleep) {
					void requestSleepGuard(true, true);
				}
				return { ...status };
			},
			getSleepHelper: () => getHelperInfo(),
			installSleepHelper: () => installHelper(),
			removeSleepHelper: () => removeHelper(),
			getCalendarInfo: () => getCalendarInfo(),
			requestCalendarAccess: () => requestCalendarAccess(),
			openCalendarPrivacy: () => openCalendarPrivacy(),
			getRhythm: () => rhythmInfo(),
			resetRhythm: () => resetRhythm(),
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

onSleepGuardChange((state) => {
	if (status.sleepGuard === state) return;
	status.sleepGuard = state;
	pushStatus();
});
// Undo a sleep block left behind if the app crashed mid-session.
void recoverSleepGuard();

onRhythmChange(pushRhythm);
onActiveMinute(() => {
	stats = rollStatsDay(stats);
	bumpHour(stats.userHourly);
	void saveStats(stats);
	pushStats();
});
await initRhythm(settings.learnRhythm);

const url = await getMainViewUrl();
const startPos = resolveStartPosition();

mainWindow = new BrowserWindow({
	title: "Focus Timer",
	url,
	rpc,
	// Content runs under a transparent title bar; the view draws its own
	// header and marks it as a drag region.
	titleBarStyle: "hiddenInset",
	// Centers the traffic lights on the 52px header's midline.
	trafficLightOffset: { x: 8, y: 12 },
	frame: {
		width: 440,
		height: 720,
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

let shuttingDown = false;
function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	stopCaffeinate();
	stopRhythm();
	releaseSleepGuardSync();
}

// Electrobun's native quit path force-exits without firing process "exit",
// so restore sleep here first.
Electrobun.events.on("before-quit", shutdown);
process.on("exit", shutdown);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => {
		shutdown();
		process.exit(0);
	});
}

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
