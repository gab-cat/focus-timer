// Turns raw "is the microphone in use" samples into call start / end events.
// Debounced both ways, but only briefly: a call just pauses moves, so a late
// pause or resume is what people notice, not a short false one. The start
// wait skips a mic blip; the end wait rides out rejoining or switching rooms.

export const CALL_START_MS = 2_000;
export const CALL_END_MS = 5_000;

export type MicSample = { inUse: boolean; app: string | null };
export type CallEvent = "start" | "end" | null;

export class CallTracker {
	onCall = false;
	app: string | null = null;
	private seenSince: number | null = null;
	private quietSince: number | null = null;

	update(now: number, mic: MicSample): CallEvent {
		if (mic.inUse) {
			this.quietSince = null;
			if (mic.app) this.app = mic.app;
			if (this.onCall) return null;
			this.seenSince ??= now;
			if (now - this.seenSince < CALL_START_MS) return null;
			this.onCall = true;
			return "start";
		}
		this.seenSince = null;
		if (!this.onCall) {
			this.app = null;
			return null;
		}
		this.quietSince ??= now;
		if (now - this.quietSince < CALL_END_MS) return null;
		this.onCall = false;
		this.app = null;
		return "end";
	}

	// How long until a pending start or end could fire, if one is pending.
	// With event-driven mic checks there may be no sample at that moment, so
	// the caller looks again then.
	pendingMs(now: number): number | null {
		if (!this.onCall && this.seenSince != null) return Math.max(0, CALL_START_MS - (now - this.seenSince));
		if (this.onCall && this.quietSince != null) return Math.max(0, CALL_END_MS - (now - this.quietSince));
		return null;
	}

	// Treat a call that's already going as known, without a start event.
	adopt(app: string | null) {
		this.onCall = true;
		this.app = app;
		this.seenSince = null;
		this.quietSince = null;
	}

	reset() {
		this.onCall = false;
		this.app = null;
		this.seenSince = null;
		this.quietSince = null;
	}
}
