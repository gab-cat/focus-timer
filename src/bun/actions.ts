import type { ActionType, ScrollStyle } from "../shared/types";
import { adjustForApp, allowsCmdTab, allowsScroll, type AppKind, classifyApp } from "./apps";
import {
	chance,
	dwell,
	getLearned,
	type Op,
	pickWeighted,
	planFlick,
	planMove,
	planRead,
	type Pt,
	rand,
	randInt,
	type Rect,
} from "./humanize";
import { runShell, runShellOutput } from "./system";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reads the cursor, the display it's on, and the frontmost app with its front
// window bounds (CG coordinates, top-left origin). Window bounds come from the
// window list, which doesn't need Screen Recording permission.
const CONTEXT_JXA = `
ObjC.import("CoreGraphics");
ObjC.import("AppKit");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
var screens = $.NSScreen.screens.js;
var primaryH = screens[0].frame.size.height;
var screen = null;
for (var i = 0; i < screens.length; i++) {
  var f = screens[i].frame;
  var r = { x: f.origin.x, y: primaryH - (f.origin.y + f.size.height), w: f.size.width, h: f.size.height };
  if (!screen) screen = r;
  if (loc.x >= r.x && loc.x < r.x + r.w && loc.y >= r.y && loc.y < r.y + r.h) { screen = r; break; }
}
var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
var bundle = null, name = null, win = null;
if (app && !app.isNil()) {
  bundle = app.bundleIdentifier.isNil() ? null : app.bundleIdentifier.js;
  name = app.localizedName.isNil() ? null : app.localizedName.js;
  var pid = app.processIdentifier;
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  for (var j = 0; j < list.length; j++) {
    var w = list[j];
    if (w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width > 120) {
      var b = w.kCGWindowBounds;
      win = { x: b.X, y: b.Y, w: b.Width, h: b.Height };
      break;
    }
  }
}
JSON.stringify({ cursor: { x: loc.x, y: loc.y }, screen: screen, bundle: bundle, name: name, window: win });
`;

// Plays back a list of ops. Bails out as soon as the cursor is somewhere we
// didn't put it — that means the user is back and we should get out of the way.
const EXEC_JXA = `
ObjC.import("CoreGraphics");
function run(argv) {
  var ops = JSON.parse(argv[0]);
  function here() { var l = $.CGEventGetLocation($.CGEventCreate($())); return { x: l.x, y: l.y }; }
  var recent = [here()];
  function userMoved() {
    var c = here();
    for (var i = 0; i < recent.length; i++) {
      if (Math.abs(c.x - recent[i].x) <= 6 && Math.abs(c.y - recent[i].y) <= 6) return false;
    }
    return true;
  }
  function done(interrupted) { var e = here(); return JSON.stringify({ interrupted: interrupted, x: e.x, y: e.y }); }
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    if (op.t === "wait") {
      var left = op.dt;
      while (left > 0) {
        var chunk = Math.min(250, left);
        delay(chunk / 1000);
        left -= chunk;
        if (userMoved()) return done(true);
      }
      continue;
    }
    if (op.dt > 0) delay(op.dt / 1000);
    if (userMoved()) return done(true);
    if (op.t === "move") {
      $.CGEventPost(0, $.CGEventCreateMouseEvent($(), 5, { x: op.x, y: op.y }, 0));
      recent.push({ x: op.x, y: op.y });
      if (recent.length > 4) recent.shift();
    } else if (op.t === "scroll") {
      var ev = $.CGEventCreateScrollWheelEvent($(), 0, 1, op.dy);
      if (op.phase !== undefined || op.momentum !== undefined) {
        $.CGEventSetIntegerValueField(ev, 88, 1);
        $.CGEventSetIntegerValueField(ev, 99, op.phase || 0);
        $.CGEventSetIntegerValueField(ev, 123, op.momentum || 0);
      }
      $.CGEventPost(0, ev);
    }
  }
  return done(false);
}
`;

export type RunOptions = {
	type: ActionType;
	appAware: boolean;
	scrollStyle: ScrollStyle;
};

type Ctx = {
	screen: Rect;
	// Where moves are planned: the front window when app-aware, else screen.
	bounds: Rect;
	at: Pt;
	app: string | null;
	kind: AppKind;
	interrupted: boolean;
	opts: RunOptions;
};

const FALLBACK_SCREEN: Rect = { x: 0, y: 0, w: 1440, h: 900 };

function intersect(a: Rect, b: Rect): Rect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const w = Math.min(a.x + a.w, b.x + b.w) - x;
	const h = Math.min(a.y + a.h, b.y + b.h) - y;
	return w > 0 && h > 0 ? { x, y, w, h } : null;
}

