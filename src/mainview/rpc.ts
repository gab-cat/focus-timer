import { Electroview } from "electrobun/view";
import type { AppInfo, JigglerRPC, JigglerStatus } from "../shared/types";

type StatusListener = (s: JigglerStatus) => void;
type AppInfoListener = (i: AppInfo) => void;

const statusListeners = new Set<StatusListener>();
const appInfoListeners = new Set<AppInfoListener>();

export function onStatus(fn: StatusListener) {
	statusListeners.add(fn);
	return () => statusListeners.delete(fn);
}

export function onAppInfo(fn: AppInfoListener) {
	appInfoListeners.add(fn);
	return () => appInfoListeners.delete(fn);
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
