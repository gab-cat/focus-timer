import { describe, expect, test } from "bun:test";
import { CALL_END_MS, CALL_START_MS, CallTracker } from "./calltracker";

const on = { inUse: true, app: "Zoom" };
const off = { inUse: false, app: null };

describe("CallTracker", () => {
	test("starts only after the mic has been in use for CALL_START_MS", () => {
		const t = new CallTracker();
		expect(t.update(0, on)).toBeNull();
		expect(t.update(CALL_START_MS - 1, on)).toBeNull();
		expect(t.update(CALL_START_MS, on)).toBe("start");
		expect(t.onCall).toBe(true);
		expect(t.app).toBe("Zoom");
		expect(t.update(CALL_START_MS + 5000, on)).toBeNull();
	});

	test("short mic use (dictation) never starts a call", () => {
		const t = new CallTracker();
		t.update(0, on);
		t.update(5000, on);
		expect(t.update(8000, off)).toBeNull();
		expect(t.update(12_000, on)).toBeNull();
		expect(t.onCall).toBe(false);
	});

	test("ends only after CALL_END_MS of quiet, and a blip resets the wait", () => {
		const t = new CallTracker();
		t.update(0, on);
		t.update(CALL_START_MS, on);
		const s = CALL_START_MS;
		expect(t.update(s + 1000, off)).toBeNull();
		expect(t.update(s + 20_000, on)).toBeNull(); // rejoined
		expect(t.update(s + 21_000, off)).toBeNull();
		expect(t.update(s + 21_000 + CALL_END_MS - 1, off)).toBeNull();
		expect(t.update(s + 21_000 + CALL_END_MS, off)).toBe("end");
		expect(t.onCall).toBe(false);
		expect(t.app).toBeNull();
	});

	test("adopt marks an existing call without a start event", () => {
		const t = new CallTracker();
		t.adopt("Teams");
		expect(t.update(0, on)).toBeNull();
		expect(t.update(CALL_START_MS * 3, on)).toBeNull();
		t.update(100_000, off);
		expect(t.update(100_000 + CALL_END_MS, off)).toBe("end");
	});

	test("keeps the last known app name when a sample has none", () => {
		const t = new CallTracker();
		t.update(0, on);
		t.update(CALL_START_MS, { inUse: true, app: null });
		expect(t.app).toBe("Zoom");
	});
});
