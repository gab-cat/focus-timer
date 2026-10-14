// "Learn my rhythm": a low-rate sampler watches *how* you use the Mac — stroke
// distances and durations, path curvature, pauses between moves and scrolls,
// gaps between bursts of activity — and Natural mode replays those
// distributions instead of built-in guesses.
//
// Only shapes and timings are kept. No keys, no cursor positions, no app
// names. Everything stays in ~/Library/Application Support.

import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Subprocess } from "bun";
import type { RhythmInfo } from "../shared/types";
import { clamp, type Learned, setLearned } from "./humanize";
import { SUPPORT_DIR } from "./settings";

const PROFILE_PATH = `${SUPPORT_DIR}/rhythm.json`;
const TARGET_STROKES = 80;
const CAP_STROKES = 600;
const CAP_OTHER = 400;

// Polls the cursor at ~33 Hz and per-type "seconds since last event" (no
// event tap, so no Input Monitoring permission). Emits one line per completed
// stroke / scroll burst / key burst. A heartbeat makes it die with SIGPIPE
// soon after the app does.
const SAMPLER_JXA = `
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
var out = $.NSFileHandle.fileHandleWithStandardOutput;
function emit(s) { out.writeData($(s + "\\n").dataUsingEncoding($.NSUTF8StringEncoding)); }
function since(t) { return $.CGEventSourceSecondsSinceLastEventType(1, t); }
function here() { return $.CGEventGetLocation($.CGEventCreate($())); }
var prev = here(), prevT = Date.now();
var moving = false, still = 0, sx = 0, sy = 0, st = 0, len = 0, peak = 0, endT = 0;
var scrollOn = false, scrollStart = 0, scrollLast = 0;
var keyOn = false, keyStart = 0, keyLast = 0;
var beat = Date.now();
for (;;) {
  // Fast while input is happening, slow when idle — keeps CPU near zero.
  var busy = moving || scrollOn || keyOn || since(5) < 1.5;
  delay(busy ? 0.03 : 0.12);
  var t = Date.now();
  var dtMs = Math.max(1, t - prevT);
  var win = dtMs / 1000 + 0.004;
  var l = here();
  var dx = l.x - prev.x, dy = l.y - prev.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.5) {
    // Coming out of the slow poll, assume the stroke began mid-interval.
    if (!moving) { moving = true; sx = prev.x; sy = prev.y; st = prevT + (busy ? 0 : dtMs / 2); len = 0; peak = 0; }
    len += d;
    if (d / dtMs > peak) peak = d / dtMs;
    still = 0; endT = t;
  } else if (moving && ++still >= 3) {
    moving = false;
    var chord = Math.sqrt((prev.x - sx) * (prev.x - sx) + (prev.y - sy) * (prev.y - sy));
    emit("M " + st + " " + endT + " " + chord.toFixed(1) + " " + len.toFixed(1) + " " + peak.toFixed(3));
  }
  prev = l; prevT = t;
  if (since(22) <= win) { if (!scrollOn) { scrollOn = true; scrollStart = t; } scrollLast = t; }
  else if (scrollOn && t - scrollLast > 350) { scrollOn = false; emit("S " + scrollStart + " " + scrollLast); }
  if (since(10) <= win) { if (!keyOn) { keyOn = true; keyStart = t; } keyLast = t; }
  else if (keyOn && t - keyLast > 1000) { keyOn = false; emit("K " + keyStart + " " + keyLast); }
  if (since(1) <= win) emit("C " + t);
  if (t - beat > 5000) { beat = t; emit("H " + t); }
}
`;

type Profile = {
	version: 1;
	// [chord px, duration ms, path/chord ratio]
	strokes: Array<[number, number, number]>;
	movePauses: number[];
	scrollPauses: number[];
	activityGaps: number[];
	// Total active ms by input kind, for the routine mix.
	activeMs: { mouse: number; scroll: number; keys: number };
	seen: { strokes: number; movePauses: number; scrollPauses: number; activityGaps: number };
	updatedAt: number | null;
};

function emptyProfile(): Profile {
	return {
		version: 1,
		strokes: [],
		movePauses: [],
		scrollPauses: [],
		activityGaps: [],
		activeMs: { mouse: 0, scroll: 0, keys: 0 },
		seen: { strokes: 0, movePauses: 0, scrollPauses: 0, activityGaps: 0 },
		updatedAt: null,
	};
}

let profile: Profile = emptyProfile();
let dirty = false;
let proc: Subprocess<"ignore", "pipe", "ignore"> | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;
let listener: (info: RhythmInfo) => void = () => {};
let minuteListener: (at: number) => void = () => {};

export function onRhythmChange(fn: (info: RhythmInfo) => void) {
	listener = fn;
}

