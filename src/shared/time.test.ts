import { describe, expect, test } from "bun:test";
import { atLabel, autoStopMode, isClockTime, nextClockTime, plannedStopAt, suggestClockTime } from "./time";

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
	new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe("isClockTime", () => {
	test("accepts 24h HH:MM only", () => {
		expect(isClockTime("00:00")).toBe(true);
		expect(isClockTime("18:30")).toBe(true);
		expect(isClockTime("23:59")).toBe(true);
		expect(isClockTime("24:00")).toBe(false);
		expect(isClockTime("9:00")).toBe(false);
		expect(isClockTime("18:60")).toBe(false);
		expect(isClockTime(1800)).toBe(false);
		expect(isClockTime(null)).toBe(false);
	});
});

describe("autoStopMode", () => {
	test("clock time wins, then duration, then off", () => {
		expect(autoStopMode({ autoStopMs: 60_000, autoStopTime: "18:00" })).toBe("at");
		expect(autoStopMode({ autoStopMs: 60_000, autoStopTime: null })).toBe("after");
		expect(autoStopMode({ autoStopMs: null, autoStopTime: null })).toBe("off");
		expect(autoStopMode({ autoStopMs: 0, autoStopTime: "bad" })).toBe("off");
	});
});

describe("nextClockTime", () => {
	test("later today", () => {
		expect(nextClockTime("18:00", at(2026, 11, 10, 9, 15))).toBe(at(2026, 11, 10, 18, 0));
	});
	test("already passed rolls to tomorrow", () => {
		expect(nextClockTime("08:00", at(2026, 11, 10, 9, 15))).toBe(at(2026, 11, 11, 8, 0));
	});
	test("exactly now rolls to tomorrow", () => {
		expect(nextClockTime("09:15", at(2026, 11, 10, 9, 15))).toBe(at(2026, 11, 11, 9, 15));
	});
	test("crosses month and year ends", () => {
		expect(nextClockTime("01:00", at(2026, 12, 31, 23, 0))).toBe(at(2027, 1, 1, 1, 0));
	});
	test("rejects bad input", () => {
		expect(Number.isNaN(nextClockTime("25:00", Date.now()))).toBe(true);
	});
});

describe("plannedStopAt", () => {
	const from = at(2026, 11, 10, 14, 0);
	test("after a duration", () => {
		expect(plannedStopAt({ autoStopMs: 90 * 60_000, autoStopTime: null }, from)).toBe(at(2026, 11, 10, 15, 30));
	});
	test("caps the duration at 24h", () => {
		expect(plannedStopAt({ autoStopMs: 48 * 3600_000, autoStopTime: null }, from)).toBe(from + 24 * 3600_000);
	});
	test("at a clock time", () => {
		expect(plannedStopAt({ autoStopMs: null, autoStopTime: "17:45" }, from)).toBe(at(2026, 11, 10, 17, 45));
	});
	test("off", () => {
		expect(plannedStopAt({ autoStopMs: null, autoStopTime: null }, from)).toBeNull();
	});
});

describe("suggestClockTime", () => {
	test("rounds an hour ahead up to the half hour", () => {
		expect(suggestClockTime(at(2026, 11, 10, 14, 10))).toBe("15:30");
		expect(suggestClockTime(at(2026, 11, 10, 14, 40))).toBe("16:00");
		expect(suggestClockTime(at(2026, 11, 10, 14, 0))).toBe("15:00");
		expect(suggestClockTime(at(2026, 11, 10, 23, 45))).toBe("01:00");
	});
});

describe("DST", () => {
	test("lands on the requested wall time the day the clocks change", () => {
		// US clocks fall back on 1 Nov 2026, EU on 25 Oct 2026. Either way the
		// result must read 09:00 on the local clock.
		for (const day of [at(2026, 10, 24, 22, 0), at(2026, 10, 31, 22, 0)]) {
			const d = new Date(nextClockTime("09:00", day));
			expect([d.getHours(), d.getMinutes()]).toEqual([9, 0]);
		}
	});
});

describe("atLabel", () => {
	const now = at(2026, 11, 10, 14, 0);
	test("today, tomorrow, later", () => {
		expect(atLabel(at(2026, 11, 10, 18, 0), now)).toMatch(/^at 6:00/);
		expect(atLabel(at(2026, 11, 11, 8, 0), now)).toMatch(/^tomorrow at 8:00/);
		expect(atLabel(at(2026, 11, 12, 8, 0), now)).toMatch(/^\S+ at 8:00/);
	});
});
