// Is any app using the microphone right now? That's our signal for "on a
// call": it covers Zoom, Teams, FaceTime, Slack and browser calls like Meet,
// and it ends when the call does (an app merely being open doesn't count).
//
// Reads CoreAudio directly through bun:ffi. macOS 14.2+ exposes one audio
// object per client process with an "is running input" flag, which is what
// drives the orange microphone dot. Older systems fall back to "is the default
// input device running", which can't name the app. A full scan takes ~8ms.

import { dlopen, FFIType, ptr } from "bun:ffi";
import type { MicSample } from "./calltracker";

const fourcc = (s: string) =>
	((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

const SYSTEM_OBJECT = 1;
const SCOPE_GLOBAL = fourcc("glob");
const PROCESS_LIST = fourcc("prs#"); // kAudioHardwarePropertyProcessObjectList
const PROCESS_PID = fourcc("ppid"); // kAudioProcessPropertyPID
const PROCESS_RUNNING_INPUT = fourcc("piri"); // kAudioProcessPropertyIsRunningInput
const DEFAULT_INPUT = fourcc("dIn "); // kAudioHardwarePropertyDefaultInputDevice
const DEVICE_RUNNING = fourcc("gone"); // kAudioDevicePropertyDeviceIsRunningSomewhere

// System listeners that can hold the mic without a call: Siri, dictation,
// Voice Control, hearing features.
const IGNORED = new Set([
	"corespeechd",
	"assistantd",
	"Siri",
	"SiriNCService",
	"universalaccessd",
	"speechrecognitiond",
	"localspeechrecognition",
	"heard",
	"ControlCenter",
	"PowerChime",
]);

// Recorders that join every call; named only if no call app is found.
const RECORDERS = /^(Granola|Otter|Fathom|Fireflies|tl;dv|Krisp|Rewind|Notion)/i;

// Process names → the app people know.
const APP_NAMES: Array<[RegExp, string]> = [
	[/^zoom\.us|^CptHost|^ZoomPhone/i, "Zoom"],
	[/^Microsoft Teams|^MSTeams|^com\.microsoft\.teams/i, "Microsoft Teams"],
	[/^avconferenced|^FaceTime/i, "FaceTime"],
	[/^callservicesd/i, "a phone call"],
	[/^com\.apple\.WebKit/i, "Safari"],
];

type CoreAudio = {
	size(obj: number, sel: number): number | null;
	read(obj: number, sel: number, size: number): Uint32Array | null;
	procName(pid: number): string;
};

let lib: CoreAudio | null | undefined;

function load(): CoreAudio | null {
	if (lib !== undefined) return lib;
	try {
		const ca = dlopen("/System/Library/Frameworks/CoreAudio.framework/CoreAudio", {
			AudioObjectGetPropertyDataSize: {
				args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
				returns: FFIType.i32,
			},
			AudioObjectGetPropertyData: {
				args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
				returns: FFIType.i32,
			},
		});
		const sys = dlopen("/usr/lib/libSystem.B.dylib", {
			proc_name: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		});
		const addr = new Uint32Array(3);
		const sizeBuf = new Uint32Array(1);
		const nameBuf = new Uint8Array(256);
		const decoder = new TextDecoder();
		const setAddr = (sel: number) => {
			addr[0] = sel;
			addr[1] = SCOPE_GLOBAL;
			addr[2] = 0;
		};
		lib = {
			size(obj, sel) {
				setAddr(sel);
				const err = ca.symbols.AudioObjectGetPropertyDataSize(obj, ptr(addr), 0, null, ptr(sizeBuf));
				return err === 0 ? sizeBuf[0] : null;
			},
			read(obj, sel, size) {
				if (size === 0) return new Uint32Array(0);
				const out = new Uint32Array(Math.ceil(size / 4));
				setAddr(sel);
				sizeBuf[0] = size;
				const err = ca.symbols.AudioObjectGetPropertyData(obj, ptr(addr), 0, null, ptr(sizeBuf), ptr(out));
				return err === 0 ? out.subarray(0, sizeBuf[0] / 4) : null;
			},
			procName(pid) {
				const n = sys.symbols.proc_name(pid, ptr(nameBuf), nameBuf.length);
				return n > 0 ? decoder.decode(nameBuf.subarray(0, n)) : "";
			},
		};
	} catch (err) {
		console.error("Microphone check unavailable:", err);
		lib = null;
	}
	return lib;
}

function u32(ca: CoreAudio, obj: number, sel: number): number | null {
	return ca.read(obj, sel, 4)?.[0] ?? null;
}

// "Google Chrome Helper (Renderer)" → "Google Chrome"
export function appLabel(proc: string): string {
	for (const [re, name] of APP_NAMES) if (re.test(proc)) return name;
	return proc.replace(/\s+(Helper|ModuleHost|WebView Helper|Networking)\b.*$/i, "").trim() || proc;
}

export function pickCallApp(names: string[]): string | null {
	const labels = names.map(appLabel);
	return labels.find((n) => !RECORDERS.test(n)) ?? labels[0] ?? null;
}

let processListSupported = true;

export function sampleMic(): MicSample {
	const ca = load();
	if (!ca) return { inUse: false, app: null };

	if (processListSupported) {
		const size = ca.size(SYSTEM_OBJECT, PROCESS_LIST);
		const procs = size == null ? null : ca.read(SYSTEM_OBJECT, PROCESS_LIST, size);
		if (procs) {
			const names: string[] = [];
			for (const obj of procs) {
				if (!u32(ca, obj, PROCESS_RUNNING_INPUT)) continue;
				const pid = u32(ca, obj, PROCESS_PID);
				if (pid == null || pid === process.pid) continue;
				const name = ca.procName(pid);
				if (IGNORED.has(name)) continue;
				names.push(name);
			}
			return { inUse: names.length > 0, app: pickCallApp(names) };
		}
		// Pre-14.2: no per-process objects.
		processListSupported = false;
	}

	const device = u32(ca, SYSTEM_OBJECT, DEFAULT_INPUT);
	if (!device) return { inUse: false, app: null };
	return { inUse: u32(ca, device, DEVICE_RUNNING) === 1, app: null };
}