async function readContext(ctx: Ctx | null, opts: RunOptions): Promise<Ctx> {
	const next: Ctx = ctx ?? {
		screen: FALLBACK_SCREEN,
		bounds: FALLBACK_SCREEN,
		at: { x: 400, y: 400 },
		app: null,
		kind: "other",
		interrupted: false,
		opts,
	};
	try {
		const out = await runShellOutput(["osascript", "-l", "JavaScript", "-e", CONTEXT_JXA]);
		const parsed = JSON.parse(out) as {
			cursor: Pt;
			screen: Rect | null;
			bundle: string | null;
			name: string | null;
			window: Rect | null;
		};
		next.at = parsed.cursor;
		next.screen = parsed.screen ?? FALLBACK_SCREEN;
		next.app = parsed.name;
		next.kind = opts.appAware ? classifyApp(parsed.bundle) : "other";
		next.bounds = next.screen;
		if (opts.appAware && parsed.window && next.kind !== "self") {
			// Inset past the title bar / toolbar so we hover content, not chrome.
			const inset = { ...parsed.window, y: parsed.window.y + 52, h: parsed.window.h - 52 };
			const area = intersect(inset, next.screen);
			if (area && area.w >= 240 && area.h >= 180) next.bounds = area;
		}
	} catch {
		// Keep whatever we had; fall back to sane defaults on first read.
	}
	return next;
}

// Runs ops; returns false (and flags ctx) if the user took over mid-way.
async function play(ctx: Ctx, ops: Op[]): Promise<boolean> {
	if (ctx.interrupted) return false;
	if (ops.length === 0) return true;
	const rounded = ops.map((op) =>
		op.t === "move"
			? { ...op, x: Math.round(op.x * 10) / 10, y: Math.round(op.y * 10) / 10, dt: Math.round(op.dt) }
			: { ...op, dt: Math.round(op.dt) },
	);
	try {
		const out = await runShellOutput([
			"osascript",
			"-l",
			"JavaScript",
			"-e",
			EXEC_JXA,
			JSON.stringify(rounded),
		]);
		const res = JSON.parse(out) as { interrupted: boolean; x: number; y: number };
		ctx.at = { x: res.x, y: res.y };
		if (res.interrupted) ctx.interrupted = true;
	} catch {
		// osascript failed (permissions, parse error) — treat as done.
	}
	return !ctx.interrupted;
}

const pause = (ctx: Ctx, lo: number, hi: number) => play(ctx, [{ t: "wait", dt: dwell(lo, hi) }]);

async function move(ctx: Ctx, size: "nudge" | "reach") {
	const plan = planMove(ctx.at, ctx.bounds, size);
	return play(ctx, plan.ops);
}

// Running total of synthesized scroll so reading drifts back toward where it
// started instead of marching every document to the bottom.
let netScroll = 0;

async function read(ctx: Ctx, flicks?: number) {
	if (!allowsScroll(ctx.kind)) return move(ctx, "nudge");
	const plan = planRead(netScroll, flicks, ctx.opts.scrollStyle);
	netScroll += plan.net;
	return play(ctx, plan.ops);
}

async function tapShift() {
	const code = chance(0.7) ? 56 : 60; // left / right shift
	await runShell([
		"osascript",
		"-e",
		`tell application "System Events" to key code ${code}`,
	]);
}

// Hold ⌘ and tap Tab `depth` times — depth 1 flips to the previous app,
// depth 2 goes one further back. Releases ⌘ even if the script errors.
async function cmdTab(depth: 1 | 2) {
	const taps = Array.from({ length: depth }, (_, i) =>
		i === 0 ? "key code 48" : `delay ${rand(0.25, 0.45).toFixed(2)}\n\t\tkey code 48`,
	).join("\n\t\t");
	const script = `
tell application "System Events"
	try
		key down command
		delay ${rand(0.04, 0.09).toFixed(2)}
		${taps}
		delay ${rand(0.1, 0.25).toFixed(2)}
		key up command
	on error
		key up command
	end try
end tell`;
	await runShell(["osascript", "-e", script]);
}

// ── Natural mode ────────────────────────────────────────────────────────────

type Routine = "nudge" | "reach" | "read" | "glance" | "fidget" | "browse";

const BASE_WEIGHTS: Record<Routine, number> = {
	nudge: 22,
	reach: 18,
	read: 26,
	glance: 12,
	fidget: 10,
	browse: 12,
};

// Each session gets its own slightly different mix, so no two sessions share
// the same fingerprint.
let persona: Record<Routine, number> = { ...BASE_WEIGHTS };
const recentRoutines: Routine[] = [];

export function resetPersona() {
	persona = { ...BASE_WEIGHTS };
	for (const key of Object.keys(persona) as Routine[]) {
		persona[key] = BASE_WEIGHTS[key] * rand(0.6, 1.5);
	}
	recentRoutines.length = 0;
}

// Typical share of input by kind; a learned mix scales routines relative to it.
const TYPICAL_MIX = { mouse: 0.5, scroll: 0.3, keys: 0.2 };

