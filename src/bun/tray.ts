import { Tray } from "electrobun/bun";
import { atLabel } from "../shared/time";
import type { JigglerStatus, Settings } from "../shared/types";
import { ACTION_LABELS } from "./actions";

export type TrayActions = {
	toggleEnabled(): void;
	triggerNow(): void;
	setActionType(type: Settings["actionType"]): void;
	endForCall(): void;
	cancelCallHold(): void;
	showWindow(): void;
	quit(): void;
};

let tray: Tray | null = null;
let lastMenuJson = "";
let actions: TrayActions | null = null;

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function statusLine(status: JigglerStatus): string {
	if (status.callHold) return "Off for a call · starts again after";
	if (status.pauseReason) {
		const map: Record<NonNullable<JigglerStatus["pauseReason"]>, string> = {
			battery: "Paused · on battery",
			call: "Paused · on a call",
			lock: "Paused · screen locked",
		};
		return map[status.pauseReason];
	}
	if (!status.enabled) return "Idle";
	if (status.nextActionAt) {
		// An absolute time stays correct without rebuilding the menu every second.
		return `Active · next move at ${clock.format(status.nextActionAt)}`;
	}
	return "Active";
}

type Item =
	| { type: "divider" }
	| {
			type: "normal";
			label: string;
			action?: string;
			enabled?: boolean;
			checked?: boolean;
			submenu?: Item[];
	  };

function buildMenu(status: JigglerStatus, settings: Settings): Item[] {
	const info: Item[] = [{ type: "normal", label: statusLine(status), enabled: false }];
	if (status.enabled && status.autoStopAt) {
		info.push({ type: "normal", label: `Stops ${atLabel(status.autoStopAt)}`, enabled: false });
	}
	const call: Item[] = [];
	if (status.enabled && status.callPrompt) {
		call.push({ type: "normal", label: "End session for this call", action: "end-for-call" });
	}
	if (status.callHold) {
		call.push({ type: "normal", label: "Don't start again after the call", action: "cancel-hold" });
	}
	return [
		...info,
		{ type: "divider" },
		...call,
		{
			type: "normal",
			label: status.enabled ? "End session" : "Start session",
			action: "toggle",
		},
		{ type: "normal", label: "Move now", action: "trigger" },
		{ type: "divider" },
		{
			type: "normal",
			label: "Action",
			submenu: (Object.keys(ACTION_LABELS) as Array<Settings["actionType"]>).map((key) => ({
				type: "normal" as const,
				label: ACTION_LABELS[key],
				action: `action:${key}`,
				checked: settings.actionType === key,
			})),
		},
		{ type: "divider" },
		{ type: "normal", label: "Show window", action: "show" },
		{ type: "normal", label: "Quit", action: "quit" },
	];
}

export function setupTray(imagePath: string, handlers: TrayActions) {
	actions = handlers;
	tray = new Tray({ title: "", image: imagePath, template: true });
	tray.on("tray-clicked", (event) => {
		const action = (event as { action?: string } | undefined)?.action;
		if (!action || !actions) return;
		if (action === "toggle") actions.toggleEnabled();
		else if (action === "trigger") actions.triggerNow();
		else if (action === "end-for-call") actions.endForCall();
		else if (action === "cancel-hold") actions.cancelCallHold();
		else if (action === "show") actions.showWindow();
		else if (action === "quit") actions.quit();
		else if (action.startsWith("action:")) {
			const key = action.slice("action:".length) as Settings["actionType"];
			actions.setActionType(key);
		}
	});
	return tray;
}

// Each setMenu rebuilds the whole NSMenu on the main thread, so only do it
// when the menu's contents actually change.
export function updateTray(status: JigglerStatus, settings: Settings) {
	if (!tray) return;
	const menu = buildMenu(status, settings);
	const json = JSON.stringify(menu);
	if (json === lastMenuJson) return;
	lastMenuJson = json;
	tray.setMenu(menu as Parameters<Tray["setMenu"]>[0]);
}
