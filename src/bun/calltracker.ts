// Turns raw "is the microphone in use" samples into call start / end events.
// Debounced both ways: a few seconds of dictation isn't a call, and a short
// gap (rejoining, switching rooms) doesn't end one.

export const CALL_START_MS = 10_000;
export const CALL_END_MS = 30_000;

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
