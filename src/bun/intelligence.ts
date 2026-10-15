// Apple Intelligence through native/ai-helper, a small Swift process wrapping
// Apple's on-device Foundation Models. It's spawned on first use and kept
// alive so the model stays warm; requests and replies are one JSON object per
// line over its stdin/stdout. Needs Apple Silicon, macOS 26+ and Apple
// Intelligence turned on; otherwise the helper reports why and the planner
// stays hidden.

import { PATHS } from "electrobun/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type {
	IntelligenceInfo,
	IntelligenceReason,
	PlanResult,
	SessionPlan,
} from "../shared/types";
import { nextMeeting } from "./calendar";

const HELPER_PATH = join(PATHS.RESOURCES_FOLDER, "app", "native", "ai-helper");

const AVAILABILITY_TIMEOUT_MS = 5_000;
const PLAN_TIMEOUT_MS = 30_000;
const INFO_TTL_MS = 30_000;
// After this many exits in a minute, stop respawning for a while.
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;
// Plans end this long before the next meeting, and never get shorter than
// the minimum just to fit one in.
const MEETING_BUFFER_MIN = 2;
const MIN_PLAN_MIN = 5;
const MAX_INPUT_CHARS = 400;

type Reply<T> = { id: number; ok: true; result: T } | { id: number; ok: false; error: string };

type Pending = {
	resolve: (reply: Reply<unknown>) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type Helper = {
	child: Subprocess<"pipe", "pipe", "ignore">;
	pending: Map<number, Pending>;
	// Set when we stopped it on purpose, so it doesn't count as a crash.
	stopped: boolean;
};

let helper: Helper | null = null;
let nextId = 1;
let exits: number[] = [];
let cooldownUntil = 0;
let info: IntelligenceInfo | null = null;
let infoAt = 0;
let inflight: Promise<IntelligenceInfo> | null = null;

function spawnHelper(): Helper {
	if (helper) return helper;
	if (Date.now() < cooldownUntil) throw new Error("ai-helper is cooling down after repeated exits");
	if (!existsSync(HELPER_PATH)) throw new Error(`ai-helper missing at ${HELPER_PATH}`);
	const child = Bun.spawn([HELPER_PATH], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
	const h: Helper = { child, pending: new Map(), stopped: false };
	helper = h;
	void readReplies(h);
	void child.exited.then(() => {
		if (helper === h) helper = null;
		for (const p of h.pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error("ai-helper exited"));
		}
		h.pending.clear();
		if (h.stopped) return;
		const now = Date.now();
		exits = [...exits.filter((t) => now - t < CRASH_WINDOW_MS), now];
		if (exits.length >= MAX_CRASHES) {
			cooldownUntil = now + COOLDOWN_MS;
			exits = [];
		}
	});
	return h;
}

async function readReplies(h: Helper) {
	const decoder = new TextDecoder();
	const reader = h.child.stdout.getReader();
	let buf = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let nl = buf.indexOf("\n");
			while (nl >= 0) {
				onReply(h, buf.slice(0, nl));
				buf = buf.slice(nl + 1);
				nl = buf.indexOf("\n");
			}
		}
	} catch {
		// Stream closed; the exit handler rejects whatever is left.
	}
}

function onReply(h: Helper, line: string) {
	let reply: Reply<unknown>;
	try {
		reply = JSON.parse(line);
	} catch {
		return;
	}
	const p = h.pending.get(reply.id);
	if (!p) return;
	h.pending.delete(reply.id);
	clearTimeout(p.timer);
	p.resolve(reply);
}

// failed: counts toward the crash cooldown (a hung request), unlike a
// deliberate stop.
function kill(h: Helper, failed = false) {
	if (helper === h) helper = null;
	h.stopped = !failed;
	h.child.kill();
}

function request<T>(body: Record<string, unknown>, timeoutMs: number): Promise<Reply<T>> {
	let h: Helper;
	try {
		h = spawnHelper();
	} catch (err) {
		return Promise.reject(err);
	}
	const id = nextId++;
	return new Promise<Reply<T>>((resolve, reject) => {
		const timer = setTimeout(() => {
			h.pending.delete(id);
			reject(new Error("ai-helper timed out"));
			// A stuck model call: start over with a fresh helper next time.
			kill(h, true);
		}, timeoutMs);
		h.pending.set(id, { resolve: resolve as Pending["resolve"], reject, timer });
		try {
			h.child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
			h.child.stdin.flush();
		} catch (err) {
			h.pending.delete(id);
			clearTimeout(timer);
			reject(err as Error);
		}
	});
}

async function queryInfo(): Promise<IntelligenceInfo> {
	let next: IntelligenceInfo;
	try {
		const reply = await request<{ available: boolean; reason?: IntelligenceReason }>(
			{ type: "availability" },
			AVAILABILITY_TIMEOUT_MS,
		);
		next =
			reply.ok && reply.result.available
				? { available: true, reason: null }
				: {
						available: false,
						reason: reply.ok ? (reply.result.reason ?? "unavailable") : "helperFailed",
					};
	} catch {
		next = { available: false, reason: "helperFailed" };
	}
	// Nothing to keep warm; the next check respawns it.
	if (!next.available && helper) kill(helper);
	info = next;
	infoAt = Date.now();
	return next;
}

export async function getIntelligenceInfo(): Promise<IntelligenceInfo> {
	if (info && Date.now() - infoAt < INFO_TTL_MS) return info;
	if (!inflight) inflight = queryInfo().finally(() => (inflight = null));
	return inflight;
}

export async function planSession(text: string): Promise<PlanResult> {
	const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
	if (!clean) return { ok: false, error: "Describe what you're working on." };

	const meeting = await nextMeeting().catch(() => null);
	let reply: Reply<Omit<SessionPlan, "endsBefore">>;
	try {
		reply = await request(
			{ type: "planSession", text: clean, nextMeetingAt: meeting?.start ?? null },
			PLAN_TIMEOUT_MS,
		);
	} catch {
		// Re-check availability on the next getIntelligenceInfo.
		info = null;
		return { ok: false, error: "Apple Intelligence didn't respond. Try again." };
	}
	if (!reply.ok) return { ok: false, error: reply.error };

	const { title, steps } = reply.result;
	let minutes = reply.result.minutes;
	let endsBefore: SessionPlan["endsBefore"] = null;
	if (meeting) {
		const free = Math.floor((meeting.start - Date.now()) / 60_000) - MEETING_BUFFER_MIN;
		if (free >= MIN_PLAN_MIN && free < minutes) {
			minutes = free;
			endsBefore = { title: meeting.title, start: meeting.start };
		}
	}
	return { ok: true, plan: { title, minutes, steps, endsBefore } };
}

export function stopIntelligence() {
	if (helper) kill(helper);
}