// Fires once per wall-clock minute in which the user (not us) was active.
export function onActiveMinute(fn: (at: number) => void) {
	minuteListener = fn;
}

// ── Synthetic input filter ──────────────────────────────────────────────────
// Our own routines show up in the same signals, so anything overlapping one
// is dropped.

const synthetic: Array<[number, number]> = [];
let synthOpenSince: number | null = null;

export function markSyntheticStart() {
	synthOpenSince = Date.now();
}

export function markSyntheticEnd() {
	if (synthOpenSince == null) return;
	synthetic.push([synthOpenSince, Date.now()]);
	synthOpenSince = null;
	const cutoff = Date.now() - 10 * 60_000;
	while (synthetic.length && synthetic[0][1] < cutoff) synthetic.shift();
}

function isSynthetic(start: number, end: number) {
	if (synthOpenSince != null && end >= synthOpenSince - 200) return true;
	return synthetic.some(([s, e]) => start <= e + 600 && end >= s - 200);
}

// ── Reservoir sampling ──────────────────────────────────────────────────────

function keep<T>(arr: T[], item: T, seen: number, cap: number) {
	if (arr.length < cap) arr.push(item);
	else {
		const j = Math.floor(Math.random() * seen);
		if (j < cap) arr[j] = item;
	}
}

let lastStrokeEnd = 0;
let lastScrollEnd = 0;
let lastActivityEnd = 0;
let lastMinute = 0;

function activity(start: number, end: number) {
	if (lastActivityEnd) {
		const gap = start - lastActivityEnd;
		if (gap >= 2_000 && gap <= 10 * 60_000) {
			profile.seen.activityGaps++;
			keep(profile.activityGaps, gap, profile.seen.activityGaps, CAP_OTHER);
		}
	}
	lastActivityEnd = Math.max(lastActivityEnd, end);
	const minute = Math.floor(end / 60_000);
	if (minute !== lastMinute) {
		lastMinute = minute;
		minuteListener(end);
	}
	profile.updatedAt = Date.now();
	dirty = true;
}

function handleLine(line: string) {
	const [kind, ...rest] = line.trim().split(" ");
	const n = rest.map(Number);
	if (n.some((v) => !Number.isFinite(v))) return;
	switch (kind) {
		case "M": {
			const [start, end, chord, len] = n;
			if (isSynthetic(start, end)) return;
			const dur = end - start;
			if (chord >= 3 && dur >= 30 && dur <= 4_000) {
				const ratio = clamp(len / chord, 1, 2);
				profile.seen.strokes++;
				keep(profile.strokes, [Math.round(chord), Math.round(dur), Math.round(ratio * 1000) / 1000], profile.seen.strokes, CAP_STROKES);
			}
			if (lastStrokeEnd) {
				const gap = start - lastStrokeEnd;
				if (gap >= 80 && gap <= 6_000) {
					profile.seen.movePauses++;
					keep(profile.movePauses, gap, profile.seen.movePauses, CAP_OTHER);
				}
			}
			lastStrokeEnd = end;
			profile.activeMs.mouse += dur;
			activity(start, end);
			break;
		}
		case "S": {
			const [start, end] = n;
			if (isSynthetic(start, end)) return;
			if (lastScrollEnd) {
				const gap = start - lastScrollEnd;
				if (gap >= 250 && gap <= 12_000) {
					profile.seen.scrollPauses++;
					keep(profile.scrollPauses, gap, profile.seen.scrollPauses, CAP_OTHER);
				}
			}
			lastScrollEnd = end;
			profile.activeMs.scroll += Math.max(100, end - start);
			activity(start, end);
			break;
		}
		case "K": {
			const [start, end] = n;
			if (isSynthetic(start, end)) return;
			profile.activeMs.keys += Math.max(100, end - start);
			activity(start, end);
			break;
		}
		case "C": {
			const [at] = n;
			if (isSynthetic(at, at)) return;
			activity(at, at);
			break;
		}
	}
}

// ── Derivation ──────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

// Least-squares fit of duration = a + b·log2(D/18 + 1).
function fitFitts(strokes: Profile["strokes"]) {
	const pts = strokes
		.filter(([d, t]) => d >= 20 && t >= 60 && t <= 3_000)
		.map(([d, t]) => [Math.log2(d / 18 + 1), t] as const);
	if (pts.length < 30) return null;
	const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
	const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
	let num = 0;
	let den = 0;
	for (const [x, y] of pts) {
		num += (x - mx) * (y - my);
		den += (x - mx) ** 2;
	}
	if (den === 0) return null;
	const b = clamp(num / den, 30, 350);
	const a = clamp(my - b * mx, 40, 400);
	return { a: Math.round(a), b: Math.round(b) };
}

