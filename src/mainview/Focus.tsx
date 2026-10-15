import { useEffect, useState } from "react";
import type { AppInfo, JigglerStatus, RhythmInfo, SessionPlan, Settings } from "../shared/types";
import { Buddy, moodFor } from "./Buddy";
import { ago, duration, minutesLabel, mmss, pauseCopy, routineLabel } from "./format";
import { PlanCard, PlanInput, planAutoStopMs } from "./Planner";
import { applyUpdate, retrySleepGuard } from "./rpc";
import { Icon, type IconName, Rolling } from "./ui";

type DialState = "idle" | "active" | "paused";

const TICKS = 72;
const SIZE = 288;
const C = SIZE / 2;
const ARC_R = 120;
const ARC_LEN = 2 * Math.PI * ARC_R;

const TICK_GEOM = Array.from({ length: TICKS }, (_, i) => {
	const major = i % 6 === 0;
	const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
	const r1 = 140;
	const r2 = r1 - (major ? 11 : 6);
	return {
		major,
		x1: C + Math.cos(a) * r1,
		y1: C + Math.sin(a) * r1,
		x2: C + Math.cos(a) * r2,
		y2: C + Math.sin(a) * r2,
	};
});

// Sparks thrown off the comet head when a wait runs out: fanned evenly with
// a little jitter so the burst doesn't look stamped.
const SPARKS = Array.from({ length: 11 }, (_, i) => {
	const a = ((i / 11) * 360 + (i % 2 ? 11 : -7)) * (Math.PI / 180);
	const dist = 26 + (i % 3) * 10;
	return {
		dx: Math.cos(a) * dist,
		dy: Math.sin(a) * dist,
		star: i % 3 === 1,
		r: i % 2 ? 1.5 : 2.1,
		rot: (i % 2 ? 1 : -1) * 140,
		delay: (i % 4) * 30,
	};
});
const STAR = "M0,-5 Q0.6,-0.6 5,0 Q0.6,0.6 0,5 Q-0.6,0.6 -5,0 Q-0.6,-0.6 0,-5 Z";

// Rewind: the arc and comet whip back to the start once the burst has read.
const REWIND = "850ms cubic-bezier(0.65, 0, 0.35, 1) 160ms";

