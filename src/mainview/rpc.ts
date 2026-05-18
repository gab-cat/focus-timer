import { Electroview } from "electrobun/view";
import type { JigglerRPC, JigglerStatus } from "../shared/types";

type StatusListener = (s: JigglerStatus) => void;

const listeners = new Set<StatusListener>();

export function onStatus(fn: StatusListener) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

const rpc = Electroview.defineRPC<JigglerRPC>({
	handlers: {
		requests: {},
		messages: {
			statusChanged: (s) => {
				for (const fn of listeners) fn(s);
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
