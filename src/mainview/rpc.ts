import { Electroview } from "electrobun/view";
import type {
	AppInfo,
	JigglerRPC,
	JigglerStatus,
	Settings,
	Stats,
} from "../shared/types";

type StatusListener = (s: JigglerStatus) => void;
type AppInfoListener = (i: AppInfo) => void;
type SettingsListener = (s: Settings) => void;
type StatsListener = (s: Stats) => void;

const statusListeners = new Set<StatusListener>();
const appInfoListeners = new Set<AppInfoListener>();
const settingsListeners = new Set<SettingsListener>();
const statsListeners = new Set<StatsListener>();

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
