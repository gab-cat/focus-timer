import { useEffect, useState } from "react";
import type {
	ActionType,
	AppInfo,
	JigglerStatus,
	Settings as SettingsType,
	SleepHelperInfo,
} from "../shared/types";
import { AutoStopModePicker, AutoStopValue, stopEstimate } from "./AutoStop";
import { minuteRange, minutesLabel } from "./format";
import {
	checkForUpdate,
	getSleepHelper,
	installSleepHelper,
	openNotificationSettings,
	removeSleepHelper,
	requestNotifications,
	resetStats,
	sendTestNotification,
	updateSettings,
} from "./rpc";
import { LinkButton, Row, Section, Segmented, Toggle } from "./ui";
import { useUpdateInstall } from "./update";

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
	{ value: "cmdtab", title: "⌘-Tab", description: "Nudges the cursor, then presses ⌘-Tab 1–6 times." },
	{ value: "mouse", title: "Mouse only", description: "A small cursor nudge. Never changes focus." },
	{ value: "scroll", title: "Scroll", description: "One line up and back down. Net zero." },
	{ value: "shift", title: "Shift tap", description: "A single modifier key press. Silent." },
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

function NotificationsRow({ status }: { status: JigglerStatus }) {
	const [sent, setSent] = useState(false);
	const [asking, setAsking] = useState(false);
	useEffect(() => {
		if (!sent) return;
		const t = setTimeout(() => setSent(false), 2400);
		return () => clearTimeout(t);
	}, [sent]);
	useEffect(() => {
		if (status.notifications !== "unknown") setAsking(false);
	}, [status.notifications]);

	const p = status.notifications;
	const description =
		p === "allowed"
			? "Allowed. You get one when a session reaches its stop time."
			: p === "denied"
				? "Turned off in System Settings. The stop notice shows in a small panel at the top right instead."
				: p === "unknown"
					? "macOS asks the first time a session with a stop time starts. You can allow them now."
					: p === "blocked"
						? "macOS won't send notifications for this build. The stop notice shows in a small panel at the top right instead."
						: "Not available in this build.";

	let control: React.ReactNode = null;
	if (p === "allowed" || p === "blocked") {
		control = (
			<LinkButton
				disabled={sent}
				onClick={() => {
					void sendTestNotification();
					setSent(true);
				}}
			>
				<span key={String(sent)} className="animate-swap inline-block">
					{sent ? "Sent" : "Send a test"}
				</span>
			</LinkButton>
		);
	} else if (p === "denied") {
		control = <LinkButton onClick={() => void openNotificationSettings()}>Open settings</LinkButton>;
	} else if (p === "unknown") {
		control = (
			<button
				disabled={asking}
				onClick={() => {
					setAsking(true);
					void requestNotifications();
				}}
				className="press h-[28px] rounded-[9px] bg-ink px-3 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
			>
				{asking ? "Waiting…" : "Allow"}
			</button>
		);
	}
	return <Row icon="bell" title="Notifications" description={description} control={control} />;
}

function DataRow() {
	const [confirm, setConfirm] = useState(false);
	return (
		<Row
			title="Activity history"
			description="Counts, heatmap and mix."
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
	const install = useUpdateInstall(info);
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
			<span title={install.state === "failed" ? (info.error ?? undefined) : undefined}>
				<LinkButton
					tone={install.state === "failed" ? "danger" : "accent"}
					disabled={install.state === "installing" || install.state === "restarting"}
					onClick={install.install}
				>
					{install.state === "installing"
						? "Installing…"
						: install.state === "restarting"
							? "Restarting…"
							: install.state === "failed"
								? "Install failed · Retry"
								: `Restart to update${info.availableVersion ? ` to ${info.availableVersion}` : ""}`}
				</LinkButton>
			</span>
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

export function Settings({
	settings,
	appInfo,
	status,
}: {
	settings: SettingsType;
	appInfo: AppInfo;
	status: JigglerStatus;
}) {
	const pace = paceOf(settings);
	const paceText = `Every ${minuteRange(settings.minDelayMs, settings.maxDelayMs)} once you're ${minutesLabel(settings.idleThresholdMs)} idle`;

	return (
		<div className="no-scrollbar scroll-soft h-full space-y-5 overflow-y-auto px-4 pb-6 pt-1">
			<Section title="How it moves" index={0}>
				<ModePicker value={settings.actionType} />
			</Section>

			<Section title="Timing" index={1}>
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
			</Section>

			<Section title="Pause when" index={2}>
				<Row
					icon="lock"
					title="Screen is locked"
					control={<Toggle label="Pause when locked" value={settings.pauseOnLock} onChange={(v) => patch({ pauseOnLock: v })} />}
				/>
				<Row
					icon="battery"
					title="On battery"
					control={<Toggle label="Pause on battery" value={settings.pauseOnBattery} onChange={(v) => patch({ pauseOnBattery: v })} />}
				/>
				<Row
					icon="phone"
					title="On a call"
					description="Any app using the microphone. Moves pick up again when the call ends."
					control={
						<Toggle
							label="Pause on a call"
							value={settings.callMode === "pause"}
							onChange={(v) => patch({ callMode: v ? "pause" : "off" })}
						/>
					}
				/>
			</Section>

			<Section title="Auto-stop" index={3}>
				<Row icon="timer" title="End the session" description={stopEstimate(settings, status, Date.now())}>
					<div className="mt-3 space-y-3 pl-7">
						<AutoStopModePicker settings={settings} />
						{settings.autoStopMs || settings.autoStopTime ? (
							<div key={settings.autoStopTime ? "at" : "after"} className="animate-swap">
								<AutoStopValue settings={settings} />
							</div>
						) : null}
					</div>
				</Row>
				{settings.autoStopMs || settings.autoStopTime ? <NotificationsRow status={status} /> : null}
			</Section>

			<Section title="Keep awake" index={4}>
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
			</Section>

			<Section title="General" index={5}>
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
