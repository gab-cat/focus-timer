import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../shared/types";
import { sanitizeSettings } from "./settings";

describe("sanitizeSettings", () => {
	test("empty input gives defaults", () => {
		expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	test("pre-1.5 pauseOnCall is replaced by the default call mode", () => {
		// The old switch fired whenever a call app was open, so "off" was a
		// workaround, not a preference about calls.
		expect(sanitizeSettings({ pauseOnCall: true }).callMode).toBe("ask");
		expect(sanitizeSettings({ pauseOnCall: false }).callMode).toBe("ask");
		expect(sanitizeSettings({ callMode: "pause" }).callMode).toBe("pause");
		expect(sanitizeSettings({ callMode: "off" }).callMode).toBe("off");
		expect(sanitizeSettings({ callMode: "nope" }).callMode).toBe("ask");
	});

	test("keeps an existing auto-stop duration", () => {
		const s = sanitizeSettings({ autoStopMs: 2 * 3600_000 });
		expect(s.autoStopMs).toBe(2 * 3600_000);
		expect(s.autoStopTime).toBeNull();
	});

	test("rejects bad durations and caps long ones", () => {
		expect(sanitizeSettings({ autoStopMs: "60" }).autoStopMs).toBeNull();
		expect(sanitizeSettings({ autoStopMs: -5 }).autoStopMs).toBeNull();
		expect(sanitizeSettings({ autoStopMs: 1000 }).autoStopMs).toBeNull();
		expect(sanitizeSettings({ autoStopMs: Number.NaN }).autoStopMs).toBeNull();
		expect(sanitizeSettings({ autoStopMs: 99 * 3600_000 }).autoStopMs).toBe(24 * 3600_000);
	});

	test("a clock time clears the duration", () => {
		const s = sanitizeSettings({ autoStopMs: 3600_000, autoStopTime: "18:30" });
		expect(s.autoStopTime).toBe("18:30");
		expect(s.autoStopMs).toBeNull();
	});

	test("rejects a malformed clock time", () => {
		expect(sanitizeSettings({ autoStopTime: "6pm" }).autoStopTime).toBeNull();
		expect(sanitizeSettings({ autoStopTime: 1830 }).autoStopTime).toBeNull();
	});
});
