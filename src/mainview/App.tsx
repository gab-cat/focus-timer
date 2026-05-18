import { useEffect, useState } from "react";
import { Settings as SettingsPanel } from "./Settings";
import { Stats as StatsView } from "./Stats";
import {
	DEFAULT_SETTINGS,
	type AppInfo,
	type JigglerStatus,
	type Settings,
	type Stats,
} from "../shared/types";
import {
	applyUpdate,
	checkForUpdate,
	getAppInfo,
	getSettings,
	getStats,
	getStatus,
	onAppInfo,
	onSettings,
	onStats,
	onStatus,
	setEnabled,
	triggerNow,
} from "./rpc";
import { useTheme } from "./theme";

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

const INITIAL_STATS: Stats = {
	totalActions: 0,
	today: { date: "", count: 0 },
	history: {},
};

function mmss(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function hms(ms: number) {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	const s = total % 60;
	return `${m}m ${s}s`;
}

function relative(ts: number | null) {
	if (!ts) return "never";
	const diff = Math.round((Date.now() - ts) / 1000);
	if (diff < 60) return `${diff}s ago`;
	const m = Math.floor(diff / 60);
	const s = diff % 60;
	return `${m}m ${s}s ago`;
}

function pauseLabel(reason: NonNullable<JigglerStatus["pauseReason"]>) {
	switch (reason) {
		case "battery":
			return "Paused — on battery";
		case "call":
			return "Paused — on a call";
		case "lock":
			return "Paused — screen locked";
	}
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
			disabled={
				checking || info.updatePhase === "checking" || info.updatePhase === "downloading"
			}
			className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 hover:text-neutral-900 dark:text-neutral-600 dark:hover:text-neutral-400 transition-colors disabled:opacity-40"
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
				className="text-[10px] uppercase tracking-[0.18em] text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors disabled:opacity-40"
			>
				{restarting
					? "Restarting…"
					: `Restart to install${info.availableVersion ? ` v${info.availableVersion}` : ""}`}
			</button>
		);
	} else if (info.updatePhase === "error" && info.error) {
		right = (
			<button
				onClick={check}
				disabled={checking}
				title={info.error}
				className="text-[10px] uppercase tracking-[0.18em] text-amber-600 hover:text-amber-500 dark:text-amber-500 dark:hover:text-amber-400 transition-colors disabled:opacity-40"
			>
				Update failed · Retry
			</button>
		);
	}

	return (
		<div className="flex items-center justify-between pt-1">
			<span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-600">
				{versionText}
			</span>
			{right}
		</div>
	);
}

function GearIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			width="14"
			height="14"
		>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</svg>
	);
}

function App() {
	const [status, setStatus] = useState<JigglerStatus>({
		enabled: false,
		lastActionAt: null,
		nextActionAt: null,
		actionCount: 0,
		sessionStartedAt: null,
		autoStopAt: null,
		pauseReason: null,
	});
	const [busy, setBusy] = useState(false);
	const [triggering, setTriggering] = useState(false);
	const [appInfo, setAppInfo] = useState<AppInfo>(INITIAL_APP_INFO);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [stats, setStats] = useState<Stats>(INITIAL_STATS);
	const [showSettings, setShowSettings] = useState(false);
	const [, force] = useState(0);

	useTheme(settings.theme);

	useEffect(() => {
		getStatus().then(setStatus).catch(() => {});
		getAppInfo().then(setAppInfo).catch(() => {});
		getSettings().then(setSettings).catch(() => {});
		getStats().then(setStats).catch(() => {});
		const offStatus = onStatus(setStatus);
		const offAppInfo = onAppInfo(setAppInfo);
		const offSettings = onSettings(setSettings);
		const offStats = onStats(setStats);
		const tick = setInterval(() => force((n) => n + 1), 1000);
		return () => {
			offStatus();
			offAppInfo();
			offSettings();
			offStats();
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
	const countdown = enabled && status.nextActionAt ? status.nextActionAt - Date.now() : 0;
	const autoStopRemaining =
		enabled && status.autoStopAt ? status.autoStopAt - Date.now() : 0;

	return (
		<div className="h-screen w-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans select-none overflow-hidden">
			{showSettings ? (
				<SettingsPanel settings={settings} onClose={() => setShowSettings(false)} />
			) : (
				<>
					<header className="flex items-center justify-between px-6 pt-6">
						<div className="flex items-center gap-2.5">
							<span
								className={`h-2 w-2 rounded-full ${
									enabled
										? status.pauseReason
											? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]"
											: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]"
										: "bg-neutral-400 dark:bg-neutral-600"
								}`}
							/>
							<span className="text-sm font-medium tracking-wide uppercase text-neutral-600 dark:text-neutral-400">
								{enabled ? (status.pauseReason ? "Paused" : "Active") : "Idle"}
							</span>
						</div>
						<div className="flex items-center gap-3">
							<span className="text-xs font-mono text-neutral-500 dark:text-neutral-500">
								{status.actionCount} cycles
							</span>
							<button
								onClick={() => setShowSettings(true)}
								className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100 transition-colors"
								aria-label="Settings"
							>
								<GearIcon />
							</button>
						</div>
					</header>

					{status.pauseReason ? (
						<div className="mx-6 mt-3 px-3 py-2 rounded-md text-[11px] text-amber-700 bg-amber-100 border border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/20">
							{pauseLabel(status.pauseReason)}
						</div>
					) : null}

					<main className="flex-1 flex flex-col items-center justify-center px-6">
						<div className="text-xs uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-500 mb-3">
							Focus Timer
						</div>
						<div className="text-[80px] leading-none font-light font-mono tabular-nums tracking-tighter">
							{enabled && !status.pauseReason ? mmss(countdown) : "—:—"}
						</div>
						<div className="mt-2 text-xs uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-500">
							Next cycle
						</div>
						<div className="mt-1 text-xs text-neutral-500 dark:text-neutral-600">
							Last: {relative(status.lastActionAt)}
						</div>
						{enabled && status.autoStopAt ? (
							<div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-600">
								Auto-stop in {hms(autoStopRemaining)}
							</div>
						) : null}
					</main>

					<footer className="px-6 pb-6 space-y-2">
						<StatsView stats={stats} />
						<button
							onClick={toggle}
							disabled={busy}
							className={`w-full py-3.5 rounded-lg font-medium text-sm tracking-wide transition-all ${
								enabled
									? "bg-neutral-900 text-neutral-50 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
									: "bg-emerald-500 text-neutral-50 hover:bg-emerald-400 dark:text-neutral-950"
							} disabled:opacity-40`}
						>
							{enabled ? "End Session" : "Start Focus"}
						</button>
						<button
							onClick={manual}
							disabled={triggering}
							className="w-full py-3 rounded-lg font-medium text-sm tracking-wide text-neutral-700 bg-neutral-100 border border-neutral-200 hover:bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 transition-all disabled:opacity-40"
						>
							{triggering ? "Refreshing…" : "Refresh Now"}
						</button>
						<VersionLine info={appInfo} />
					</footer>
				</>
			)}
		</div>
	);
}

export default App;
