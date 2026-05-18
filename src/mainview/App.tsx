import { useEffect, useState } from "react";
import type { AppInfo, JigglerStatus } from "../shared/types";
import {
	applyUpdate,
	checkForUpdate,
	getAppInfo,
	getStatus,
	onAppInfo,
	onStatus,
	setEnabled,
	triggerNow,
} from "./rpc";

const INITIAL_APP_INFO: AppInfo = {
	version: "",
	channel: "",
	updateAvailable: false,
	updateReady: false,
	updatePhase: "idle",
	updateProgress: null,
	availableVersion: null,
	error: null,
};

function mmss(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function relative(ts: number | null) {
	if (!ts) return "never";
	const diff = Math.round((Date.now() - ts) / 1000);
	if (diff < 60) return `${diff}s ago`;
	const m = Math.floor(diff / 60);
	const s = diff % 60;
	return `${m}m ${s}s ago`;
}

function VersionLine({ info }: { info: AppInfo }) {
	const [restarting, setRestarting] = useState(false);
	const [checking, setChecking] = useState(false);

	const channelSuffix =
		info.channel && info.channel !== "stable" ? ` · ${info.channel}` : "";
	const versionText = info.version ? `v${info.version}${channelSuffix}` : "—";

	async function restart() {
		setRestarting(true);
		try {
			await applyUpdate();
		} catch {
			setRestarting(false);
		}
	}

	async function check() {
		setChecking(true);
		try {
			await checkForUpdate();
		} finally {
			setChecking(false);
		}
	}

	let right: React.ReactNode = (
		<button
			onClick={check}
			disabled={checking || info.updatePhase === "checking" || info.updatePhase === "downloading"}
			className="text-[10px] uppercase tracking-[0.18em] text-neutral-600 hover:text-neutral-400 transition-colors disabled:opacity-40"
		>
			{info.updatePhase === "checking"
				? "Checking…"
				: info.updatePhase === "downloading"
				? `Downloading${info.updateProgress != null ? ` ${info.updateProgress}%` : "…"}`
				: "Check for updates"}
		</button>
	);

	if (info.updateReady) {
		right = (
			<button
				onClick={restart}
				disabled={restarting}
				className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-40"
			>
				{restarting ? "Restarting…" : `Restart to install${info.availableVersion ? ` v${info.availableVersion}` : ""}`}
			</button>
		);
	} else if (info.updatePhase === "error" && info.error) {
		right = (
			<button
				onClick={check}
				disabled={checking}
				title={info.error}
				className="text-[10px] uppercase tracking-[0.18em] text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-40"
			>
				Update failed · Retry
			</button>
		);
	}

	return (
		<div className="flex items-center justify-between pt-1">
			<span className="text-[10px] font-mono text-neutral-600">{versionText}</span>
			{right}
		</div>
	);
}

function App() {
	const [status, setStatus] = useState<JigglerStatus>({
		enabled: false,
		lastActionAt: null,
		nextActionAt: null,
		actionCount: 0,
	});
	const [busy, setBusy] = useState(false);
	const [triggering, setTriggering] = useState(false);
	const [appInfo, setAppInfo] = useState<AppInfo>(INITIAL_APP_INFO);
	const [, force] = useState(0);

	useEffect(() => {
		getStatus().then(setStatus).catch(() => {});
		getAppInfo().then(setAppInfo).catch(() => {});
		const offStatus = onStatus(setStatus);
		const offAppInfo = onAppInfo(setAppInfo);
		const tick = setInterval(() => force((n) => n + 1), 1000);
		return () => {
			offStatus();
			offAppInfo();
			clearInterval(tick);
		};
	}, []);

	async function toggle() {
		setBusy(true);
		try {
			setStatus(await setEnabled(!status.enabled));
		} finally {
			setBusy(false);
		}
	}

	async function manual() {
		setTriggering(true);
		try {
			setStatus(await triggerNow());
		} finally {
			setTriggering(false);
		}
	}

	const enabled = status.enabled;
	const countdown =
		enabled && status.nextActionAt ? status.nextActionAt - Date.now() : 0;

	return (
		<div className="h-screen w-screen flex flex-col bg-neutral-950 text-neutral-100 font-sans select-none overflow-hidden">
			<header className="flex items-center justify-between px-6 pt-6">
				<div className="flex items-center gap-2.5">
					<span
						className={`h-2 w-2 rounded-full ${
							enabled ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : "bg-neutral-600"
						}`}
					/>
					<span className="text-sm font-medium tracking-wide uppercase text-neutral-400">
						{enabled ? "Active" : "Idle"}
					</span>
				</div>
				<span className="text-xs font-mono text-neutral-500">
					{status.actionCount} cycles
				</span>
			</header>

			<main className="flex-1 flex flex-col items-center justify-center px-6">
				<div className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
					Focus Timer
				</div>
				<div className="text-[80px] leading-none font-light font-mono tabular-nums tracking-tighter">
					{enabled ? mmss(countdown) : "—:—"}
				</div>
				<div className="mt-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
					Next cycle
				</div>
				<div className="mt-1 text-xs text-neutral-600">
					Last: {relative(status.lastActionAt)}
				</div>
			</main>

			<footer className="px-6 pb-6 space-y-2">
				<button
					onClick={toggle}
					disabled={busy}
					className={`w-full py-3.5 rounded-lg font-medium text-sm tracking-wide transition-all ${
						enabled
							? "bg-neutral-100 text-neutral-900 hover:bg-white"
							: "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
					} disabled:opacity-40`}
				>
					{enabled ? "End Session" : "Start Focus"}
				</button>
				<button
					onClick={manual}
					disabled={triggering}
					className="w-full py-3 rounded-lg font-medium text-sm tracking-wide text-neutral-300 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 hover:text-neutral-100 transition-all disabled:opacity-40"
				>
					{triggering ? "Refreshing…" : "Refresh Now"}
				</button>
				<VersionLine info={appInfo} />
			</footer>
		</div>
	);
}

export default App;