function mixOf(p: Profile) {
	const total = p.activeMs.mouse + p.activeMs.scroll + p.activeMs.keys;
	if (total < 60_000) return null;
	const r = (v: number) => Math.round((v / total) * 100) / 100;
	return { mouse: r(p.activeMs.mouse), scroll: r(p.activeMs.scroll), keys: r(p.activeMs.keys) };
}

function derive(p: Profile): Learned | null {
	if (p.strokes.length < TARGET_STROKES) return null;
	const gaps = p.activityGaps;
	const shortGaps = gaps.filter((g) => g >= 3_000 && g <= 25_000);
	const mediumGaps = gaps.filter((g) => g >= 3_000 && g <= 300_000);
	return {
		nudgeDists: p.strokes.filter(([d]) => d >= 3 && d <= 80).map(([d]) => d),
		reachDists: p.strokes.filter(([d]) => d >= 100).map(([d]) => d),
		ratios: p.strokes.filter(([d]) => d >= 40).map(([, , r]) => r),
		fitts: fitFitts(p.strokes),
		movePauses: p.movePauses,
		scrollPauses: p.scrollPauses,
		followUpGaps: shortGaps,
		followUp: mediumGaps.length >= 20 ? clamp(shortGaps.length / mediumGaps.length, 0.1, 0.5) : null,
		mix: mixOf(p),
	};
}

export function rhythmInfo(): RhythmInfo {
	const learnedNow = derive(profile);
	return {
		learning: proc != null,
		ready: learnedNow != null,
		strokes: profile.strokes.length,
		scrollPauses: profile.scrollPauses.length,
		activityGaps: profile.activityGaps.length,
		target: TARGET_STROKES,
		medianNudgePx: median(profile.strokes.filter(([d]) => d <= 80).map(([d]) => d)),
		medianReachPx: median(profile.strokes.filter(([d]) => d >= 100).map(([d]) => d)),
		fitts: fitFitts(profile.strokes),
		mix: mixOf(profile),
		updatedAt: profile.updatedAt,
	};
}

let applyTimer: ReturnType<typeof setInterval> | null = null;

// Applies the learned profile to the planner (or clears it).
function apply(useProfile: boolean) {
	setLearned(useProfile ? derive(profile) : null);
}

// ── Persistence ─────────────────────────────────────────────────────────────

async function loadProfile() {
	try {
		const file = Bun.file(PROFILE_PATH);
		if (!(await file.exists())) return;
		const data = (await file.json()) as Partial<Profile>;
		if (data?.version !== 1 || !Array.isArray(data.strokes)) return;
		profile = { ...emptyProfile(), ...data } as Profile;
	} catch {}
}

async function saveProfile() {
	if (!dirty) return;
	dirty = false;
	try {
		await mkdir(SUPPORT_DIR, { recursive: true });
		await Bun.write(PROFILE_PATH, JSON.stringify(profile));
	} catch (err) {
		console.error("Failed to save rhythm profile:", err);
	}
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

async function readLines(stream: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			handleLine(buf.slice(0, nl));
			buf = buf.slice(nl + 1);
			nl = buf.indexOf("\n");
		}
	}
}

export async function initRhythm(enabled: boolean) {
	await loadProfile();
	setRhythmLearning(enabled);
}

export function setRhythmLearning(enabled: boolean) {
	apply(enabled);
	if (enabled && !proc) {
		proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", SAMPLER_JXA], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const current = proc;
		void readLines(current.stdout).catch(() => {});
		void current.exited.then(() => {
			if (proc === current) proc = null;
		});
		saveTimer = setInterval(() => void saveProfile(), 60_000);
		// Re-derive periodically so the planner picks up new samples.
		applyTimer = setInterval(() => {
			apply(true);
			listener(rhythmInfo());
		}, 30_000);
	} else if (!enabled && proc) {
		proc.kill();
		proc = null;
		if (saveTimer) clearInterval(saveTimer);
		if (applyTimer) clearInterval(applyTimer);
		saveTimer = applyTimer = null;
		void saveProfile();
	}
	listener(rhythmInfo());
}

export async function resetRhythm(): Promise<RhythmInfo> {
	profile = emptyProfile();
	lastStrokeEnd = lastScrollEnd = lastActivityEnd = 0;
	dirty = true;
	await saveProfile();
	apply(proc != null);
	const info = rhythmInfo();
	listener(info);
	return info;
}

// Quit path: stop sampling and flush synchronously.
export function stopRhythm() {
	proc?.kill();
	proc = null;
	if (!dirty) return;
	try {
		writeFileSync(PROFILE_PATH, JSON.stringify(profile));
		dirty = false;
	} catch {}
}
