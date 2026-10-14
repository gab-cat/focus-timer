import { useEffect, useState } from "react";
import type {
	ActionType,
	AppInfo,
	CalendarInfo,
	Settings as SettingsType,
	SleepHelperInfo,
} from "../shared/types";
import { clock, minuteRange, minutesLabel } from "./format";
import {
	applyUpdate,
	checkForUpdate,
	getCalendarInfo,
	getSleepHelper,
	installSleepHelper,
	openCalendarPrivacy,
	removeSleepHelper,
	requestCalendarAccess,
	resetStats,
	updateSettings,
} from "./rpc";
import { LinkButton, Row, Section, Segmented, Toggle } from "./ui";

const patch = (p: Partial<SettingsType>) => void updateSettings(p);

type Pace = "subtle" | "normal" | "brisk" | "custom";

const PACES: Record<Exclude<Pace, "custom">, Partial<SettingsType>> = {
	subtle: { minDelayMs: 180_000, maxDelayMs: 300_000, idleThresholdMs: 300_000 },
	normal: { minDelayMs: 90_000, maxDelayMs: 180_000, idleThresholdMs: 120_000 },
	brisk: { minDelayMs: 30_000, maxDelayMs: 60_000, idleThresholdMs: 30_000 },
};

function paceOf(s: SettingsType): Pace {
	for (const [name, v] of Object.entries(PACES)) {
		if (
			s.minDelayMs === v.minDelayMs &&
			s.maxDelayMs === v.maxDelayMs &&
			s.idleThresholdMs === v.idleThresholdMs
		)
			return name as Pace;
	}
	return "custom";
}

const MODES: Array<{ value: ActionType; title: string; description: string }> = [
	{
		value: "natural",
		title: "Natural",
		description: "Curved mouse paths, reading scrolls, quick app glances. Never the same move twice in a row.",
	},
	{ value: "mouse", title: "Mouse only", description: "Small and medium cursor moves. Never changes focus." },
	{ value: "scroll", title: "Scroll", description: "One flick down and back. Net zero." },
	{ value: "shift", title: "Shift tap", description: "A single modifier key press. Silent." },
	{ value: "cmdtab", title: "⌘-Tab", description: "Cycles through apps. Most visible, most disruptive." },
];

