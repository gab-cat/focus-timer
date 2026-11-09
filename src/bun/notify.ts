// Native notifications with buttons, via native/notify.m. When macOS won't
// deliver them (turned off, or an ad-hoc signed build), the helper shows the
// same notice as a small floating panel instead, with the same buttons.
//
// If the helper library is missing (a dev run without `bun run native`), we
// fall back to Electrobun's plain notifications: same text, no buttons.

import { Utils } from "electrobun/bun";
import { dlopen, FFIType, JSCallback } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NotifyPermission, ThemePref } from "../shared/types";

// What a notification is about. Sent back with every response.
export const NotifyKind = {
	AutoStopped: 3,
	Test: 4,
} as const;
export type NotifyKind = (typeof NotifyKind)[keyof typeof NotifyKind];

// Button codes. 0 means the notification body itself was clicked.
export const NotifyAction = {
	Open: 0,
} as const;
export type NotifyAction = (typeof NotifyAction)[keyof typeof NotifyAction];

export type NotifyHandlers = {
	onResponse(kind: NotifyKind, action: NotifyAction): void;
	onPermission(p: NotifyPermission): void;
	// Some app started or stopped using the microphone (see watchMicrophone).
	onMicChange(): void;
};

type Native = {
	ft_notify_init: (cb: unknown) => number;
	ft_notify_request: () => void;
	ft_notify_refresh: () => void;
	ft_notify_category: (id: Buffer, c1: number, t1: Buffer, c2: number, t2: Buffer) => void;
	ft_notify_post: (id: Buffer, cat: Buffer, title: Buffer, body: Buffer, kind: number, sound: number) => void;
	ft_notify_remove: (id: Buffer) => void;
	ft_notify_theme: (theme: number) => void;
	ft_mic_watch: (on: number) => number;
};

const c = (s: string) => Buffer.from(`${s}\0`, "utf8");

let native: Native | null = null;
// Held for the life of the process so the callback isn't collected.
let callback: JSCallback | null = null;
let permission: NotifyPermission = "unavailable";

function libraryPath(): string | null {
	// Bundled: Resources/app/bun/index.js → Resources/app/native/.
	const candidates = [
		join(import.meta.dir, "..", "native", "libftnotify.dylib"),
		join(import.meta.dir, "..", "..", "native", "build", "libftnotify.dylib"),
	];
	return candidates.find((p) => existsSync(p)) ?? null;
}

export function initNotifications(handlers: NotifyHandlers): NotifyPermission {
	const path = libraryPath();
	if (!path) {
		console.warn("Notification helper not found; notifications won't have buttons.");
		return permission;
	}
	try {
		const lib = dlopen(path, {
			ft_notify_init: { args: [FFIType.function], returns: FFIType.i32 },
			ft_notify_request: { args: [], returns: FFIType.void },
			ft_notify_refresh: { args: [], returns: FFIType.void },
			ft_notify_category: {
				args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr],
				returns: FFIType.void,
			},
			ft_notify_post: {
				args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32],
				returns: FFIType.void,
			},
			ft_notify_remove: { args: [FFIType.ptr], returns: FFIType.void },
			ft_notify_theme: { args: [FFIType.i32], returns: FFIType.void },
			ft_mic_watch: { args: [FFIType.i32], returns: FFIType.i32 },
		});
		callback = new JSCallback(
			(event: number, a: number, b: number) => {
				if (event === 1) {
					handlers.onResponse(a as NotifyKind, b as NotifyAction);
				} else if (event === 2) {
					// The helper keeps "blocked" over a later "not asked yet".
					permission = a === 3 ? "blocked" : a === 2 ? "allowed" : a === 1 ? "denied" : "unknown";
					handlers.onPermission(permission);
				} else if (event === 3) {
					handlers.onMicChange();
				}
			},
			{ args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.void, threadsafe: true },
		);
		const n = lib.symbols as unknown as Native;
		if (!n.ft_notify_init(callback.ptr)) {
			callback.close();
			callback = null;
			return permission;
		}
		native = n;
		permission = "unknown";
	} catch (err) {
		console.error("Notification helper failed to load:", err);
		native = null;
	}
	return permission;
}

export function notificationPermission(): NotifyPermission {
	return permission;
}

export function requestNotificationPermission() {
	native?.ft_notify_request();
}

export function refreshNotificationPermission() {
	native?.ft_notify_refresh();
}

export type Notice = {
	// Posting again with the same id replaces the earlier one.
	id: string;
	title: string;
	body: string;
	kind: NotifyKind;
	// A category registered with ft_notify_category, for buttons.
	category?: string;
	sound?: boolean;
};

export function notify(n: Notice) {
	if (native) {
		native.ft_notify_post(c(n.id), c(n.category ?? ""), c(n.title), c(n.body), n.kind, n.sound ? 1 : 0);
		return;
	}
	try {
		Utils.showNotification({ title: n.title, body: n.body, silent: !n.sound });
	} catch (err) {
		console.error("Notification failed:", err);
	}
}

// Ask CoreAudio to tell us when any app starts or stops using the
// microphone. Returns false when that isn't available (helper missing, or
// macOS before 14.2), and the caller should poll instead.
export function watchMicrophone(on: boolean): boolean {
	return native ? native.ft_mic_watch(on ? 1 : 0) === 1 : false;
}

// The fallback panel follows the app's theme setting.
export function setNotificationTheme(theme: ThemePref) {
	native?.ft_notify_theme(theme === "dark" ? 1 : theme === "light" ? 2 : 0);
}

export function clearNotification(id: string) {
	native?.ft_notify_remove(c(id));
}
