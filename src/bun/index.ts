import Electrobun, { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
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
import { atLabel, clockLabel, duration, plannedStopAt } from "../shared/time";
import { runAction } from "./actions";
import { CallTracker } from "./calltracker";
import { sampleMic } from "./mic";
import {
	clearNotification,
	hasNotificationButtons,
	initNotifications,
	notify,
	NotifyAction,
	NotifyKind,
	refreshNotificationPermission,
	requestNotificationPermission,
	setNotificationTheme,
} from "./notify";
import {
	bumpHour,
	emptyStatsValue,
	loadSettings,
	loadStats,
	rollStatsDay,
	sanitizeSettings,
	saveSettings,
	saveStats,
} from "./settings";
import {
	getIdleMs,
	isOnBattery,
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
import { setupTray, updateTray } from "./tray";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const WINDOW_SAVE_DEBOUNCE_MS = 500;
// Same footprint as the Voice Notes app, so the two sit side by side.
const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 600;
// How often to look at the microphone while a call could matter.
const CALL_POLL_MS = 5_000;

let caffeinate: Subprocess | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindow: BrowserWindow | null = null;

const status: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	waitStartedAt: null,
	actionCount: 0,
	sessionStartedAt: null,
	autoStopAt: null,
	pauseReason: null,
	lastRoutine: null,
	sleepGuard: "off",
	recent: [],
	onCall: false,
	callApp: null,
	callPrompt: false,
	callHold: false,
	notifications: "unavailable",
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
	// Any mic use counts here, not just a confirmed call: a move during the
	// first seconds of a call is exactly what we want to avoid.
	if (settings.callMode !== "off" && (calls.onCall || sampleMic().inUse)) return "call";
	return null;
}

async function performJiggle() {
	const routine = settings.actionType;
	await runAction(routine);
	status.lastRoutine = routine;
	status.actionCount += 1;
	status.lastActionAt = Date.now();
	status.recent = [...status.recent, { at: status.lastActionAt, routine }].slice(-60);
	stats = rollStatsDay(stats);
	stats.totalActions += 1;
	stats.today.count += 1;
	bumpHour(stats.hourly);
	stats.routines[routine] = (stats.routines[routine] ?? 0) + 1;
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

// ── Auto-stop ───────────────────────────────────────────────────────────────

function clearAutoStop() {
	if (autoStopTimer) clearTimeout(autoStopTimer);
	autoStopTimer = null;
	status.autoStopAt = null;
}

// Waits for status.autoStopAt in steps of at most a minute. setTimeout doesn't
// count time the Mac spends asleep, so a single long timer would fire late
// for "stop at 6 PM"; re-checking the wall clock keeps it on time.
function armAutoStop() {
	if (autoStopTimer) clearTimeout(autoStopTimer);
	autoStopTimer = null;
	const at = status.autoStopAt;
	if (!status.enabled || at == null) return;
	const left = at - Date.now();
	if (left <= 0) {
		autoStop(at);
		return;
	}
	autoStopTimer = setTimeout(armAutoStop, Math.min(left, 60_000));
}

function autoStop(at: number) {
	const ran = status.sessionStartedAt ? Date.now() - status.sessionStartedAt : 0;
	setEnabled(false);
	notify({
		id: "auto-stop",
		kind: NotifyKind.AutoStopped,
		title: "Session ended",
		body: `Reached your ${clockLabel(at)} stop time after ${duration(ran)}.`,
		sound: true,
	});
}

// ── Calls ───────────────────────────────────────────────────────────────────
// A call is an app using the microphone (see mic.ts). Depending on
// settings.callMode we pause moves, and in "ask" mode offer to end the session
// until the call is over ("call hold"), then start it again.

const calls = new CallTracker();
let callTimer: ReturnType<typeof setInterval> | null = null;
// The stop time to carry into the session that restarts after a call.
let holdStopAt: number | null = null;
// Start time of a session we restarted after a call, so "Stop session" on that
// notification can't end a later session.
let resumedSessionAt: number | null = null;

function syncCallWatch() {
	const want = (status.enabled && settings.callMode !== "off") || status.callHold;
	if (want && !callTimer) {
		callTimer = setInterval(pollCall, CALL_POLL_MS);
	} else if (!want && callTimer) {
		clearInterval(callTimer);
		callTimer = null;
		calls.reset();
		status.onCall = false;
		status.callApp = null;
	}
}

function pollCall() {
	const now = Date.now();
	if (status.callHold && holdStopAt != null && now >= holdStopAt) {
		expireHold(holdStopAt);
		return;
	}
	const event = calls.update(now, sampleMic());
	const changed = status.onCall !== calls.onCall || status.callApp !== calls.app;
	status.onCall = calls.onCall;
	status.callApp = calls.app;
	if (event === "start") onCallStarted();
	else if (event === "end") onCallEnded();
	else if (changed) pushStatus();
}

// Starting a session mid-call: treat the call as known so we don't ask about it.
function adoptOngoingCall() {
	if (settings.callMode === "off") return;
	const mic = sampleMic();
	if (!mic.inUse) return;
	calls.adopt(mic.app);
	status.onCall = true;
	status.callApp = mic.app;
	status.pauseReason ??= "call";
}

function onCallStarted() {
	if (!status.enabled || settings.callMode === "off") {
		pushStatus();
		return;
	}
	status.pauseReason ??= "call";
	if (settings.callMode === "ask") {
		status.callPrompt = true;
		notify({
			id: "call",
			category: "call",
			kind: NotifyKind.CallStarted,
			title: status.callApp ? `On a call in ${status.callApp}` : "On a call",
			body: hasNotificationButtons()
				? "Moves are paused. End the session and it starts again when the call ends."
				: "Moves are paused. Open Focus Timer to end the session until the call ends.",
		});
	}
	pushStatus();
}

function onCallEnded() {
	clearNotification("call");
	status.callPrompt = false;
	if (status.callHold) {
		resumeAfterCall();
		return;
	}
	if (status.enabled && status.pauseReason === "call") {
		status.pauseReason = null;
		// A fresh wait, so the first move isn't the instant the call ends.
		scheduleNext();
		return;
	}
	pushStatus();
}

function endForCall(): JigglerStatus {
	if (!status.enabled) return { ...status };
	holdStopAt = status.autoStopAt;
	status.callHold = true;
	// Keep the sleep block through the call: releasing and re-engaging it
	// can mean two password prompts in the middle of the call.
	setEnabled(false, { keepSleepGuard: true });
	return { ...status };
}

function dismissCallPrompt(): JigglerStatus {
	status.callPrompt = false;
	clearNotification("call");
	pushStatus();
	return { ...status };
}

function cancelCallHold(): JigglerStatus {
	if (!status.callHold) return { ...status };
	status.callHold = false;
	holdStopAt = null;
	void requestSleepGuard(false);
	syncCallWatch();
	pushStatus();
	return { ...status };
}

function resumeAfterCall() {
	const stopAt = holdStopAt;
	status.callHold = false;
	holdStopAt = null;
	setEnabled(true, { autoStopAt: stopAt });
	resumedSessionAt = status.sessionStartedAt;
	notify({
		id: "resumed",
		category: "resumed",
		kind: NotifyKind.CallEnded,
		title: "Session back on",
		body: stopAt
			? `Your call ended. It stops ${atLabel(stopAt)}.`
			: "Your call ended. It runs until you stop it.",
	});
}

// The stop time passed while the session was off for a call.
function expireHold(at: number) {
	status.callHold = false;
	holdStopAt = null;
	clearNotification("call");
	void requestSleepGuard(false);
	syncCallWatch();
	pushStatus();
	notify({
		id: "auto-stop",
		kind: NotifyKind.AutoStopped,
		title: "Session ended",
		body: `Reached your ${clockLabel(at)} stop time during the call. It won't start again.`,
	});
}

function onNotificationResponse(kind: NotifyKind, action: NotifyAction) {
	if (action === NotifyAction.Open) {
		showWindow();
		return;
	}
	if (kind === NotifyKind.CallStarted) {
		// Ignore a stale button press once the call or session is over.
		if (!status.enabled || !calls.onCall) return;
		if (action === NotifyAction.EndSession) endForCall();
		else if (action === NotifyAction.KeepRunning) dismissCallPrompt();
	} else if (kind === NotifyKind.CallEnded && action === NotifyAction.StopSession) {
		if (status.enabled && status.sessionStartedAt === resumedSessionAt) setEnabled(false);
	}
}

// Ask for notification permission at the first session that would use it,
// rather than at launch with no context.
function askForNotificationsIfNeeded() {
	if (status.notifications !== "unknown") return;
	if (settings.callMode === "ask" || status.autoStopAt != null) requestNotificationPermission();
}

// ── Session ─────────────────────────────────────────────────────────────────

type SessionOpts = {
	// Use this stop time instead of the one from settings (restart after a call).
	autoStopAt?: number | null;
	// Ending for a call: leave the sleep block on until the call is over.
	keepSleepGuard?: boolean;
};

function setEnabled(enabled: boolean, opts: SessionOpts = {}): JigglerStatus {
	if (enabled === status.enabled) return { ...status };
	status.enabled = enabled;
	status.callPrompt = false;
	clearNotification("call");
	if (enabled) {
		// Starting by hand replaces a pending restart.
		status.callHold = false;
		holdStopAt = null;
		status.sessionStartedAt = Date.now();
		status.actionCount = 0;
		status.pauseReason = null;
		status.lastRoutine = null;
		status.recent = [];
		status.autoStopAt =
			opts.autoStopAt !== undefined
				? opts.autoStopAt
				: plannedStopAt(settings, status.sessionStartedAt);
		armAutoStop();
		startCaffeinate();
		void requestSleepGuard(settings.preventSystemSleep);
		adoptOngoingCall();
		askForNotificationsIfNeeded();
		syncCallWatch();
		scheduleNext();
	} else {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = null;
		status.nextActionAt = null;
		status.waitStartedAt = null;
		status.sessionStartedAt = null;
		status.pauseReason = null;
		clearAutoStop();
		stopCaffeinate();
		if (!opts.keepSleepGuard) void requestSleepGuard(false);
		syncCallWatch();
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
	if (prev.autoStopMs !== settings.autoStopMs || prev.autoStopTime !== settings.autoStopTime) {
		// Mid-session changes count from now: "1 hour" means an hour from here.
		if (status.enabled) {
			status.autoStopAt = plannedStopAt(settings, Date.now());
			armAutoStop();
			askForNotificationsIfNeeded();
			pushStatus();
		} else if (status.callHold) {
			holdStopAt = plannedStopAt(settings, Date.now());
		}
	}
	if (prev.callMode !== settings.callMode) {
		if (settings.callMode !== "ask" && status.callPrompt) dismissCallPrompt();
		if (status.enabled) {
			if (settings.callMode === "off" && status.pauseReason === "call") {
				status.pauseReason = null;
				scheduleNext();
			} else if (settings.callMode !== "off") {
				adoptOngoingCall();
				pushStatus();
			}
		}
		syncCallWatch();
	}
	if (
		status.enabled &&
		(prev.minDelayMs !== settings.minDelayMs ||
			prev.maxDelayMs !== settings.maxDelayMs)
	) {
		// Reschedule so the new window takes effect immediately.
		scheduleNext();
	}
	if (prev.theme !== settings.theme) setNotificationTheme(settings.theme);
	if (status.enabled && prev.preventSystemSleep !== settings.preventSystemSleep) {
		void requestSleepGuard(settings.preventSystemSleep);
	}
}

function updateSettings(patch: Partial<Settings>): Settings {
	const prev = { ...settings };
	settings = sanitizeSettings({ ...settings, ...patch });
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

let installError: string | null = null;

Updater.onStatusChange((entry) => {
	if (entry.status === "download-progress" && entry.details?.progress != null) {
		appInfo.updateProgress = entry.details.progress;
		pushAppInfo();
		return;
	}
	if (appInfo.updatePhase !== "installing") return;
	if (entry.status === "launching-new-version" || entry.status === "complete") {
		setUpdatePhase("restarting");
	} else if (entry.status === "error") {
		installError = entry.details?.errorMessage ?? entry.message;
	}
});

// Electrobun's applyUpdate quits the app when it succeeds and returns quietly
// when it can't, so anything after it is the failure path.
async function installUpdate(): Promise<void> {
	if (!appInfo.updateReady) return;
	if (appInfo.updatePhase === "installing" || appInfo.updatePhase === "restarting") return;
	installError = null;
	setUpdatePhase("installing", { error: null });
	try {
		// A failed attempt clears Electrobun's ready flag. With the download
		// still on disk, this just marks it ready again.
		if (!Updater.updateInfo()?.updateReady) await Updater.downloadUpdate();
		await Updater.applyUpdate();
	} catch (err) {
		installError = (err as Error).message;
	}
	setUpdatePhase("ready", {
		error: installError ?? "The update didn't install.",
	});
}

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
			applyUpdate: () => installUpdate(),
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
			endForCall: () => endForCall(),
			dismissCallPrompt: () => dismissCallPrompt(),
			cancelCallHold: () => cancelCallHold(),
			requestNotifications: () => {
				requestNotificationPermission();
				return { ...status };
			},
			openNotificationSettings: async () => {
				const { identifier } = await Updater.getLocalInfo();
				Bun.spawn([
					"open",
					`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${identifier}`,
				]);
			},
			sendTestNotification: () => {
				notify({
					id: "test",
					category: "call",
					kind: NotifyKind.Test,
					title: "On a call in Zoom",
					body: "This is a test. During a real call, End session ends it until the call is over.",
				});
				return { ...status };
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
		width: WINDOW_WIDTH,
		height: WINDOW_HEIGHT,
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

// Save the window position after it stops moving. Reading the frame blocks on
// the main thread, so do it once per drag rather than on a timer.
let lastSavedX = settings.windowX;
let lastSavedY = settings.windowY;
let moveSaveTimer: ReturnType<typeof setTimeout> | null = null;
mainWindow.on("move", () => {
	if (moveSaveTimer) clearTimeout(moveSaveTimer);
	moveSaveTimer = setTimeout(() => {
		moveSaveTimer = null;
		if (!mainWindow) return;
		try {
			const frame = mainWindow.getFrame();
			if (frame.x === lastSavedX && frame.y === lastSavedY) return;
			lastSavedX = frame.x;
			lastSavedY = frame.y;
			settings = { ...settings, windowX: frame.x, windowY: frame.y };
			void saveSettings(settings);
		} catch {}
	}, WINDOW_SAVE_DEBOUNCE_MS);
});

function showWindow() {
	try {
		mainWindow?.show();
	} catch (err) {
		console.error("Show window failed:", err);
	}
}

status.notifications = initNotifications({
	onResponse: onNotificationResponse,
	onPermission: (p) => {
		if (status.notifications === p) return;
		status.notifications = p;
		pushStatus();
	},
});
setNotificationTheme(settings.theme);

// Notification permission can change in System Settings at any time; check
// again whenever the window comes forward.
mainWindow.on("focus", () => refreshNotificationPermission());

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
	endForCall: () => {
		endForCall();
	},
	cancelCallHold: () => {
		cancelCallHold();
	},
	showWindow,
	quit: () => {
		process.exit(0);
	},
});
updateTray(status, settings);

let shuttingDown = false;
function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	stopCaffeinate();
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
