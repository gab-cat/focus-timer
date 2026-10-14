// Pure planning helpers for human-like input. Nothing in here touches the
// system — it only produces op lists and delays that actions.ts executes.

import type { ScrollStyle } from "../shared/types";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Op =
	// Wait `dt` ms, then warp the cursor to (x, y).
	| { t: "move"; x: number; y: number; dt: number }
	// Wait `dt` ms, then post a pixel scroll. Positive dy scrolls up.
	// `phase`/`momentum` mark trackpad gesture stages (CGScrollPhase /
	// CGMomentumScrollPhase); omitted for plain wheel scrolls.
	| { t: "scroll"; dy: number; dt: number; phase?: number; momentum?: number }
	// Idle for `dt` ms (checked for user interference while waiting).
	| { t: "wait"; dt: number };

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const chance = (p: number) => Math.random() < p;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Standard normal via Box–Muller.
export function gauss(): number {
	const u = 1 - Math.random();
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pickWeighted<T extends string>(weights: Record<T, number>): T {
	const entries = Object.entries(weights) as Array<[T, number]>;
	const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
	let r = Math.random() * total;
	for (const [key, w] of entries) {
		r -= Math.max(0, w);
		if (r <= 0) return key;
	}
	return entries[entries.length - 1][0];
}

const sample = (xs: number[]) => xs[Math.floor(Math.random() * xs.length)];

// ── Learned rhythm ──────────────────────────────────────────────────────────
// When set (see rhythm.ts), these replace the built-in distributions with ones
// measured from the user's own input.

export type Learned = {
	nudgeDists: number[];
	reachDists: number[];
	// Path length / straight-line distance per stroke.
	ratios: number[];
	fitts: { a: number; b: number } | null;
	movePauses: number[];
	scrollPauses: number[];
	followUpGaps: number[];
	followUp: number | null;
	mix: { mouse: number; scroll: number; keys: number } | null;
};

let learned: Learned | null = null;

export function setLearned(next: Learned | null) {
	learned = next;
}

export function getLearned() {
	return learned;
}

// A pause drawn from the user's own between-move pauses when known.
export function dwell(lo: number, hi: number): number {
	if (learned && learned.movePauses.length >= 20) {
		return clamp(sample(learned.movePauses) * rand(0.85, 1.15), lo, hi * 1.5);
	}
	return rand(lo, hi);
}

// ── Geometry ────────────────────────────────────────────────────────────────

function clampToRect(p: Pt, r: Rect, margin: number): Pt {
	return {
		x: clamp(p.x, r.x + margin, r.x + r.w - margin),
		y: clamp(p.y, r.y + margin, r.y + r.h - margin),
	};
}

function inside(p: Pt, r: Rect, margin: number) {
	return (
		p.x >= r.x + margin &&
		p.x <= r.x + r.w - margin &&
		p.y >= r.y + margin &&
		p.y <= r.y + r.h - margin
	);
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

// Minimum-jerk profile — the bell-shaped velocity curve of real reaching moves.
const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

// Fitts's law: time grows with log of distance. Jittered so equal distances
// don't produce equal durations.
function fittsMs(distance: number) {
	const id = Math.log2(distance / 18 + 1);
	const f = learned?.fitts;
	const base = f ? f.a + f.b * id : 110 + 120 * id;
	return base * rand(0.85, 1.25);
}

// How far a stroke bows. For a shallow arc, path/chord ≈ 1 + 0.96·c², so a
// measured ratio maps straight back to a curvature.
function curvatureFor(size: MoveSize): number {
	if (learned && learned.ratios.length >= 20) {
		const r = sample(learned.ratios);
		return clamp(Math.sqrt(Math.max(0, r - 1) / 0.96), 0, 0.4);
	}
	return size === "nudge" ? rand(0, 0.15) : rand(0.05, 0.25);
}

// One continuous stroke along a gently curved path.
function stroke(from: Pt, to: Pt, durationMs: number, curvature: number): Op[] {
	const d = dist(from, to);
	if (d < 0.5) return [];
	const dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
	const perp = { x: -dir.y, y: dir.x };
	const bend = d * curvature * (chance(0.5) ? -1 : 1);
	const lerp = (t: number, k: number): Pt => ({
		x: from.x + (to.x - from.x) * t + perp.x * bend * k,
		y: from.y + (to.y - from.y) * t + perp.y * bend * k,
	});
	const c1 = lerp(rand(0.2, 0.35), rand(0.6, 1.2));
	const c2 = lerp(rand(0.65, 0.85), rand(0.3, 0.9));
	// ~60–80 Hz sampling, like a real pointer.
	const steps = clamp(Math.round(durationMs / rand(12, 17)), 4, 120);
	// Skew so peak speed lands a little before the midpoint, as in real reaches.
	const skew = rand(0.8, 0.95);
	const tremor = Math.min(0.6, d / 200);
	const ops: Op[] = [];
	for (let i = 1; i <= steps; i++) {
		const s = minJerk(Math.pow(i / steps, skew));
		const p = bezier(from, c1, c2, to, s);
		const jitter = i < steps ? tremor : 0;
		ops.push({
			t: "move",
			x: p.x + gauss() * jitter,
			y: p.y + gauss() * jitter,
			dt: Math.max(4, durationMs / steps + gauss() * 1.5),
		});
	}
	return ops;
}

export type MoveSize = "nudge" | "reach";

function moveDistance(size: MoveSize, bounds: Rect): number {
	const longest = Math.max(160, Math.min(bounds.w, bounds.h) * 0.6);
	if (size === "nudge") {
		if (learned && learned.nudgeDists.length >= 15) {
			return clamp(sample(learned.nudgeDists) * rand(0.85, 1.15), 4, 80);
		}
		return rand(6, 48);
	}
	if (learned && learned.reachDists.length >= 10) {
		return clamp(sample(learned.reachDists) * rand(0.9, 1.1), 90, Math.min(700, longest));
	}
	return rand(120, Math.min(560, longest));
}

// Plans a move within `bounds` — the frontmost window when app-aware, else
// the whole display. A cursor outside the bounds gets pulled into them.
export function planMove(
	from: Pt,
	bounds: Rect,
	size: MoveSize,
): { ops: Op[]; end: Pt } {
	const margin = Math.min(30, bounds.w / 6, bounds.h / 6);
	const distance = moveDistance(size, bounds);

	// Retry a few headings so the target stays inside instead of pinning
	// against an edge.
	let target: Pt = from;
	for (let k = 0; k < 8; k++) {
		const a = rand(0, Math.PI * 2);
		// People sweep horizontally more than vertically.
		target = {
			x: from.x + Math.cos(a) * distance,
			y: from.y + Math.sin(a) * distance * 0.7,
		};
		if (inside(target, bounds, margin)) break;
	}
	target = clampToRect(target, bounds, margin);
	const d = dist(from, target);
	const ops: Op[] = [];

	if (size === "reach" && d > 60 && chance(0.35)) {
		// Overshoot the target slightly, pause, then correct back onto it.
		const dir = { x: (target.x - from.x) / d, y: (target.y - from.y) / d };
		const over = clampToRect(
			{
				x: target.x + dir.x * d * rand(0.03, 0.09) + rand(-4, 4),
				y: target.y + dir.y * d * rand(0.03, 0.09) + rand(-4, 4),
			},
			bounds,
			4,
		);
		ops.push(...stroke(from, over, fittsMs(d), curvatureFor(size)));
		ops.push({ t: "wait", dt: rand(40, 140) });
		ops.push(...stroke(over, target, rand(90, 180), rand(0, 0.1)));
	} else {
		ops.push(...stroke(from, target, fittsMs(d), curvatureFor(size)));
	}

	// Settling micro-adjustments after landing.
	let end = target;
	if (chance(0.4)) {
		for (let k = randInt(1, 3); k > 0; k--) {
			const next = clampToRect(
				{ x: end.x + rand(-2.5, 2.5), y: end.y + rand(-2.5, 2.5) },
				bounds,
				4,
			);
			ops.push({ t: "wait", dt: rand(60, 220) });
			ops.push(...stroke(end, next, rand(30, 70), 0));
			end = next;
		}
	}
	// Curves and tremor can bow past an edge when starting near a corner.
	const bounded = ops.map((op) =>
		op.t === "move" ? { ...op, ...clampToRect(op, bounds, 1) } : op,
	);
	return { ops: bounded, end };
}

// ── Scrolling ───────────────────────────────────────────────────────────────

// CGScrollPhase / CGMomentumScrollPhase values.
const PHASE_BEGAN = 1;
const PHASE_CHANGED = 2;
const PHASE_ENDED = 4;
const MOMENTUM_BEGIN = 1;
const MOMENTUM_CONTINUE = 2;
const MOMENTUM_END = 3;

// A plain wheel gesture: quick ramp-up, then exponentially decaying deltas.
function wheelFlick(direction: 1 | -1, scale: number): { ops: Op[]; net: number } {
	const peak = rand(6, 20) * scale;
	const decay = rand(0.84, 0.92);
	const ops: Op[] = [];
	let net = 0;
	const push = (v: number) => {
		const dy = Math.max(1, Math.round(v)) * direction;
		ops.push({ t: "scroll", dy, dt: rand(12, 18) });
		net += dy;
	};
	push(peak * rand(0.3, 0.5));
	push(peak * rand(0.7, 0.9));
	for (let v = peak; v >= 1; v *= decay) push(v);
	return { ops, net };
}

// A two-finger trackpad swipe, the way macOS reports one: Began, a run of
// Changed while the fingers move, Ended, then a separate momentum phase that
// coasts down to a stop.
function trackpadFlick(direction: 1 | -1, scale: number): { ops: Op[]; net: number } {
	const ops: Op[] = [];
	let net = 0;
	const push = (dy: number, dt: number, phase: number, momentum: number) => {
		const v = Math.round(dy) * direction;
		ops.push({ t: "scroll", dy: v, dt, phase, momentum });
		net += v;
	};
	const peak = rand(7, 22) * scale;
	const fingerSteps = randInt(4, 9);
	let last = 0;
	for (let i = 0; i < fingerSteps; i++) {
		// Fingers accelerate then hold roughly steady.
		const t = (i + 1) / fingerSteps;
		const v = Math.max(1, peak * Math.min(1, t * rand(1.2, 1.8)) + gauss() * 0.8);
		push(v, i === 0 ? 0 : rand(7, 12), i === 0 ? PHASE_BEGAN : PHASE_CHANGED, 0);
		last = v;
	}
	push(0, rand(7, 12), PHASE_ENDED, 0);
	if (chance(0.85)) {
		let v = last * rand(1.0, 1.4);
		const decay = rand(0.9, 0.95);
		push(v, rand(0, 16), 0, MOMENTUM_BEGIN);
		for (v *= decay; v >= 1; v *= decay) push(v, rand(14, 18), 0, MOMENTUM_CONTINUE);
		push(0, rand(14, 18), 0, MOMENTUM_END);
	}
	return { ops, net };
}

export function planFlick(
	direction: 1 | -1,
	scale = 1,
	style: ScrollStyle = "trackpad",
): { ops: Op[]; net: number } {
	return style === "trackpad" ? trackpadFlick(direction, scale) : wheelFlick(direction, scale);
}

function readingPause(): number {
	if (learned && learned.scrollPauses.length >= 10) {
		return clamp(sample(learned.scrollPauses) * rand(0.85, 1.15), 300, 9000);
	}
	return rand(700, 4500);
}

// Reading: a few downward flicks separated by reading pauses, with an
// occasional nudge back up. Biased back toward the start once the page has
// drifted far, so long sessions don't scroll documents to the end.
export function planRead(
	netSoFar: number,
	flicks = randInt(2, 5),
	style: ScrollStyle = "trackpad",
): { ops: Op[]; net: number } {
	const ops: Op[] = [];
	let net = 0;
	for (let i = 0; i < flicks; i++) {
		const drift = netSoFar + net;
		const pDown = drift < -900 ? 0.25 : drift > 300 ? 0.9 : 0.78;
		const dir: 1 | -1 = chance(pDown) ? -1 : 1;
		const flick = planFlick(dir, dir === 1 ? rand(0.4, 0.8) : 1, style);
		ops.push(...flick.ops);
		net += flick.net;
		if (dir === -1 && chance(0.15)) {
			// Scrolled a touch too far — small correction.
			const fix = planFlick(1, rand(0.2, 0.4), style);
			ops.push({ t: "wait", dt: rand(200, 500) }, ...fix.ops);
			net += fix.net;
		}
		if (i < flicks - 1) ops.push({ t: "wait", dt: readingPause() });
	}
	return { ops, net };
}

// ── Timing ──────────────────────────────────────────────────────────────────

// Inter-action delay for natural mode. Human activity is bursty: short
// clusters of input followed by longer gaps, closer to log-normal than
// uniform.
export function naturalDelay(lo: number, hi: number): number {
	const pFollow = learned?.followUp ?? 0.25;
	if (chance(pFollow)) {
		if (learned && learned.followUpGaps.length >= 10) {
			return Math.round(clamp(sample(learned.followUpGaps) * rand(0.85, 1.15), 3_000, 25_000));
		}
		return Math.round(rand(5_000, 20_000));
	}
	const mu = Math.log(Math.sqrt(lo * hi));
	const sigma = Math.max(0.05, Math.log(hi / lo) / 3.3);
	const v = Math.exp(mu + sigma * gauss());
	return Math.round(clamp(v, lo, hi));
}

// Gap between breaks and break length, in ms.
export const breakGapMs = () => Math.round(rand(45, 110) * 60_000);
export const breakLengthMs = () => Math.round((3 + Math.pow(Math.random(), 1.6) * 8) * 60_000);
