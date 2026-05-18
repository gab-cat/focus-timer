import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { Subprocess } from "bun";
import type { JigglerRPC, JigglerStatus } from "../shared/types";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const MIN_DELAY_MS = 90 * 1000;
const MAX_DELAY_MS = 180 * 1000;

let caffeinate: Subprocess | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindow: BrowserWindow | null = null;

const status: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	actionCount: 0,
};

function pushStatus() {
	const rpc = mainWindow?.webview.rpc as
		| { send: { statusChanged: (s: JigglerStatus) => void } }
		| undefined;
	rpc?.send.statusChanged({ ...status });
}

function randomDelay() {
	return Math.floor(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

async function runShell(cmd: string[]) {
	const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
	await proc.exited;
}

// Move the cursor with a few small human-ish eased steps, then press Cmd+Tab twice.
async function performJiggle() {
	const dx = Math.floor(Math.random() * 20) - 10;
	const dy = Math.floor(Math.random() * 20) - 10;
	const steps = 6 + Math.floor(Math.random() * 4);

	// JXA bridges to CoreGraphics — kCGHIDEventTap = 0, kCGEventMouseMoved = 5
	const jxa = `
ObjC.import("CoreGraphics");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
var sx = loc.x, sy = loc.y;
var tx = sx + ${dx};
var ty = sy + ${dy};
var steps = ${steps};
for (var i = 1; i <= steps; i++) {
  var t = i / steps;
  var ease = t * t * (3 - 2 * t);
  var x = sx + (tx - sx) * ease;
  var y = sy + (ty - sy) * ease;
  var ev = $.CGEventCreateMouseEvent($(), 5, {x: x, y: y}, 0);
  $.CGEventPost(0, ev);
  delay(0.02 + Math.random() * 0.03);
}
`;
	await runShell(["osascript", "-l", "JavaScript", "-e", jxa]);

	await runShell([
		"osascript",
		"-e",
		'tell application "System Events" to key code 48 using command down',
	]);
	await new Promise((r) => setTimeout(r, 1000));
	await runShell([
		"osascript",
		"-e",
		'tell application "System Events" to key code 48 using command down',
	]);

	status.actionCount += 1;
	status.lastActionAt = Date.now();
}

function scheduleNext() {
	if (nextTimer) clearTimeout(nextTimer);
	const delay = randomDelay();
	status.nextActionAt = Date.now() + delay;
	pushStatus();
	nextTimer = setTimeout(async () => {
		if (!status.enabled) return;
		try {
			await performJiggle();
		} catch (err) {
			console.error("Jiggle failed:", err);
		}
		if (status.enabled) scheduleNext();
	}, delay);
}

function startCaffeinate() {
	if (caffeinate) return;
	caffeinate = Bun.spawn(["caffeinate", "-dimsu"], {
		stdout: "ignore",
		stderr: "ignore",
	});
}

function stopCaffeinate() {
	caffeinate?.kill();
	caffeinate = null;
}

function setEnabled(enabled: boolean): JigglerStatus {
	if (enabled === status.enabled) return { ...status };
	status.enabled = enabled;
	if (enabled) {
		startCaffeinate();
		scheduleNext();
	} else {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = null;
		status.nextActionAt = null;
		stopCaffeinate();
		pushStatus();
	}
	return { ...status };
}

async function triggerNow(): Promise<JigglerStatus> {
	try {
		await performJiggle();
	} catch (err) {
		console.error("Manual jiggle failed:", err);
	}
	if (status.enabled) scheduleNext();
	else pushStatus();
	return { ...status };
}

const rpc = BrowserView.defineRPC<JigglerRPC>({
	handlers: {
		requests: {
			setEnabled: ({ enabled }) => setEnabled(enabled),
			getStatus: () => ({ ...status }),
			triggerNow: () => triggerNow(),
		},
		messages: {},
	},
});

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

mainWindow = new BrowserWindow({
	title: "Focus Timer",
	url,
	rpc,
	frame: {
		width: 380,
		height: 460,
		x: 200,
		y: 200,
	},
	styleMask: {
		Titled: true,
		Closable: true,
		Resizable: false,
		Miniaturizable: true,
		Borderless: false,
		FullSizeContentView: false,
		FullScreen: false,
		UnifiedTitleAndToolbar: false,
		UtilityWindow: false,
	},
});

process.on("exit", () => stopCaffeinate());

console.log("Focus Timer started");