function Dial({
	state,
	progress,
	rewinding,
	lapKey,
	pulseKey,
	children,
}: {
	state: DialState;
	progress: number;
	// A new wait just started: the arc and lit ticks drain backwards.
	rewinding: boolean;
	// Set the moment a wait runs out; each new value plays the lap burst.
	lapKey: number | null;
	pulseKey: number | null;
	children: React.ReactNode;
}) {
	const lit = state === "active" ? Math.floor(progress * TICKS) : 0;
	const tone = state === "paused" ? "--warn" : "--accent";
	return (
		<div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
			<svg
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
				className="absolute inset-0"
				style={{ overflow: "visible" }}
			>
				{/* Bezel ticks */}
				{TICK_GEOM.map(({ major, x1, y1, x2, y2 }, i) => {
					const on = i < lit;
					// Ticks near the leading edge glow brightest, fading behind.
					const trail = on ? 0.4 + 0.6 * Math.pow((i + 1) / Math.max(1, lit), 1.6) : 0;
					return (
						<line
							key={i}
							x1={x1}
							y1={y1}
							x2={x2}
							y2={y2}
							strokeWidth={major ? 2 : on ? 1.6 : 1.2}
							strokeLinecap="round"
							style={{
								stroke: on
									? `rgb(var(${tone}) / ${trail.toFixed(3)})`
									: state === "paused" && major
										? "rgb(var(--warn) / 0.45)"
										: `rgb(var(--ink) / ${major ? 0.22 : 0.1})`,
								// On a rewind they go out from the far end back to 12 o'clock.
								transition: `stroke 600ms ease-out ${rewinding ? 160 + (TICKS - 1 - i) * 9 : 0}ms`,
							}}
						/>
					);
				})}
				{/* Lap: a wave of light runs clockwise around the bezel. */}
				{lapKey ? (
					<g key={`w${lapKey}`} aria-hidden style={{ filter: "drop-shadow(0 0 3px rgb(var(--accent) / 0.8))" }}>
						{TICK_GEOM.map(({ major, x1, y1, x2, y2 }, i) => (
							<line
								key={i}
								x1={x1}
								y1={y1}
								x2={x2}
								y2={y2}
								strokeWidth={major ? 2.6 : 2}
								strokeLinecap="round"
								className="lap-tick"
								style={{ stroke: "rgb(var(--accent))", ["--i" as string]: i }}
							/>
						))}
					</g>
				) : null}
				{/* Track */}
				<circle cx={C} cy={C} r={ARC_R} fill="none" strokeWidth={1} style={{ stroke: "rgb(var(--ink) / 0.07)" }} />
				{/* Progress arc + comet head. A new wait rewinds them instead of snapping back. */}
				{state === "active" ? (
					<g className="animate-fade">
						<circle
							cx={C}
							cy={C}
							r={ARC_R}
							fill="none"
							strokeWidth={2}
							strokeLinecap="round"
							transform={`rotate(-90 ${C} ${C})`}
							strokeDasharray={ARC_LEN}
							strokeDashoffset={ARC_LEN * (1 - progress)}
							style={{
								stroke: "rgb(var(--accent))",
								transition: `stroke-dashoffset ${rewinding ? REWIND : "1s linear"}`,
								filter: "drop-shadow(0 0 4px rgb(var(--accent) / 0.6))",
							}}
						/>
						<g
							style={{
								transform: `rotate(${progress * 360}deg)`,
								transformOrigin: `${C}px ${C}px`,
								transition: `transform ${rewinding ? REWIND : "1s linear"}`,
							}}
						>
							<circle
								cx={C}
								cy={C - ARC_R}
								r={4}
								style={{
									fill: "rgb(var(--accent))",
									filter: "drop-shadow(0 0 8px rgb(var(--accent) / 0.95))",
								}}
							/>
						</g>
					</g>
				) : null}
				{/* Lap: the comet head flares and throws sparks. */}
				{lapKey ? (
					<g key={`b${lapKey}`} aria-hidden transform={`translate(${C} ${C - ARC_R})`}>
						<circle r={6} className="lap-flare" style={{ fill: "rgb(var(--accent) / 0.35)" }} />
						<circle
							r={5}
							fill="none"
							strokeWidth={1.2}
							className="lap-flare"
							style={{ stroke: "rgb(var(--accent))", ["--d" as string]: "60ms" }}
						/>
						{SPARKS.map((s, i) => {
							const style = {
								fill: `rgb(var(--accent) / ${s.star ? 1 : 0.75})`,
								["--dx" as string]: `${s.dx.toFixed(1)}px`,
								["--dy" as string]: `${s.dy.toFixed(1)}px`,
								["--rot" as string]: `${s.rot}deg`,
								["--d" as string]: `${s.delay}ms`,
							};
							return s.star ? (
								<path key={i} d={STAR} className="lap-spark" style={style} />
							) : (
								<circle key={i} r={s.r} className="lap-spark" style={style} />
							);
						})}
					</g>
				) : null}
			</svg>

			{/* Core */}
			<div className="absolute inset-[42px]">
				{pulseKey ? (
					<span
						key={pulseKey}
						className="animate-ripple absolute inset-0 rounded-full border border-accent/70"
					/>
				) : null}
				<div
					className={`relative flex h-full w-full flex-col items-center justify-center rounded-full ${
						state === "active" ? "animate-breathe" : ""
					}`}
					style={{
						background:
							state === "idle"
								? "radial-gradient(circle at 50% 30%, rgb(var(--ink) / 0.05), transparent 65%), rgb(var(--surface))"
								: `radial-gradient(circle at 50% 28%, rgb(var(${tone}) / 0.16), transparent 62%), radial-gradient(circle at 50% 110%, rgb(var(${tone}) / 0.1), transparent 55%), rgb(var(--surface))`,
						boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.05), 0 0 0 1px rgb(var(--line)), 0 24px 60px -28px rgb(var(${
							state === "idle" ? "--shadow" : tone
						}) / ${state === "idle" ? 0.4 : 0.5})`,
						transition: "background 800ms ease-out, box-shadow 800ms ease-out",
					}}
				>
					{children}
				</div>
			</div>
		</div>
	);
}

// Seismograph of the last 30 minutes: one stroke per move, height by how
// "big" the routine was. Irregular spacing is the point.
const TRACE_WINDOW = 30 * 60_000;
const TRACE_H: Record<string, number> = {
	nudge: 10,
	fidget: 7,
	reach: 17,
	read: 22,
	browse: 26,
	glance: 30,
	cmdtab: 24,
	mouse: 12,
	scroll: 18,
	shift: 7,
};

function Trace({ recent, active }: { recent: JigglerStatus["recent"]; active: boolean }) {
	const W = 400;
	const H = 48;
	const now = Date.now();
	const visible = recent.filter((r) => now - r.at <= TRACE_WINDOW);
	return (
		<div className="relative">
			<div className="mb-2 flex items-baseline justify-between">
				<span className="text-[12px] font-medium text-ink-2">Last 30 minutes</span>
				<span className="tabular font-mono text-[11px] text-ink-3">
					<span key={visible.length} className="animate-swap inline-block">
						{visible.length} {visible.length === 1 ? "move" : "moves"}
					</span>
				</span>
			</div>
			<svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }}>
				<line x1={0} x2={W} y1={H / 2} y2={H / 2} strokeDasharray="2 4" style={{ stroke: "rgb(var(--ink) / 0.14)" }} />
				{[0.25, 0.5, 0.75].map((f) => (
					<line key={f} x1={W * f} x2={W * f} y1={H / 2 - 3} y2={H / 2 + 3} style={{ stroke: "rgb(var(--ink) / 0.14)" }} />
				))}
				{visible.map((r) => {
					const x = W - ((now - r.at) / TRACE_WINDOW) * W;
					const h = TRACE_H[r.routine] ?? 14;
					const age = (now - r.at) / TRACE_WINDOW;
					return (
						<line
							key={r.at}
							x1={x}
							x2={x}
							y1={H / 2 - h / 2 - 2}
							y2={H / 2 + h / 2 + 2}
							strokeWidth={2}
							strokeLinecap="round"
							className="trace-mark"
							style={{ stroke: `rgb(var(--accent) / ${(1 - age * 0.75).toFixed(2)})`, transition: "x1 1s linear, x2 1s linear, stroke 1s linear" }}
						/>
					);
				})}
			</svg>
			{active ? (
				<span className="animate-fade absolute right-0 -translate-y-1/2" style={{ top: 26 + H / 2, ["--d" as string]: "500ms" }}>
					<span className="animate-pulse-dot block h-1.5 w-1.5 rounded-full bg-accent" />
				</span>
			) : null}
			{visible.length === 0 ? (
				<div className="absolute inset-x-0 flex items-center justify-center" style={{ top: 26, height: H }}>
					<span
						key={active ? "waiting" : "empty"}
						className="animate-swap rounded-md bg-bg px-2 text-[11.5px] text-ink-3"
						style={{ ["--d" as string]: active ? "420ms" : "0ms" }}
					>
						{active ? "Waiting for you to step away" : "Moves will trace here"}
					</span>
				</div>
			) : null}
			<div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3">
				<span>30m</span>
				<span>15m</span>
				<span>now</span>
			</div>
		</div>
	);
}

function Chip({
	icon,
	children,
	tone = "default",
	onClick,
	index = 0,
}: {
	icon: IconName;
	children: React.ReactNode;
	tone?: "default" | "accent" | "warn";
	onClick?: () => void;
	index?: number;
}) {
	const color =
		tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-ink-2";
	const Tag = onClick ? "button" : "span";
	return (
		<Tag
			onClick={onClick}
			className={`animate-swap inline-flex h-7 items-center gap-1.5 rounded-full bg-ink/[0.05] px-2.5 text-[11.5px] font-medium dark:bg-ink/[0.06] ${color} ${
				onClick ? "press hover:bg-ink/[0.09]" : ""
			}`}
		style={{ ["--d" as string]: `${380 + index * 80}ms` }}
		>
			<Icon name={icon} size={13} />
			{children}
		</Tag>
	);
}

// What the stand-in says it just did.
function narrate(routine: string | null, app: string | null): string {
	const where = app ? ` in ${app}` : "";
	switch (routine) {
		case "read":
		case "scroll":
			return `Reading along${where}`;
		case "browse":
			return `Browsing${where}`;
		case "glance":
			return "Peeked at another app";
		case "cmdtab":
			return "Switched apps";
		case "reach":
			return `Reached across${where}`;
		case "nudge":
		case "mouse":
			return "Nudged the cursor";
		case "fidget":
		case "shift":
			return "Fidgeted a little";
		default:
			return routineLabel(routine);
	}
}

export type PlannerProps = {
	// Apple Intelligence is usable; without it the planner input is hidden.
	available: boolean;
	draft: string;
	plan: SessionPlan | null;
	done: boolean[];
	onDraft: (text: string) => void;
	onPlan: (plan: SessionPlan | null) => void;
	onToggleStep: (i: number) => void;
};

export function Focus({
	status,
	settings,
	appInfo,
	rhythm,
	busy,
	moving,
	onToggle,
	onMoveNow,
	planner,
}: {
	status: JigglerStatus;
	settings: Settings;
	appInfo: AppInfo;
	rhythm: RhythmInfo | null;
	busy: boolean;
	moving: boolean;
	onToggle: () => void;
	onMoveNow: () => void;
	planner: PlannerProps;
}) {
	const now = Date.now();
	const pause = status.enabled ? pauseCopy(status) : null;
	const state: DialState = !status.enabled ? "idle" : pause ? "paused" : "active";

	// Fire at the exact moment the wait runs out. The 1s UI tick is too coarse:
	// when you're still at the keyboard the backend restarts the wait within
	// milliseconds, and the tick would never see zero.
	const [lapAt, setLapAt] = useState<number | null>(null);
	useEffect(() => {
		const at = status.nextActionAt;
		if (state !== "active" || !at || at <= Date.now()) return;
		const t = setTimeout(() => setLapAt(at), at - Date.now());
		return () => clearTimeout(t);
	}, [state, status.nextActionAt]);
	const lapDone = state === "active" && lapAt != null && lapAt === status.nextActionAt;

	// The first second of a new wait plays the rewind. Progress holds at zero
	// meanwhile so the next tick doesn't retarget (and stall) the transition.
	const rewinding = state === "active" && status.waitStartedAt != null && now - status.waitStartedAt < 1000;

	const span =
		status.nextActionAt && status.waitStartedAt
			? Math.max(1, status.nextActionAt - status.waitStartedAt)
			: 1;
	// Aimed one tick ahead: the arc eases over 1s toward each target, so this
	// lands the comet on 12 o'clock exactly as the lap burst fires.
	const progress =
		state === "active" && !rewinding && status.nextActionAt && status.waitStartedAt
			? Math.min(1, Math.max(0, (now + 1000 - status.waitStartedAt) / span))
			: 0;
	const remaining = status.nextActionAt ? status.nextActionAt - now : 0;
	const fresh = status.lastActionAt != null && now - status.lastActionAt < 6_000;
	const reacting = status.lastActionAt != null && now - status.lastActionAt < 2_800;
	const mood = moodFor({
		enabled: status.enabled,
		pauseReason: status.pauseReason,
		routine: status.lastRoutine,
		fresh: reacting || moving,
	});
	const tone = state === "active" ? "--accent" : state === "paused" ? "--warn" : "--ink-3";

	return (
		<div className="relative flex h-full flex-col overflow-clip px-5 pb-5" data-state={state}>
			<div className="ambient" />

			{appInfo.updateReady ? (
				<button
					onClick={() => void applyUpdate()}
					className="press animate-rise mb-3 flex items-center justify-between rounded-xl bg-accent/10 px-3.5 py-2 text-[12.5px] text-accent"
				>
					<span>Version {appInfo.availableVersion ?? "update"} is ready</span>
					<span className="font-medium">Restart →</span>
				</button>
			) : null}

			{/* Status line */}
			<div className="relative flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span
						className={`h-2 w-2 rounded-full transition-colors duration-500 ${
							state === "active"
								? "animate-pulse-dot bg-accent"
								: state === "paused"
									? "bg-warn"
									: "bg-ink/25"
						}`}
					/>
					<span key={state} className="animate-swap text-[13px] font-semibold tracking-[-0.01em]">
						{state === "active" ? "Active" : state === "paused" ? "Paused" : "Idle"}
					</span>
					{status.enabled ? (
						<span className="animate-swap text-[12.5px] text-ink-3" style={{ ["--d" as string]: "80ms" }}>
							· {settings.actionType === "natural" ? "Natural" : routineLabel(settings.actionType)}
						</span>
					) : null}
				</div>
				{status.sessionStartedAt ? (
					<span
						key={status.sessionStartedAt}
						className="animate-swap tabular font-mono text-[12px] text-ink-3"
						style={{ ["--d" as string]: "140ms" }}
					>
						<Rolling text={duration(now - status.sessionStartedAt)} />
					</span>
				) : null}
			</div>

			{/* Dial — takes the spare height so the layout breathes evenly. */}
			<div className="relative flex flex-1 flex-col items-center justify-center">
				<Dial
					state={state}
					progress={progress}
					rewinding={rewinding}
					lapKey={lapAt}
					pulseKey={fresh ? status.lastActionAt : null}
				>
					<Buddy mood={mood} tone={tone} />
					<div key={state} className="mt-3 flex flex-col items-center">
						{state === "active" ? (
							<>
								{/* Keyed per wait: each new countdown slot-spins in. */}
								<span key={status.waitStartedAt} className="animate-swap" style={{ ["--d" as string]: "120ms" }}>
									<span className={`inline-block ${lapDone ? "animate-lap-pop" : ""}`}>
										<Rolling
											spin
											text={mmss(remaining)}
											className="tabular font-mono text-[44px] font-light tracking-[-0.04em]"
										/>
									</span>
								</span>
								<div className="animate-swap mt-2 text-[11.5px] text-ink-3" style={{ ["--d" as string]: "320ms" }}>
									until next move
								</div>
							</>
						) : state === "paused" && pause ? (
							<>
								<div
									key={pause.title}
									className="animate-swap max-w-[150px] truncate text-center text-[17px] font-semibold tracking-[-0.02em]"
									style={{ ["--d" as string]: "100ms" }}
								>
									{pause.title}
								</div>
								{pause.detail ? (
									<div className="animate-swap tabular mt-1 font-mono text-[11.5px] text-ink-3" style={{ ["--d" as string]: "220ms" }}>
										{pause.detail}
									</div>
								) : null}
							</>
						) : (
							<>
								<div className="animate-swap text-[24px] font-semibold tracking-[-0.035em]" style={{ ["--d" as string]: "100ms" }}>
									Ready
								</div>
								<div className="animate-swap mt-1 text-center text-[11.5px] leading-[1.45] text-ink-3" style={{ ["--d" as string]: "220ms" }}>
									Moves after {minutesLabel(settings.idleThresholdMs)} idle
								</div>
							</>
						)}
					</div>
				</Dial>

				{/* Narration */}
				<div className="mt-4 flex h-6 items-center justify-center">
					{state === "active" && status.lastActionAt ? (
						<span
							key={status.lastActionAt}
							className={`animate-swap inline-flex items-center gap-1.5 text-[12.5px] ${fresh ? "text-ink" : "text-ink-2"}`}
						>
							<span className={`h-1.5 w-1.5 rounded-full transition-colors duration-700 ${fresh ? "bg-accent" : "bg-ink/25"}`} />
							<span className="font-medium">{narrate(status.lastRoutine, status.lastApp)}</span>
							<span className="text-ink-3">· {ago(status.lastActionAt)}</span>
						</span>
					) : (
						<span key={`${state}-hint`} className="animate-swap text-[12.5px] text-ink-3" style={{ ["--d" as string]: "440ms" }}>
							{state === "active"
								? "Holding the fort until you step away"
								: state === "paused"
									? "Back on duty as soon as this clears"
									: "Asleep until you press Space"}
						</span>
					)}
				</div>
			</div>

			<div className="space-y-4">
				{/* The plan takes the trace's place while there is one; before a
				    session, so does the input that makes it. */}
				{planner.plan ? (
					<PlanCard
						plan={planner.plan}
						done={planner.done}
						autoStopAt={status.enabled ? status.autoStopAt : null}
						onToggleStep={planner.onToggleStep}
						onClear={status.enabled ? null : () => planner.onPlan(null)}
					/>
				) : planner.available && !status.enabled ? (
					<PlanInput draft={planner.draft} onDraft={planner.onDraft} onPlan={planner.onPlan} />
				) : (
					<Trace recent={status.recent} active={state === "active"} />
				)}

				<div className="flex min-h-7 flex-wrap items-center gap-1.5">
					{status.enabled && settings.preventSystemSleep ? (
						status.sleepGuard === "on" ? (
							<Chip icon="moon" tone="accent" index={0}>Sleep blocked</Chip>
						) : status.sleepGuard === "pending" ? (
							<Chip icon="moon">Waiting for permission…</Chip>
						) : status.sleepGuard === "failed" ? (
							<Chip icon="moon" tone="warn" onClick={() => void retrySleepGuard()}>
								Sleep block failed · Retry
							</Chip>
						) : null
					) : null}
					{status.enabled && status.autoStopAt ? (
						<Chip icon="timer" index={1}>{duration(status.autoStopAt - now)} left</Chip>
					) : null}
					{status.enabled && settings.actionType === "natural" && settings.learnRhythm && rhythm?.ready ? (
						<Chip icon="wave" tone="accent" index={2}>Your rhythm</Chip>
					) : null}
					{!status.enabled ? (
						<span className="animate-swap text-[11.5px] text-ink-3" style={{ ["--d" as string]: "300ms" }}>
							{settings.preventSystemSleep
								? "Blocks system sleep while running"
								: "Keeps the display awake while running"}
						</span>
					) : null}
				</div>

				<div className="flex gap-2">
					<button
						onClick={onToggle}
						disabled={busy}
						className={`press group relative flex h-[52px] flex-1 items-center justify-center overflow-hidden rounded-[16px] text-[14.5px] font-semibold tracking-[-0.01em] disabled:opacity-50 ${
							status.enabled
								? "bg-ink/[0.07] text-ink hover:bg-ink/[0.1]"
								: "bg-accent text-accent-ink shadow-[0_10px_30px_-12px_rgb(var(--accent)/0.8),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105"
						}`}
					>
						<span key={status.enabled ? "end" : "start"} className="animate-swap flex items-center gap-2">
							<Icon name={status.enabled ? "stop" : "play"} size={16} />
							{status.enabled
								? "End session"
								: planner.plan
									? `Start ${minutesLabel(planAutoStopMs(planner.plan))} session`
									: "Start session"}
						</span>
						<span
							className={`kbd absolute right-3.5 transition-colors duration-300 ${
								status.enabled ? "bg-ink/[0.08] text-ink-3" : "bg-black/10 text-accent-ink/70"
							}`}
						>
							Space
						</span>
					</button>
					<button
						onClick={onMoveNow}
						disabled={moving}
						title="Move now (R)"
						aria-label="Move now"
						className="press flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-ink/[0.07] text-ink-2 hover:bg-ink/[0.1] hover:text-ink disabled:opacity-60"
					>
						<Icon name="nudge" size={20} className={moving ? "animate-wiggle text-accent" : ""} />
					</button>
				</div>
			</div>
		</div>
	);
}
