import { Electroview } from "electrobun/view";
import type {
	AppInfo,
	CalendarInfo,
	JigglerRPC,
	RhythmInfo,
	JigglerStatus,
	Settings,
	SleepHelperInfo,
	Stats,
} from "../shared/types";

type StatusListener = (s: JigglerStatus) => void;
type AppInfoListener = (i: AppInfo) => void;
type SettingsListener = (s: Settings) => void;
type StatsListener = (s: Stats) => void;
type RhythmListener = (r: RhythmInfo) => void;

const statusListeners = new Set<StatusListener>();
const appInfoListeners = new Set<AppInfoListener>();
const settingsListeners = new Set<SettingsListener>();
const statsListeners = new Set<StatsListener>();
const rhythmListeners = new Set<RhythmListener>();

export function onRhythm(fn: RhythmListener) {
	rhythmListeners.add(fn);
	return () => rhythmListeners.delete(fn);
}

export function onStatus(fn: StatusListener) {
	statusListeners.add(fn);
	return () => statusListeners.delete(fn);
}

export function onAppInfo(fn: AppInfoListener) {
	appInfoListeners.add(fn);
	return () => appInfoListeners.delete(fn);
}

export function onSettings(fn: SettingsListener) {
	settingsListeners.add(fn);
	return () => settingsListeners.delete(fn);
}

export function onStats(fn: StatsListener) {
	statsListeners.add(fn);
	return () => statsListeners.delete(fn);
}

const rpc = Electroview.defineRPC<JigglerRPC>({
	// Some requests wait on a macOS password dialog or a multi-step routine.
	maxRequestTime: 10 * 60_000,
	handlers: {
		requests: {},
		messages: {
			statusChanged: (s) => {
				for (const fn of statusListeners) fn(s);
			},
			appInfoChanged: (i) => {
				for (const fn of appInfoListeners) fn(i);
			},
			settingsChanged: (s) => {
				for (const fn of settingsListeners) fn(s);
			},
			statsChanged: (s) => {
				for (const fn of statsListeners) fn(s);
			},
			rhythmChanged: (r) => {
				for (const fn of rhythmListeners) fn(r);
			},
		},
	},
});

export const electroview = new Electroview({ rpc });

export async function setEnabled(enabled: boolean): Promise<JigglerStatus> {
	return electroview.rpc!.request.setEnabled({ enabled });
}

export async function getStatus(): Promise<JigglerStatus> {
	return electroview.rpc!.request.getStatus({});
}

export async function triggerNow(): Promise<JigglerStatus> {
	return electroview.rpc!.request.triggerNow({});
}

export async function getAppInfo(): Promise<AppInfo> {
	return electroview.rpc!.request.getAppInfo({});
}

export async function checkForUpdate(): Promise<AppInfo> {
	return electroview.rpc!.request.checkForUpdate({});
}

export async function applyUpdate(): Promise<void> {
	return electroview.rpc!.request.applyUpdate({});
}

export async function getSettings(): Promise<Settings> {
	return electroview.rpc!.request.getSettings({});
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
	return electroview.rpc!.request.updateSettings(patch);
}

export async function getStats(): Promise<Stats> {
	return electroview.rpc!.request.getStats({});
}

export async function resetStats(): Promise<Stats> {
	return electroview.rpc!.request.resetStats({});
}

export async function retrySleepGuard(): Promise<JigglerStatus> {
	return electroview.rpc!.request.retrySleepGuard({});
}

export async function getSleepHelper(): Promise<SleepHelperInfo> {
	return electroview.rpc!.request.getSleepHelper({});
}

export async function installSleepHelper(): Promise<SleepHelperInfo> {
	return electroview.rpc!.request.installSleepHelper({});
}

export async function removeSleepHelper(): Promise<SleepHelperInfo> {
	return electroview.rpc!.request.removeSleepHelper({});
}

export async function getCalendarInfo(): Promise<CalendarInfo> {
	return electroview.rpc!.request.getCalendarInfo({});
}

export async function requestCalendarAccess(): Promise<CalendarInfo> {
	return electroview.rpc!.request.requestCalendarAccess({});
}

export async function openCalendarPrivacy(): Promise<void> {
	return electroview.rpc!.request.openCalendarPrivacy({});
}

export async function getRhythm(): Promise<RhythmInfo> {
	return electroview.rpc!.request.getRhythm({});
}

export async function resetRhythm(): Promise<RhythmInfo> {
	return electroview.rpc!.request.resetRhythm({});
}
