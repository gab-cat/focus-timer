import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AppInfo,
	DEFAULT_SETTINGS,
	type JigglerStatus,
	type RhythmInfo,
	type Settings,
	type Stats,
} from "../shared/types";
import { Focus } from "./Focus";
import { Insights } from "./Insights";
import {
	getAppInfo,
	getRhythm,
	getSettings,
	getStats,
	getStatus,
	onAppInfo,
	onRhythm,
	onSettings,
	onStats,
	onStatus,
	setEnabled,
	triggerNow,
} from "./rpc";
import { Settings as SettingsView } from "./Settings";
import { useTheme } from "./theme";
import { Segmented } from "./ui";

const INITIAL_STATUS: JigglerStatus = {
	enabled: false,
	lastActionAt: null,
	nextActionAt: null,
	waitStartedAt: null,
	actionCount: 0,
	sessionStartedAt: null,
	autoStopAt: null,
	pauseReason: null,
	pauseDetail: null,
	lastRoutine: null,
	lastApp: null,
	sleepGuard: "off",
	recent: [],
};

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
	hourly: {},
	userHourly: {},
	routines: {},
};

type Tab = "focus" | "insights" | "settings";
const TABS: Tab[] = ["focus", "insights", "settings"];

function App() {
	const [status, setStatus] = useState<JigglerStatus>(INITIAL_STATUS);
	const [appInfo, setAppInfo] = useState<AppInfo>(INITIAL_APP_INFO);
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const [stats, setStats] = useState<Stats>(INITIAL_STATS);
	const [rhythm, setRhythm] = useState<RhythmInfo | null>(null);
	const [view, setView] = useState<{ tab: Tab; dir: number; n: number }>({ tab: "focus", dir: 1, n: 0 });
	const [leaving, setLeaving] = useState<{ tab: Tab; dir: number; n: number } | null>(null);
	const tab = view.tab;
	const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const viewRef = useRef(view);
	viewRef.current = view;

	// Cross-fade between tabs, sliding toward the direction of travel.
	const setTab = useCallback((next: Tab) => {
		const cur = viewRef.current;
		if (cur.tab === next) return;
		const dir = TABS.indexOf(next) > TABS.indexOf(cur.tab) ? 1 : -1;
		setLeaving({ ...cur, dir });
		setView({ tab: next, dir, n: cur.n + 1 });
		if (leaveTimer.current) clearTimeout(leaveTimer.current);
		leaveTimer.current = setTimeout(() => setLeaving(null), 280);
	}, []);
	const [busy, setBusy] = useState(false);
	const [moving, setMoving] = useState(false);
	const [, force] = useState(0);

	useTheme(settings.theme);

	useEffect(() => {
		getStatus().then(setStatus).catch(() => {});
		getAppInfo().then(setAppInfo).catch(() => {});
		getSettings().then(setSettings).catch(() => {});
		getStats().then(setStats).catch(() => {});
		getRhythm().then(setRhythm).catch(() => {});
		const offs = [
			onStatus(setStatus),
			onAppInfo(setAppInfo),
			onSettings(setSettings),
			onStats(setStats),
			onRhythm(setRhythm),
		];
		const tick = setInterval(() => force((n) => n + 1), 1000);
		return () => {
			for (const off of offs) off();
			clearInterval(tick);
		};
	}, []);

	const statusRef = useRef(status);
	statusRef.current = status;

	const toggle = useCallback(async () => {
		setBusy(true);
		try {
			setStatus(await setEnabled(!statusRef.current.enabled));
		} catch {
		} finally {
			setBusy(false);
		}
	}, []);

	const moveNow = useCallback(async () => {
		setMoving(true);
		try {
			setStatus(await triggerNow());
		} catch {
		} finally {
			setMoving(false);
		}
	}, []);

	// Space: start/stop · R: move now · ⌘1–3 / ⌘,: tabs
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
			if (e.metaKey && ["1", "2", "3"].includes(e.key)) {
				e.preventDefault();
				setTab(TABS[Number(e.key) - 1]);
				return;
			}
			if (e.metaKey && e.key === ",") {
				e.preventDefault();
				setTab("settings");
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.code === "Space" && target?.tagName !== "BUTTON") {
				e.preventDefault();
				void toggle();
			} else if (e.key === "r" || e.key === "R") {
				void moveNow();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggle, moveNow, setTab]);

	const render = (t: Tab) =>
		t === "focus" ? (
			<Focus
				status={status}
				settings={settings}
				appInfo={appInfo}
				rhythm={rhythm}
				busy={busy}
				moving={moving}
				onToggle={() => void toggle()}
				onMoveNow={() => void moveNow()}
			/>
		) : t === "insights" ? (
			<Insights stats={stats} rhythm={rhythm} settings={settings} />
		) : (
			<SettingsView settings={settings} appInfo={appInfo} />
		);

	return (
		<div className="relative flex h-full flex-col overflow-clip">
			{/* Title bar: draggable, traffic lights sit at the left inset. */}
			<header className="electrobun-webkit-app-region-drag relative z-20 flex h-[52px] shrink-0 items-center justify-center">
				<div className="electrobun-webkit-app-region-no-drag">
					<Segmented
						size="sm"
						label="Sections"
						value={tab}
						onChange={setTab}
						options={[
							{ value: "focus" as Tab, label: "Focus" },
							{ value: "insights" as Tab, label: "Insights" },
							{ value: "settings" as Tab, label: "Settings" },
						]}
					/>
				</div>
				{status.enabled && tab !== "focus" ? (
					<span
						aria-hidden
						className={`absolute right-5 h-1.5 w-1.5 rounded-full ${
							status.pauseReason ? "bg-warn" : "animate-pulse-dot bg-accent"
						}`}
						title={status.pauseReason ? "Paused" : "Active"}
					/>
				) : null}
			</header>

			{/* Views are keyed by tab, so the outgoing one is the same element
			    (no remount, no replayed entrance animations) — only its class flips. */}
			<main className="relative min-h-0 flex-1 pt-1">
				{leaving && leaving.tab !== tab ? (
					<div
						key={leaving.tab}
						aria-hidden
						className="animate-view-out pointer-events-none absolute inset-0 pt-1"
						style={{ ["--dir" as string]: leaving.dir }}
					>
						{render(leaving.tab)}
					</div>
				) : null}
				<div
					key={tab}
					className={`h-full ${view.n > 0 ? "animate-view-in" : ""}`}
					style={{ ["--dir" as string]: view.dir }}
				>
					{render(tab)}
				</div>
			</main>
		</div>
	);
}

export default App;
