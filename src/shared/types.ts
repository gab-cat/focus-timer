import type { RPCSchema } from "electrobun/bun";

export type ActionType = "natural" | "cmdtab" | "mouse" | "scroll" | "shift";
export type ThemePref = "auto" | "dark" | "light";
export type ScrollStyle = "trackpad" | "wheel";
export type PauseReason = null | "battery" | "call" | "lock" | "break" | "meeting";
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
	// Pause during calendar events that have other people or a video link.
	pauseOnMeeting: boolean;
	autoStopMs: number | null;
	// Equivalent of `pmset -a disablesleep 1` for the duration of a session.
	preventSystemSleep: boolean;
	// Periodically go quiet for a few minutes, like stepping away for coffee.
	naturalBreaks: boolean;
	// Tailor routines to the frontmost app and keep moves inside its window.
	appAware: boolean;
	// Trackpad: phased gestures with momentum. Wheel: plain pixel scrolls.
	scrollStyle: ScrollStyle;
	// Record your own input rhythm (timing and movement shape only) and
	// replay it in Natural mode.
	learnRhythm: boolean;
	windowX: number | null;
	windowY: number | null;
	theme: ThemePref;
};

export const DEFAULT_SETTINGS: Settings = {
	minDelayMs: 90 * 1000,
	maxDelayMs: 180 * 1000,
	idleThresholdMs: 2 * 60 * 1000,
	actionType: "natural",
	pauseOnBattery: false,
	pauseOnCall: true,
	pauseOnLock: true,
	pauseOnMeeting: false,
	autoStopMs: null,
	preventSystemSleep: true,
	naturalBreaks: false,
	appAware: true,
	scrollStyle: "trackpad",
	learnRhythm: false,
	windowX: null,
	windowY: null,
	theme: "auto",
};

export type Stats = {
	totalActions: number;
	today: { date: string; count: number };
	history: Record<string, number>;
	// date → 24 hourly counts of synthetic actions (last 7 days).
	hourly: Record<string, number[]>;
	// date → 24 hourly counts of minutes *you* were active (when learning).
	userHourly: Record<string, number[]>;
	// routine name → all-time count.
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
	// Extra context for the pause, e.g. the meeting title.
	pauseDetail: string | null;
	lastRoutine: string | null;
	// Frontmost app the last routine ran against.
	lastApp: string | null;
	sleepGuard: SleepGuardState;
	// Recent actions (newest last), for the activity trace.
	recent: Array<{ at: number; routine: string }>;
};

export type SleepHelperInfo = {
	installed: boolean;
	error: string | null;
};

export type CalendarAccess =
	| "notDetermined"
	| "restricted"
	| "denied"
	| "granted"
	| "writeOnly"
	| "unknown";

export type CalendarInfo = {
	access: CalendarAccess;
	current: { title: string; end: number } | null;
	next: { title: string; start: number } | null;
};

export type RhythmInfo = {
	learning: boolean;
	ready: boolean;
	strokes: number;
	scrollPauses: number;
	activityGaps: number;
	// Strokes needed before the profile is used.
	target: number;
	// Learned summary for display.
	medianNudgePx: number | null;
	medianReachPx: number | null;
	fitts: { a: number; b: number } | null;
	mix: { mouse: number; scroll: number; keys: number } | null;
	updatedAt: number | null;
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
			getCalendarInfo: { params: {}; response: CalendarInfo };
			requestCalendarAccess: { params: {}; response: CalendarInfo };
			openCalendarPrivacy: { params: {}; response: void };
			getRhythm: { params: {}; response: RhythmInfo };
			resetRhythm: { params: {}; response: RhythmInfo };
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
			rhythmChanged: RhythmInfo;
		};
	}>;
};
