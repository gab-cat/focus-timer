export async function runShell(cmd: string[]) {
	const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
	await proc.exited;
}

export async function runShellOutput(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

// Milliseconds since last keyboard / mouse input on macOS.
export async function getIdleMs(): Promise<number> {
	try {
		const out = await runShellOutput([
			"sh",
			"-c",
			"ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'",
		]);
		const ns = Number(out.trim());
		if (!Number.isFinite(ns)) return Number.POSITIVE_INFINITY;
		return ns / 1_000_000;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

type Cached<T> = { value: T; at: number };
const cache = new Map<string, Cached<unknown>>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
	const hit = cache.get(key) as Cached<T> | undefined;
	if (hit && Date.now() - hit.at < ttlMs) return hit.value;
	const value = await fn();
	cache.set(key, { value, at: Date.now() });
	return value;
}

export async function isScreenLocked(): Promise<boolean> {
	return cached("lock", 5_000, async () => {
		try {
			const out = await runShellOutput([
				"sh",
				"-c",
				"ioreg -n Root -d1 | grep CGSSessionScreenIsLocked",
			]);
			return /=\s*Yes/.test(out);
		} catch {
			return false;
		}
	});
}

export async function isOnBattery(): Promise<boolean> {
	return cached("battery", 30_000, async () => {
		try {
			const out = await runShellOutput(["pmset", "-g", "batt"]);
			return /Battery Power/i.test(out);
		} catch {
			return false;
		}
	});
}

// Heuristic call detection — looks for well-known meeting app processes.
// Won't catch browser-based calls (Meet in Chrome) by design.
const CALL_APP_REGEX =
	/zoom\.us|Zoom\.app|Microsoft Teams|Webex|FaceTime|Discord|GoToMeeting|BlueJeans|Slack Helper.*[Cc]all/;

export async function isOnCall(): Promise<boolean> {
	return cached("call", 15_000, async () => {
		try {
			const out = await runShellOutput(["pgrep", "-lf", CALL_APP_REGEX.source]);
			return out.trim().length > 0;
		} catch {
			return false;
		}
	});
}

export async function getSystemAppearance(): Promise<"dark" | "light"> {
	try {
		const out = await runShellOutput([
			"defaults",
			"read",
			"-g",
			"AppleInterfaceStyle",
		]);
		return /dark/i.test(out) ? "dark" : "light";
	} catch {
		return "light";
	}
}

export function invalidateSystemCache() {
	cache.clear();
}