function ModePicker({ value }: { value: ActionType }) {
	return (
		<div role="radiogroup" aria-label="Activity mode" className="divide-y divide-line/70">
			{MODES.map((m) => {
				const on = m.value === value;
				return (
					<button
						key={m.value}
						role="radio"
						aria-checked={on}
						onClick={() => patch({ actionType: m.value })}
						className={`press-soft flex w-full items-start gap-3 px-4 py-3 text-left ${
							on ? "bg-accent/[0.06]" : "hover:bg-ink/[0.025]"
						}`}
					>
						<span
							className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
								on ? "bg-accent" : "ring-[1.5px] ring-inset ring-ink/20"
							}`}
						>
							<span className={`h-1.5 w-1.5 rounded-full bg-accent-ink transition-transform duration-300 ease-spring ${on ? "scale-100" : "scale-0"}`} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-2 text-[13.5px] font-medium tracking-[-0.01em]">
								{m.title}
								{m.value === "natural" ? (
									<span className="rounded-[5px] bg-accent/15 px-1.5 py-[1px] text-[10.5px] font-semibold text-accent">
										Recommended
									</span>
								) : null}
							</span>
							<span className="mt-0.5 block text-[12px] leading-[1.45] text-ink-3 [text-wrap:pretty]">
								{m.description}
							</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}

function CalendarRow({ settings }: { settings: SettingsType }) {
	const [info, setInfo] = useState<CalendarInfo | null>(null);
	const [asking, setAsking] = useState(false);

	useEffect(() => {
		if (settings.pauseOnMeeting) getCalendarInfo().then(setInfo).catch(() => {});
	}, [settings.pauseOnMeeting]);

	async function toggle(v: boolean) {
		patch({ pauseOnMeeting: v });
		if (!v) return;
		setAsking(true);
		try {
			const current = await getCalendarInfo();
			setInfo(current.access === "notDetermined" ? await requestCalendarAccess() : current);
		} finally {
			setAsking(false);
		}
	}

	let detail: React.ReactNode = "Events with other people or a video link. Solo blocks don't count.";
	if (settings.pauseOnMeeting) {
		if (asking) detail = "Waiting for Calendar access…";
		else if (info?.access === "denied" || info?.access === "restricted" || info?.access === "writeOnly") {
			detail = (
				<span>
					<span className="text-warn">Calendar access is off.</span>{" "}
					<button onClick={() => void openCalendarPrivacy()} className="font-medium text-ink-2 underline decoration-ink/20 underline-offset-2 hover:text-ink">
						Open Privacy settings
					</button>
				</span>
			);
		} else if (info?.access === "granted") {
			detail = info.current
				? `Now: ${info.current.title}, until ${clock(info.current.end)}`
				: info.next
					? `Next: ${info.next.title} at ${clock(info.next.start)}`
					: "No more meetings today";
		} else if (info?.access === "notDetermined") {
			detail = (
				<button onClick={() => void toggle(true)} className="font-medium text-accent hover:text-accent/80">
					Allow Calendar access
				</button>
			);
		}
	}

	return (
		<Row
			icon="calendar"
			title="In a meeting"
			description={detail}
			control={<Toggle label="Pause in meetings" value={settings.pauseOnMeeting} onChange={(v) => void toggle(v)} />}
		/>
	);
}

function SleepHelperRow() {
	const [info, setInfo] = useState<SleepHelperInfo | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		getSleepHelper().then(setInfo).catch(() => {});
	}, []);

	async function run(fn: () => Promise<SleepHelperInfo>) {
		setBusy(true);
		try {
			setInfo(await fn());
		} catch {
		} finally {
			setBusy(false);
		}
	}

	return (
		<Row
			icon="lock"
			title="Skip the password"
			description={
				info?.error ? (
					<span className="text-warn">{info.error}</span>
				) : info?.installed ? (
					"Sessions block and restore sleep silently."
				) : (
					"Otherwise macOS asks for your password at the start and end of each session. Allows only pmset disablesleep."
				)
			}
			control={
				info == null ? (
					<span className="text-[12px] text-ink-3">…</span>
				) : info.installed ? (
					<LinkButton onClick={() => void run(removeSleepHelper)} disabled={busy}>
						{busy ? "Waiting…" : "Remove"}
					</LinkButton>
				) : (
					<button
						disabled={busy}
						onClick={() => void run(installSleepHelper)}
						className="press h-[28px] rounded-[9px] bg-ink px-3 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
					>
						{busy ? "Waiting…" : "Set up"}
					</button>
				)
			}
		/>
	);
}

function DataRow() {
	const [confirm, setConfirm] = useState(false);
	return (
		<Row
			title="Activity history"
			description="Counts, heatmap and mix. Your rhythm profile is reset from Insights."
			control={
				confirm ? (
					<span className="flex gap-3">
						<LinkButton onClick={() => setConfirm(false)}>Cancel</LinkButton>
						<LinkButton
							tone="danger"
							onClick={() => {
								void resetStats();
								setConfirm(false);
							}}
						>
							Erase
						</LinkButton>
					</span>
				) : (
					<LinkButton onClick={() => setConfirm(true)}>Reset…</LinkButton>
				)
			}
		/>
	);
}

function VersionFooter({ info }: { info: AppInfo }) {
	const [checking, setChecking] = useState(false);
	const channel = info.channel && info.channel !== "stable" ? ` · ${info.channel}` : "";
	let action: React.ReactNode = (
		<LinkButton
			disabled={checking || info.updatePhase === "checking" || info.updatePhase === "downloading"}
			onClick={async () => {
				setChecking(true);
				try {
					await checkForUpdate();
				} finally {
					setChecking(false);
				}
			}}
		>
			{info.updatePhase === "checking"
				? "Checking…"
				: info.updatePhase === "downloading"
					? `Downloading${info.updateProgress != null ? ` ${info.updateProgress}%` : "…"}`
					: "Check for updates"}
		</LinkButton>
	);
	if (info.updateReady) {
		action = (
			<LinkButton tone="accent" onClick={() => void applyUpdate()}>
				Restart to update{info.availableVersion ? ` to ${info.availableVersion}` : ""}
			</LinkButton>
		);
	} else if (info.updatePhase === "error") {
		action = (
			<span title={info.error ?? undefined}>
				<LinkButton tone="danger" onClick={() => void checkForUpdate()}>
					Update failed · Retry
				</LinkButton>
			</span>
		);
	}
	return (
		<div className="flex items-center justify-between px-1 pt-1">
			<span className="font-mono text-[11px] text-ink-3">
				{info.version ? `Focus Timer ${info.version}${channel}` : "Focus Timer"}
			</span>
			{action}
		</div>
	);
}

export function Settings({ settings, appInfo }: { settings: SettingsType; appInfo: AppInfo }) {
	const pace = paceOf(settings);
	const paceText = `Every ${minuteRange(settings.minDelayMs, settings.maxDelayMs)} once you're ${minutesLabel(settings.idleThresholdMs)} idle`;

	return (
		<div className="no-scrollbar h-full space-y-5 overflow-y-auto px-5 pb-6">
			<Section title="How it moves" index={0}>
				<ModePicker value={settings.actionType} />
			</Section>

			<Section title="Feel" index={1}>
				<Row
					title="Pace"
					description={pace === "custom" ? `Custom · ${paceText}` : paceText}
					control={
						<Segmented
							size="sm"
							label="Pace"
							value={pace === "custom" ? ("custom" as Pace) : pace}
							onChange={(p) => p !== "custom" && patch(PACES[p])}
							options={[
								{ value: "subtle" as Pace, label: "Subtle" },
								{ value: "normal" as Pace, label: "Normal" },
								{ value: "brisk" as Pace, label: "Brisk" },
								...(pace === "custom" ? [{ value: "custom" as Pace, label: "Custom" }] : []),
							]}
						/>
					}
				/>
				<Row
					icon="window"
					title="Fit the app in front"
					description="Reads in browsers and docs, stays inside the front window, never ⌘-Tabs out of a terminal or editor."
					control={<Toggle label="Fit the app in front" value={settings.appAware} onChange={(v) => patch({ appAware: v })} />}
				/>
				<Row
					icon="scroll"
					title="Scroll feel"
					description={settings.scrollStyle === "trackpad" ? "Two-finger swipes with momentum, like a trackpad." : "Plain wheel clicks, like a mouse."}
					control={
						<Segmented
							size="sm"
							label="Scroll feel"
							value={settings.scrollStyle}
							onChange={(v) => patch({ scrollStyle: v })}
							options={[
								{ value: "trackpad", label: "Trackpad" },
								{ value: "wheel", label: "Wheel" },
							]}
						/>
					}
				/>
				<Row
					icon="wave"
					title="Learn my rhythm"
					description="Copies your own move distances, speed and pauses. Progress is under Insights."
					control={<Toggle label="Learn my rhythm" value={settings.learnRhythm} onChange={(v) => patch({ learnRhythm: v })} />}
				/>
				<Row
					icon="cup"
					title="Short breaks"
					description="Every 45–110 min, goes quiet for 3–11 min."
					control={<Toggle label="Short breaks" value={settings.naturalBreaks} onChange={(v) => patch({ naturalBreaks: v })} />}
				/>
			</Section>

			<Section title="Pause when" index={2}>
				<Row
					icon="lock"
					title="Screen is locked"
					control={<Toggle label="Pause when locked" value={settings.pauseOnLock} onChange={(v) => patch({ pauseOnLock: v })} />}
				/>
				<Row
					icon="phone"
					title="On a call"
					description="Zoom, Teams, FaceTime, Webex, Discord."
					control={<Toggle label="Pause on calls" value={settings.pauseOnCall} onChange={(v) => patch({ pauseOnCall: v })} />}
				/>
				<CalendarRow settings={settings} />
				<Row
					icon="battery"
					title="On battery"
					control={<Toggle label="Pause on battery" value={settings.pauseOnBattery} onChange={(v) => patch({ pauseOnBattery: v })} />}
				/>
			</Section>

			<Section title="Keep awake" index={3}>
				<Row
					icon="moon"
					title="Block system sleep"
					description="Runs pmset disablesleep while a session is on, even with the lid closed. Restored when it ends."
					control={
						<Toggle
							label="Block system sleep"
							value={settings.preventSystemSleep}
							onChange={(v) => patch({ preventSystemSleep: v })}
						/>
					}
				/>
				{settings.preventSystemSleep ? <SleepHelperRow /> : null}
				<Row
					icon="timer"
					title="Auto-stop"
					control={
						<Segmented
							size="sm"
							label="Auto-stop"
							value={settings.autoStopMs}
							onChange={(v) => patch({ autoStopMs: v })}
							options={[
								{ value: null, label: "Off" },
								{ value: 30 * 60_000, label: "30m" },
								{ value: 60 * 60_000, label: "1h" },
								{ value: 2 * 60 * 60_000, label: "2h" },
								{ value: 4 * 60 * 60_000, label: "4h" },
							]}
						/>
					}
				/>
			</Section>

			<Section title="General" index={4}>
				<Row
					title="Appearance"
					control={
						<Segmented
							size="sm"
							label="Appearance"
							value={settings.theme}
							onChange={(v) => patch({ theme: v })}
							options={[
								{ value: "auto", label: "Auto" },
								{ value: "light", label: "Light" },
								{ value: "dark", label: "Dark" },
							]}
						/>
					}
				/>
				<DataRow />
			</Section>

			<div className="flex items-center justify-center gap-4 text-[11px] text-ink-3">
				<span className="flex items-center gap-1.5">
					<span className="kbd bg-ink/[0.07]">Space</span> start / stop
				</span>
				<span className="flex items-center gap-1.5">
					<span className="kbd bg-ink/[0.07]">R</span> move now
				</span>
				<span className="flex items-center gap-1.5">
					<span className="kbd bg-ink/[0.07]">⌘1–3</span> tabs
				</span>
			</div>

			<VersionFooter info={appInfo} />
		</div>
	);
}
