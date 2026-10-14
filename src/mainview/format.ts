import type { JigglerStatus } from "../shared/types";

export function mmss(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
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

export function ago(ts: number | null) {
	if (!ts) return "never";
	const s = Math.round((Date.now() - ts) / 1000);
	if (s < 10) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	return `${Math.floor(m / 60)}h ago`;
}

export function clock(ts: number) {
	return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function minutesLabel(ms: number) {
	if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
	const m = Math.round(ms / 60_000);
	if (m < 60) return `${m} min`;
	const h = m / 60;
	return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

// "1.5–3 min" — a range in minutes with one decimal only where needed.
export function minuteRange(lo: number, hi: number) {
	const f = (ms: number) => {
		const m = ms / 60_000;
		return Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, "");
	};
	if (hi < 60_000) return `${Math.round(lo / 1000)}–${Math.round(hi / 1000)} s`;
	return `${f(lo)}–${f(hi)} min`;
}

export const ROUTINE_LABELS: Record<string, string> = {
	nudge: "Nudge",
	reach: "Reach",
	read: "Reading",
	glance: "App glance",
	fidget: "Fidget",
	browse: "Browse",
	cmdtab: "⌘-Tab",
	mouse: "Mouse",
	scroll: "Scroll",
	shift: "Shift tap",
	natural: "Natural",
};

export const routineLabel = (r: string | null) => (r ? (ROUTINE_LABELS[r] ?? r) : "");

export type PauseCopy = { title: string; detail: string | null };

export function pauseCopy(status: JigglerStatus): PauseCopy | null {
	switch (status.pauseReason) {
		case "battery":
			return { title: "On battery", detail: "Resumes when plugged in" };
		case "call":
			return { title: "On a call", detail: "Resumes when it ends" };
		case "lock":
			return { title: "Screen locked", detail: "Resumes when unlocked" };
		case "break":
			return {
				title: "Short break",
				detail: status.nextActionAt ? `Back in ${mmss(status.nextActionAt - Date.now())}` : null,
			};
		case "meeting": {
			try {
				const m = JSON.parse(status.pauseDetail ?? "") as { title: string; end: number };
				return { title: m.title || "In a meeting", detail: `Until ${clock(m.end)}` };
			} catch {
				return { title: "In a meeting", detail: null };
			}
		}
		default:
			return null;
	}
}
