import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
	ACTION_TYPES,
	DEFAULT_SETTINGS,
	type Settings,
	type Stats,
} from "../shared/types";

export const SUPPORT_DIR = `${process.env.HOME}/Library/Application Support/com.focustimer.app`;
const SETTINGS_PATH = `${SUPPORT_DIR}/settings.json`;
const STATS_PATH = `${SUPPORT_DIR}/stats.json`;

export function todayISO(): string {
	const d = new Date();
	const m = (d.getMonth() + 1).toString().padStart(2, "0");
	const day = d.getDate().toString().padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

function emptyStats(): Stats {
	return {
		totalActions: 0,
		today: { date: todayISO(), count: 0 },
		history: {},
		hourly: {},
		routines: {},
	};
}

const HEATMAP_DAYS = 7;

function sanitizeHourly(raw: unknown): Record<string, number[]> {
	const out: Record<string, number[]> = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [k, v] of Object.entries(raw)) {
		if (Array.isArray(v) && v.length === 24 && v.every((n) => typeof n === "number")) {
			out[k] = v as number[];
		}
	}
	return out;
}

function trimDays(map: Record<string, number[]>) {
	const keys = Object.keys(map).sort();
	while (keys.length > HEATMAP_DAYS) delete map[keys.shift()!];
}

// Increments one hour bucket for today's date in a heatmap map.
export function bumpHour(map: Record<string, number[]>, at = new Date(), by = 1) {
	const key = todayISO();
	const row = map[key] ?? (map[key] = new Array(24).fill(0));
	row[at.getHours()] += by;
	trimDays(map);
}

async function ensureDir(path: string) {
	try {
		await mkdir(dirname(path), { recursive: true });
	} catch {}
}

function sanitizeSettings(input: unknown): Settings {
	const out: Settings = { ...DEFAULT_SETTINGS };
	if (!input || typeof input !== "object") return out;
	const src = input as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
		const v = src[key];
		if (v === undefined) continue;
		const def = DEFAULT_SETTINGS[key];
		if (def === null || typeof v === typeof def) {
			(out as Record<string, unknown>)[key] = v as unknown;
		}
	}
	// Modes removed in later versions (e.g. "natural") fall back to the default.
	if (!ACTION_TYPES.includes(out.actionType)) out.actionType = DEFAULT_SETTINGS.actionType;
	// Cross-field validation
	if (out.minDelayMs < 1000) out.minDelayMs = 1000;
	if (out.maxDelayMs < out.minDelayMs) out.maxDelayMs = out.minDelayMs;
	if (out.idleThresholdMs < 0) out.idleThresholdMs = 0;
	return out;
}

export async function loadSettings(): Promise<Settings> {
	try {
		const file = Bun.file(SETTINGS_PATH);
		if (!(await file.exists())) return { ...DEFAULT_SETTINGS };
		const data = await file.json();
		return sanitizeSettings(data);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(s: Settings): Promise<void> {
	try {
		await ensureDir(SETTINGS_PATH);
		await Bun.write(SETTINGS_PATH, JSON.stringify(s, null, 2));
	} catch (err) {
		console.error("Failed to save settings:", err);
	}
}

function sanitizeStats(input: unknown): Stats {
	const fallback = emptyStats();
	if (!input || typeof input !== "object") return fallback;
	const src = input as Record<string, unknown>;
	const total = typeof src.totalActions === "number" ? src.totalActions : 0;
	const todayRaw = src.today as { date?: unknown; count?: unknown } | undefined;
	const today =
		todayRaw && typeof todayRaw.date === "string" && typeof todayRaw.count === "number"
			? { date: todayRaw.date, count: todayRaw.count }
			: { date: todayISO(), count: 0 };
	const historyRaw = src.history;
	const history: Record<string, number> = {};
	if (historyRaw && typeof historyRaw === "object") {
		for (const [k, v] of Object.entries(historyRaw)) {
			if (typeof v === "number") history[k] = v;
		}
	}
	const routines: Record<string, number> = {};
	if (src.routines && typeof src.routines === "object") {
		for (const [k, v] of Object.entries(src.routines)) {
			if (typeof v === "number") routines[k] = v;
		}
	}
	return {
		totalActions: total,
		today,
		history,
		hourly: sanitizeHourly(src.hourly),
		routines,
	};
}

export async function loadStats(): Promise<Stats> {
	try {
		const file = Bun.file(STATS_PATH);
		if (!(await file.exists())) return emptyStats();
		return sanitizeStats(await file.json());
	} catch {
		return emptyStats();
	}
}

export async function saveStats(s: Stats): Promise<void> {
	try {
		await ensureDir(STATS_PATH);
		await Bun.write(STATS_PATH, JSON.stringify(s, null, 2));
	} catch (err) {
		console.error("Failed to save stats:", err);
	}
}

// Roll the per-day counter when the date changes. Trims history to last 7 days.
export function rollStatsDay(s: Stats): Stats {
	const today = todayISO();
	if (s.today.date === today) return s;
	const next: Stats = {
		...s,
		today: { date: today, count: 0 },
		history: { ...s.history, [s.today.date]: s.today.count },
		hourly: { ...s.hourly },
	};
	trimDays(next.hourly);
	// Keep only the most recent 7 entries.
	const keys = Object.keys(next.history).sort();
	while (keys.length > 7) {
		const k = keys.shift()!;
		delete next.history[k];
	}
	return next;
}

export function emptyStatsValue(): Stats {
	return emptyStats();
}
