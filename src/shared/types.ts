import type { RPCSchema } from "electrobun/bun";

export type ActionType = "cmdtab" | "mouse" | "scroll" | "shift";
export const ACTION_TYPES: ActionType[] = ["cmdtab", "mouse", "scroll", "shift"];
export type ThemePref = "auto" | "dark" | "light";
export type PauseReason = null | "battery" | "call" | "lock";
// What happens when a call starts mid-session (a call = an app using the mic).
// ask: pause moves and send a notification offering to end the session; if
//      ended, it starts again when the call ends.
// pause: pause moves until the call ends. off: calls change nothing.
export type CallMode = "ask" | "pause" | "off";
export const CALL_MODES: CallMode[] = ["ask", "pause", "off"];
// unavailable: the native notification helper didn't load (dev without it).
export type NotifyPermission = "unknown" | "allowed" | "denied" | "unavailable";
// off: not requested · pending: waiting on pmset / admin prompt
// on: system sleep disabled · failed: prompt cancelled or pmset errored
export type SleepGuardState = "off" | "pending" | "on" | "failed";

export type Settings = {
	minDelayMs: number;
	maxDelayMs: number;
	idleThresholdMs: number;
	actionType: ActionType;
	pauseOnBattery: boolean;
	callMode: CallMode;
	pauseOnLock: boolean;
	// Auto-stop: at most one of these is set. autoStopMs stops the session
	// that long after it starts; autoStopTime ("HH:MM", local) stops it at the
	// next time the clock reads that.
	autoStopMs: number | null;
	autoStopTime: string | null;
	// Equivalent of `pmset -a disablesleep 1` for the duration of a session.
	preventSystemSleep: boolean;
	windowX: number | null;
	windowY: number | null;
	theme: ThemePref;
};

export const DEFAULT_SETTINGS: Settings = {
	minDelayMs: 90 * 1000,
	maxDelayMs: 180 * 1000,
	idleThresholdMs: 2 * 60 * 1000,
	actionType: "cmdtab",
	pauseOnBattery: false,
	callMode: "ask",
	pauseOnLock: true,
	autoStopMs: null,
	autoStopTime: null,
	preventSystemSleep: true,
	windowX: null,
	windowY: null,
	theme: "auto",
};

export type Stats = {
	totalActions: number;
	today: { date: string; count: number };
	history: Record<string, number>;
	// date → 24 hourly counts of actions (last 7 days).
	hourly: Record<string, number[]>;
	// action type → all-time count.
	routines: Record<string, number>;
};

export type JigglerStatus = {
	enabled: boolean;
	lastActionAt: number | null;
	nextActionAt: number | null;
	// When the current wait began, so the UI can draw progress toward the next action.
	waitStartedAt: number | null;
	actionCount: number;
	sessionStartedAt: number | null;
	autoStopAt: number | null;
	pauseReason: PauseReason;
	// Action type of the most recent action.
	lastRoutine: string | null;
	sleepGuard: SleepGuardState;
	// Recent actions (newest last), for the activity trace.
	recent: Array<{ at: number; routine: string }>;
	// A call is in progress (debounced microphone use).
	onCall: boolean;
	// The app using the microphone, when known ("Microsoft Teams").
	callApp: string | null;
	// Asking whether to end the session for this call.
	callPrompt: boolean;
	// The session was ended for a call and starts again when the call ends.
	callHold: boolean;
	notifications: NotifyPermission;
};

export type SleepHelperInfo = {
	installed: boolean;
	error: string | null;
};

export type UpdatePhase =
	| "idle"
	| "checking"
	| "downloading"
	| "ready"
	// Restart was pressed: unpacking and swapping in the new version.
	| "installing"
	// Swapped in; the app is about to quit and reopen.
	| "restarting"
	| "error";

export type AppInfo = {
	version: string;
	channel: string;
	updateAvailable: boolean;
	updateReady: boolean;
	updatePhase: UpdatePhase;
	updateProgress: number | null;
	availableVersion: string | null;
	error: string | null;
};

export type JigglerRPC = {
	bun: RPCSchema<{
		requests: {
			setEnabled: { params: { enabled: boolean }; response: JigglerStatus };
			getStatus: { params: {}; response: JigglerStatus };
			triggerNow: { params: {}; response: JigglerStatus };
			getAppInfo: { params: {}; response: AppInfo };
			checkForUpdate: { params: {}; response: AppInfo };
			applyUpdate: { params: {}; response: void };
			getSettings: { params: {}; response: Settings };
			updateSettings: { params: Partial<Settings>; response: Settings };
			getStats: { params: {}; response: Stats };
			resetStats: { params: {}; response: Stats };
			retrySleepGuard: { params: {}; response: JigglerStatus };
			getSleepHelper: { params: {}; response: SleepHelperInfo };
			installSleepHelper: { params: {}; response: SleepHelperInfo };
			removeSleepHelper: { params: {}; response: SleepHelperInfo };
			// End the session for the current call; it restarts when the call ends.
			endForCall: { params: {}; response: JigglerStatus };
			// Keep the session running through this call and stop asking.
			dismissCallPrompt: { params: {}; response: JigglerStatus };
			// Don't restart the session when the call ends.
			cancelCallHold: { params: {}; response: JigglerStatus };
			requestNotifications: { params: {}; response: JigglerStatus };
			openNotificationSettings: { params: {}; response: void };
			sendTestNotification: { params: {}; response: JigglerStatus };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			statusChanged: JigglerStatus;
			appInfoChanged: AppInfo;
			settingsChanged: Settings;
			statsChanged: Stats;
		};
	}>;
};
