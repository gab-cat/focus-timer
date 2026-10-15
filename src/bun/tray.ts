import { Tray } from "electrobun/bun";
import type { JigglerStatus, Settings } from "../shared/types";
import { ACTION_LABELS } from "./actions";

export type TrayActions = {
	toggleEnabled(): void;
	triggerNow(): void;
	setActionType(type: Settings["actionType"]): void;
	showWindow(): void;
	quit(): void;
};

let tray: Tray | null = null;
let lastStatus: JigglerStatus | null = null;
let lastSettings: Settings | null = null;
let actions: TrayActions | null = null;

function mmss(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusLine(status: JigglerStatus): string {
	if (status.pauseReason) {
		const map: Record<NonNullable<JigglerStatus["pauseReason"]>, string> = {
			battery: "Paused — battery",
			call: "Paused — on call",
			lock: "Paused — screen locked",
		};
		return map[status.pauseReason];
	}
	if (!status.enabled) return "Idle";
	if (status.nextActionAt) {
		const remaining = status.nextActionAt - Date.now();
		return `Active · next in ${mmss(remaining)}`;
	}
	return "Active";
}

function buildMenu(status: JigglerStatus, settings: Settings) {
	return [
		{ type: "normal" as const, label: statusLine(status), enabled: false },
		{ type: "divider" as const },
		{
			type: "normal" as const,
			label: status.enabled ? "Pause" : "Resume",
			action: "toggle",
		},
		{ type: "normal" as const, label: "Refresh Now", action: "trigger" },
		{ type: "divider" as const },
		{
			type: "normal" as const,
			label: "Action",
			submenu: (Object.keys(ACTION_LABELS) as Array<Settings["actionType"]>).map(
				(key) => ({
					type: "normal" as const,
					label: ACTION_LABELS[key],
					action: `action:${key}`,
					checked: settings.actionType === key,
				}),
			),
		},
		{ type: "divider" as const },
		{ type: "normal" as const, label: "Show Window", action: "show" },
		{ type: "normal" as const, label: "Quit", action: "quit" },
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
		else if (action === "show") actions.showWindow();
		else if (action === "quit") actions.quit();
		else if (action.startsWith("action:")) {
			const key = action.slice("action:".length) as Settings["actionType"];
			actions.setActionType(key);
		}
	});
	return tray;
}

export function updateTray(status: JigglerStatus, settings: Settings) {
	lastStatus = status;
	lastSettings = settings;
	if (!tray) return;
	tray.setMenu(buildMenu(status, settings));
}

// Refresh just the dynamic countdown label on a 1s tick without rebuilding state.
export function tickTray() {
	if (!tray || !lastStatus || !lastSettings) return;
	if (!lastStatus.enabled || lastStatus.pauseReason) return;
	tray.setMenu(buildMenu(lastStatus, lastSettings));
}
