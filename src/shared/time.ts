// Time helpers shared by the Bun process and the view.

import type { Settings } from "./types";

export type AutoStopMode = "off" | "after" | "at";

// Longest auto-stop we accept. Keeps setTimeout and typos in check.
export const MAX_AUTO_STOP_MS = 24 * 60 * 60_000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(v: unknown): v is string {
	return typeof v === "string" && HHMM.test(v);
}

export function autoStopMode(s: Pick<Settings, "autoStopMs" | "autoStopTime">): AutoStopMode {
	if (isClockTime(s.autoStopTime)) return "at";
	if (s.autoStopMs != null && s.autoStopMs > 0) return "after";
	return "off";
}

// The next moment, strictly after `from`, when the local clock reads `hhmm`.
// Built from local date parts, so it lands on the right wall time across DST.
export function nextClockTime(hhmm: string, from: number): number {
	const m = HHMM.exec(hhmm);
	if (!m) return Number.NaN;
	const d = new Date(from);
	const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2]), 0, 0);
	if (at.getTime() <= from) at.setDate(at.getDate() + 1);
	return at.getTime();
}

// When a session started at `from` with these settings would stop.
export function plannedStopAt(
	s: Pick<Settings, "autoStopMs" | "autoStopTime">,
	from: number,
): number | null {
	switch (autoStopMode(s)) {
		case "at":
			return nextClockTime(s.autoStopTime as string, from);
		case "after":
			return from + Math.min(s.autoStopMs as number, MAX_AUTO_STOP_MS);
		default:
			return null;
	}
}

// 1h 04m · 12m · 45s
export function duration(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
	if (m > 0) return `${m}m`;
	return `${total}s`;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// "6:30 PM"
export function clockLabel(at: number) {
	return clock.format(new Date(at));
}

// "at 6:30 PM", "tomorrow at 6:30 PM", or "Wed at 6:30 PM" further out.
export function atLabel(at: number, now = Date.now()) {
	const a = new Date(at);
	const n = new Date(now);
	const dayDiff = Math.round(
		(new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
			new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) /
			86_400_000,
	);
	const time = clock.format(a);
	if (dayDiff === 0) return `at ${time}`;
	if (dayDiff === 1) return `tomorrow at ${time}`;
	return `${a.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
}

// "18:00" → "6:00 PM" in the user's locale.
export function clockTimeLabel(hhmm: string) {
	const m = HHMM.exec(hhmm);
	if (!m) return hhmm;
	return clock.format(new Date(2000, 0, 1, Number(m[1]), Number(m[2])));
}

// A sensible first pick for "stop at": an hour from now, rounded up to :00 or :30.
export function suggestClockTime(now = Date.now()) {
	const d = new Date(now + 60 * 60_000);
	const mins = d.getMinutes();
	if (mins > 30) d.setHours(d.getHours() + 1, 0);
	else if (mins > 0) d.setMinutes(30);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
