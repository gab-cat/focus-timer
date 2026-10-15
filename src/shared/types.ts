import type { RPCSchema } from "electrobun/bun";

export type ActionType = "cmdtab" | "mouse" | "scroll" | "shift";
export const ACTION_TYPES: ActionType[] = ["cmdtab", "mouse", "scroll", "shift"];
export type ThemePref = "auto" | "dark" | "light";
export type PauseReason = null | "battery" | "call" | "lock";
// off: not requested · pending: waiting on pmset / admin prompt
// on: system sleep disabled · failed: prompt cancelled or pmset errored
export type SleepGuardState = "off" | "pending" | "on" | "failed";

export type Settings = {
	minDelayMs: number;
	maxDelayMs: number;
	idleThresholdMs: number;
	actionType: ActionType;
	pauseOnBattery: boolean;
	pauseOnCall: boolean;
	pauseOnLock: boolean;
	autoStopMs: number | null;
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
	pauseOnCall: true,
	pauseOnLock: true,
	autoStopMs: null,
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
