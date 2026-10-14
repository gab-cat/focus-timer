// Meeting detection via EventKit, driven from JXA so no native helper is
// needed. Reads every calendar synced to macOS Calendar (iCloud, Google,
// Exchange…). Requires the NSCalendars*UsageDescription keys that
// scripts/post-build-plist.ts adds to Info.plist.

import type { CalendarAccess, CalendarInfo } from "../shared/types";
import { runShell, runShellOutput } from "./system";

const CALENDAR_JXA = `
ObjC.import("EventKit");
ObjC.import("Foundation");
function run(argv) {
  var mode = argv[0];
  var store = $.EKEventStore.alloc.init;
  if (mode === "request") {
    var done = false;
    var cb = function () { done = true; };
    if (store.respondsToSelector("requestFullAccessToEventsWithCompletion:")) {
      store.requestFullAccessToEventsWithCompletion(cb);
    } else {
      store.requestAccessToEntityTypeCompletion(0, cb);
    }
    var until = $.NSDate.dateWithTimeIntervalSinceNow(180);
    while (!done && $.NSDate.date.compare(until) < 0) {
      $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
  }
  var status = Number($.EKEventStore.authorizationStatusForEntityType(0));
  var events = [];
  if (mode === "events" && status === 3) {
    var start = $.NSDate.dateWithTimeIntervalSinceNow(-6 * 3600);
    var end = $.NSDate.dateWithTimeIntervalSinceNow(18 * 3600);
    var pred = store.predicateForEventsWithStartDateEndDateCalendars(start, end, $());
    var found = store.eventsMatchingPredicate(pred);
    var linkRe = /zoom\\.us|meet\\.google|teams\\.(microsoft|live)|webex|whereby|around\\.co|gotomeeting|chime\\.aws|bluejeans|facetime|slack\\.com\\/huddle/i;
    for (var i = 0; i < found.count; i++) {
      var e = found.objectAtIndex(i);
      if (e.allDay) continue;
      if (Number(e.availability) === 1) continue; // free
      if (Number(e.status) === 3) continue; // canceled
      var others = 0, declined = false;
      var atts = e.attendees;
      if (atts && !atts.isNil()) {
        for (var j = 0; j < atts.count; j++) {
          var a = atts.objectAtIndex(j);
          if (a.isCurrentUser) {
            if (Number(a.participantStatus) === 3) declined = true;
          } else {
            others++;
          }
        }
      }
      if (declined) continue;
      var text = "";
      if (e.location && !e.location.isNil()) text += e.location.js + " ";
      if (e.notes && !e.notes.isNil()) text += e.notes.js + " ";
      if (e.URL && !e.URL.isNil()) text += e.URL.absoluteString.js;
      var hasLink = linkRe.test(text);
      // Solo holds ("Focus time") aren't meetings.
      if (others === 0 && !hasLink) continue;
      events.push({
        title: e.title && !e.title.isNil() ? e.title.js : "Meeting",
        start: Math.round(e.startDate.timeIntervalSince1970 * 1000),
        end: Math.round(e.endDate.timeIntervalSince1970 * 1000)
      });
    }
  }
  return JSON.stringify({ status: status, events: events });
}
`;

type Meeting = { title: string; start: number; end: number };

const ACCESS: Record<number, CalendarAccess> = {
	0: "notDetermined",
	1: "restricted",
	2: "denied",
	3: "granted",
	4: "writeOnly",
};

let access: CalendarAccess = "unknown";
let meetings: Meeting[] = [];
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const REFRESH_MS = 5 * 60_000;

async function query(mode: "status" | "request" | "events") {
	try {
		const out = await runShellOutput(["osascript", "-l", "JavaScript", "-e", CALENDAR_JXA, mode]);
		const parsed = JSON.parse(out) as { status: number; events: Meeting[] };
		access = ACCESS[parsed.status] ?? "unknown";
		if (mode === "events") {
			meetings = parsed.events.sort((a, b) => a.start - b.start);
			fetchedAt = Date.now();
		}
	} catch {
		// Leave the previous state in place.
	}
}

async function refresh(force = false) {
	if (!force && Date.now() - fetchedAt < REFRESH_MS) return;
	if (!inflight) inflight = query("events").finally(() => (inflight = null));
	await inflight;
}

export async function currentMeeting(): Promise<Meeting | null> {
	await refresh();
	if (access !== "granted") return null;
	const now = Date.now();
	return meetings.find((m) => m.start <= now && now < m.end) ?? null;
}

function info(): CalendarInfo {
	const now = Date.now();
	const current = meetings.find((m) => m.start <= now && now < m.end) ?? null;
	const next = meetings.find((m) => m.start > now) ?? null;
	return {
		access,
		current: current ? { title: current.title, end: current.end } : null,
		next: next ? { title: next.title, start: next.start } : null,
	};
}

export async function getCalendarInfo(): Promise<CalendarInfo> {
	await query("status");
	if (access === "granted") await refresh(true);
	return info();
}

export async function requestCalendarAccess(): Promise<CalendarInfo> {
	await query("request");
	if (access === "granted") await refresh(true);
	return info();
}

export async function openCalendarPrivacy() {
	await runShell([
		"open",
		"x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
	]);
}