function learnedMultipliers(): Partial<Record<Routine, number>> {
	const mix = getLearned()?.mix;
	if (!mix) return {};
	const m = (k: keyof typeof TYPICAL_MIX) =>
		Math.min(2, Math.max(0.5, mix[k] / TYPICAL_MIX[k]));
	return {
		nudge: m("mouse"),
		reach: m("mouse"),
		read: m("scroll"),
		browse: (m("scroll") + m("mouse")) / 2,
		fidget: m("keys"),
	};
}

function nextRoutine(kind: AppKind): Routine {
	let weights = { ...persona };
	for (const [key, mult] of Object.entries(learnedMultipliers())) {
		weights[key as Routine] *= mult as number;
	}
	weights = adjustForApp(weights, kind);
	// Never the same routine twice in a row; damp the one before that too.
	if (recentRoutines[0]) weights[recentRoutines[0]] = 0;
	if (recentRoutines[1]) weights[recentRoutines[1]] *= 0.5;
	const pick = pickWeighted(weights);
	recentRoutines.unshift(pick);
	recentRoutines.length = Math.min(recentRoutines.length, 2);
	return pick;
}

const ROUTINES: Record<Routine, (ctx: Ctx) => Promise<unknown>> = {
	// Hand bumps the mouse.
	nudge: async (ctx) => {
		await move(ctx, "nudge");
	},
	// Reach across the window, hover, maybe adjust.
	reach: async (ctx) => {
		if (!(await move(ctx, "reach"))) return;
		if (!(await pause(ctx, 300, 2000))) return;
		if (chance(0.5)) await move(ctx, "nudge");
	},
	// Read a page: a few scrolls with pauses in between.
	read: async (ctx) => {
		if (chance(0.5) && !(await move(ctx, "nudge"))) return;
		await read(ctx);
	},
	// Peek at another app, poke around, come back.
	glance: async (ctx) => {
		if (!allowsCmdTab(ctx.kind)) return move(ctx, "nudge");
		await cmdTab(chance(0.8) ? 1 : 2);
		await sleep(rand(600, 1500));
		// We're in a different app now — re-read what's in front.
		await readContext(ctx, ctx.opts);
		if (chance(0.6) && allowsScroll(ctx.kind)) {
			if (!(await read(ctx, randInt(1, 2)))) return;
		} else if (!(await move(ctx, chance(0.5) ? "nudge" : "reach"))) return;
		if (!(await pause(ctx, 800, 4000))) return;
		await cmdTab(1);
	},
	// Shift tap and a tiny wiggle.
	fidget: async (ctx) => {
		await tapShift();
		if (!(await pause(ctx, 300, 1200))) return;
		if (chance(0.6)) await move(ctx, "nudge");
	},
	// Reach for something, read it, settle.
	browse: async (ctx) => {
		if (!(await move(ctx, "reach"))) return;
		if (!(await pause(ctx, 400, 1500))) return;
		if (!(await read(ctx, randInt(1, 3)))) return;
		await move(ctx, "nudge");
	},
};

// ── Single-action modes ─────────────────────────────────────────────────────

const TAB_COUNT_CHOICES = [1, 2, 3, 4, 5, 6] as const;

async function actionCmdTab(ctx: Ctx) {
	await move(ctx, "nudge");
	const tabCount = TAB_COUNT_CHOICES[Math.floor(Math.random() * TAB_COUNT_CHOICES.length)];
	for (let i = 0; i < tabCount; i++) {
		await runShell([
			"osascript",
			"-e",
			'tell application "System Events" to key code 48 using command down',
		]);
		if (i < tabCount - 1) {
			await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
		}
	}
}

async function actionMouseOnly(ctx: Ctx) {
	await move(ctx, chance(0.7) ? "nudge" : "reach");
}

// One flick down and a mirrored flick back up — net zero scroll.
async function actionScroll(ctx: Ctx) {
	const down = planFlick(-1, rand(0.5, 1), ctx.opts.scrollStyle);
	const up: Op[] = down.ops.map((op) => (op.t === "scroll" ? { ...op, dy: -op.dy } : op));
	await play(ctx, [...down.ops, { t: "wait", dt: rand(400, 1500) }, ...up]);
}

export type ActionResult = { routine: string; interrupted: boolean; app: string | null };

export async function runAction(opts: RunOptions): Promise<ActionResult> {
	const ctx = await readContext(null, opts);
	const app = ctx.app;
	let routine: string = opts.type;
	switch (opts.type) {
		case "natural": {
			const pick = nextRoutine(ctx.kind);
			routine = pick;
			await ROUTINES[pick](ctx);
			break;
		}
		case "mouse":
			await actionMouseOnly(ctx);
			break;
		case "scroll":
			await actionScroll(ctx);
			break;
		case "shift":
			await tapShift();
			break;
		case "cmdtab":
		default:
			await actionCmdTab(ctx);
	}
	return { routine, interrupted: ctx.interrupted, app };
}

export const ACTION_LABELS: Record<ActionType, string> = {
	natural: "Natural (mixed)",
	cmdtab: "Cmd+Tab",
	mouse: "Mouse only",
	scroll: "Scroll wheel",
	shift: "Shift tap",
};
