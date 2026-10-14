import { useState } from "react";
import type { RhythmInfo, Settings, Stats } from "../shared/types";
import { ago, routineLabel } from "./format";
import { resetRhythm, updateSettings } from "./rpc";
import { Buddy } from "./Buddy";
import { Icon, LinkButton, Segmented, Toggle, useCountUp, useMounted } from "./ui";

const DAY = 86_400_000;

function dateKey(d: Date) {
	const m = (d.getMonth() + 1).toString().padStart(2, "0");
	const day = d.getDate().toString().padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

function lastDays(n: number) {
	const out: Array<{ key: string; label: string }> = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(Date.now() - i * DAY);
		out.push({
			key: dateKey(d),
			label: i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" }),
		});
	}
	return out;
}

function Total({ label, value, index }: { label: string; value: number; index: number }) {
	const shown = useCountUp(value, 900 + index * 150);
	return (
		<div className="animate-rise flex-1 px-4 py-3.5" style={{ ["--i" as string]: index }}>
			<div className="tabular font-mono text-[26px] font-light leading-none tracking-[-0.04em]">
				{shown.toLocaleString()}
			</div>
			<div className="label mt-2">{label}</div>
		</div>
	);
}

const LEVELS = [0.2, 0.42, 0.68, 1];

function Heatmap({ stats, hasYou }: { stats: Stats; hasYou: boolean }) {
	const [series, setSeries] = useState<"app" | "you">("app");
	const [hover, setHover] = useState<{ day: string; hour: number; v: number } | null>(null);
	const days = lastDays(7);
	const data = series === "app" ? stats.hourly : stats.userHourly;
	const max = Math.max(1, ...days.flatMap((d) => data[d.key] ?? []));

	let peak: { day: string; hour: number; v: number } | null = null;
	for (const d of days) {
		const row = data[d.key] ?? [];
		for (let hour = 0; hour < row.length; hour++) {
			const v = row[hour];
			if (v > 0 && (peak == null || v > peak.v)) peak = { day: d.label, hour, v };
		}
	}
	const unit = series === "app" ? "moves" : "active min";
	const shown = hover ?? peak;
	const hh = (h: number) => `${h.toString().padStart(2, "0")}:00`;

	return (
		<div className="panel animate-rise p-4" style={{ ["--i" as string]: 1 }}>
			<div className="mb-3.5 flex items-center justify-between">
				<h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">When it happens</h2>
				<Segmented
					size="sm"
					label="Heatmap series"
					value={series}
					onChange={setSeries}
					options={[
						{ value: "app", label: "Focus Timer" },
						{
							value: "you",
							label: "You",
							disabled: !hasYou,
							title: hasYou ? undefined : "Turn on Learn my rhythm to see your own activity",
						},
					]}
				/>
			</div>

			{/* One grid so day labels, hour labels and cells line up exactly. */}
			<div
				className="grid gap-[3px]"
				style={{ gridTemplateColumns: "38px repeat(24, minmax(0, 1fr))", gridAutoRows: "12px" }}
				onMouseLeave={() => setHover(null)}
			>
				<span />
				{Array.from({ length: 24 }, (_, h) => (
					<span key={h} className="font-mono text-[9.5px] leading-3 text-ink-3">
						{h % 6 === 0 ? hh(h).slice(0, 2) : ""}
					</span>
				))}
				{days.map((d) => [
					<span key={`${d.key}-label`} className="text-[10.5px] leading-3 text-ink-3">
						{d.label}
					</span>,
					...Array.from({ length: 24 }, (_, hour) => {
						const di = days.indexOf(d);
						const v = data[d.key]?.[hour] ?? 0;
						const level = v === 0 ? -1 : Math.min(3, Math.floor((v / max) * 3.999));
						const isHover = hover?.day === d.label && hover.hour === hour;
						return (
							<span
								key={`${series}-${d.key}-${hour}`}
								onMouseEnter={() => setHover({ day: d.label, hour, v })}
								className="animate-cell"
								// Diagonal wave: left-to-right, top-to-bottom.
								style={{ animationDelay: `${hour * 14 + di * 30}ms` }}
							>
								<span
									className="block h-full w-full rounded-[3px] transition-[transform,background-color] duration-300 ease-spring"
									style={{
										transform: isHover ? "scale(1.4)" : undefined,
										backgroundColor: level < 0 ? "rgb(var(--ink) / 0.06)" : `rgb(var(--accent) / ${LEVELS[level]})`,
									}}
								/>
							</span>
						);
					}),
				])}
			</div>

			<div className="mt-3.5 flex items-center justify-between text-[11.5px]">
				<span className="tabular text-ink-2">
					{shown ? (
						<>
							{hover ? "" : "Busiest · "}
							{shown.day} {hh(shown.hour)}
							<span className="text-ink-3">
								{" "}
								— {shown.v} {unit}
							</span>
						</>
					) : (
						<span className="text-ink-3">Nothing recorded yet</span>
					)}
				</span>
				<span className="flex items-center gap-1 text-ink-3">
					less
					{[-1, 0, 1, 2, 3].map((l) => (
						<span
							key={l}
							className="h-2.5 w-2.5 rounded-[3px]"
							style={{
								backgroundColor: l < 0 ? "rgb(var(--ink) / 0.06)" : `rgb(var(--accent) / ${LEVELS[l]})`,
							}}
						/>
					))}
					more
				</span>
			</div>
		</div>
	);
}

const MIX_ALPHA = [1, 0.72, 0.52, 0.38, 0.27, 0.19, 0.13, 0.09];

function Mix({ stats }: { stats: Stats }) {
	const entries = Object.entries(stats.routines).sort((a, b) => b[1] - a[1]);
	const total = entries.reduce((s, [, n]) => s + n, 0);
	return (
		<div className="panel animate-rise p-4" style={{ ["--i" as string]: 2 }}>
			<div className="mb-3 flex items-baseline justify-between">
				<h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">Mix</h2>
				<span className="text-[11.5px] text-ink-3">No two moves in a row repeat</span>
			</div>
			{total === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-xl bg-ink/[0.03] px-3 pb-4 pt-6 text-center">
					<Buddy mood="sleep" tone="--ink-3" />
					<span className="text-[12px] text-ink-3">Nothing yet. Start a session and the mix fills in.</span>
				</div>
			) : (
				<>
					<div className="animate-reveal flex h-2.5 gap-[2px] overflow-hidden rounded-full">
						{entries.map(([name, n], i) => (
							<span
								key={name}
								className="h-full transition-all duration-700 ease-out first:rounded-l-full last:rounded-r-full"
								style={{
									width: `${(n / total) * 100}%`,
									backgroundColor: `rgb(var(--accent) / ${MIX_ALPHA[Math.min(i, MIX_ALPHA.length - 1)]})`,
								}}
							/>
						))}
					</div>
					<div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-2">
						{entries.map(([name, n], i) => (
							<div key={name} className="flex items-center gap-2 text-[12.5px]">
								<span
									className="h-2 w-2 rounded-[2px]"
									style={{ backgroundColor: `rgb(var(--accent) / ${MIX_ALPHA[Math.min(i, MIX_ALPHA.length - 1)]})` }}
								/>
								<span className="flex-1 text-ink-2">{routineLabel(name)}</span>
								<span className="tabular font-mono text-[11.5px] text-ink-3">
									{((n / total) * 100).toFixed(n / total < 0.1 ? 1 : 0)}%
								</span>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function Ring({ value }: { value: number }) {
	const mounted = useMounted();
	const r = 17;
	const len = 2 * Math.PI * r;
	const done = value >= 1;
	return (
		<div className="relative shrink-0">
		<span className="absolute inset-0 flex items-center justify-center">
			{done ? (
				<Icon name="check" size={16} className="text-accent" />
			) : (
				<span className="tabular font-mono text-[10px] text-ink-2">{Math.round(Math.min(1, value) * 100)}%</span>
			)}
		</span>
		<svg width={42} height={42} viewBox="0 0 42 42">
			<circle cx={21} cy={21} r={r} fill="none" strokeWidth={3} style={{ stroke: "rgb(var(--ink) / 0.08)" }} />
			<circle
				cx={21}
				cy={21}
				r={r}
				fill="none"
				strokeWidth={3}
				strokeLinecap="round"
				transform="rotate(-90 21 21)"
				strokeDasharray={len}
				strokeDashoffset={len * (1 - (mounted ? Math.min(1, value) : 0))}
				style={{ stroke: "rgb(var(--accent))", transition: "stroke-dashoffset 1200ms cubic-bezier(0.22,1,0.36,1)" }}
			/>
		</svg>
		</div>
	);
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
	return (
		<div className="rounded-xl bg-ink/[0.04] px-3 py-2.5">
			<div className="label">{label}</div>
			<div className="tabular mt-1 font-mono text-[15px] tracking-[-0.02em]">
				{value}
				{unit ? <span className="ml-0.5 text-[11px] text-ink-3">{unit}</span> : null}
			</div>
		</div>
	);
}

function Rhythm({ rhythm, settings }: { rhythm: RhythmInfo | null; settings: Settings }) {
	const [confirm, setConfirm] = useState(false);
	const on = settings.learnRhythm;
	const progress = rhythm ? rhythm.strokes / rhythm.target : 0;
	const state = !on ? "Off" : rhythm?.ready ? "In use" : "Learning";

	return (
		<div className="panel animate-rise p-4" style={{ ["--i" as string]: 3 }}>
			<div className="flex items-start gap-3">
				<Ring value={on || rhythm?.ready ? progress : 0} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">Your rhythm</h2>
						<span
							className={`rounded-[5px] px-1.5 py-[1px] text-[10.5px] font-semibold ${
								state === "In use"
									? "bg-accent/15 text-accent"
									: state === "Learning"
										? "bg-ink/[0.07] text-ink-2"
										: "bg-ink/[0.05] text-ink-3"
							}`}
						>
							{state}
						</span>
					</div>
					<p className="mt-1 text-[12px] leading-[1.45] text-ink-3 [text-wrap:pretty]">
						{rhythm?.ready
							? "Natural mode now moves with your distances, timing and pauses."
							: on
								? `Keep working normally. ${Math.max(0, (rhythm?.target ?? 80) - (rhythm?.strokes ?? 0))} more mouse moves to go.`
								: "Learns how you move: distances, speed, pauses. Never keys or what's on screen. Stays on this Mac."}
					</p>
				</div>
				<Toggle
					label="Learn my rhythm"
					value={on}
					onChange={(v) => void updateSettings({ learnRhythm: v })}
				/>
			</div>

			{rhythm && (rhythm.medianNudgePx || rhythm.fitts || rhythm.mix) ? (
				<div className="mt-3.5 grid grid-cols-2 gap-2">
					<Metric label="Small move" value={rhythm.medianNudgePx ? String(rhythm.medianNudgePx) : "—"} unit="px" />
					<Metric label="Reach" value={rhythm.medianReachPx ? String(rhythm.medianReachPx) : "—"} unit="px" />
					<Metric
						label="Move timing"
						value={rhythm.fitts ? `${rhythm.fitts.a}+${rhythm.fitts.b}` : "—"}
						unit={rhythm.fitts ? "ms/bit" : undefined}
					/>
					<Metric
						label="Mouse · scroll · keys"
						value={
							rhythm.mix
								? `${Math.round(rhythm.mix.mouse * 100)}·${Math.round(rhythm.mix.scroll * 100)}·${Math.round(rhythm.mix.keys * 100)}`
								: "—"
						}
						unit={rhythm.mix ? "%" : undefined}
					/>
				</div>
			) : null}

			<div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-3">
				<span>
					{rhythm?.strokes ?? 0} moves · {rhythm?.scrollPauses ?? 0} scroll pauses
					{rhythm?.updatedAt ? ` · ${ago(rhythm.updatedAt)}` : ""}
				</span>
				{confirm ? (
					<span className="flex gap-3">
						<LinkButton onClick={() => setConfirm(false)}>Keep</LinkButton>
						<LinkButton
							tone="danger"
							onClick={() => {
								void resetRhythm();
								setConfirm(false);
							}}
						>
							Forget it
						</LinkButton>
					</span>
				) : (
					<LinkButton onClick={() => setConfirm(true)} disabled={!rhythm?.strokes}>
						Reset
					</LinkButton>
				)}
			</div>
		</div>
	);
}

export function Insights({
	stats,
	rhythm,
	settings,
}: {
	stats: Stats;
	rhythm: RhythmInfo | null;
	settings: Settings;
}) {
	const days = lastDays(7);
	const week = days.reduce(
		(s, d) => s + (d.key === stats.today.date ? stats.today.count : stats.history[d.key] ?? 0),
		0,
	);
	const hasYou = Object.values(stats.userHourly).some((row) => row.some((v) => v > 0));

	return (
		<div className="no-scrollbar h-full space-y-3 overflow-y-auto px-5 pb-6">
			<div className="panel flex divide-x divide-line/70">
				<Total label="Today" value={stats.today.count} index={0} />
				<Total label="Last 7 days" value={week} index={1} />
				<Total label="All time" value={stats.totalActions} index={2} />
			</div>
			<Heatmap stats={stats} hasYou={hasYou} />
			<Mix stats={stats} />
			<Rhythm rhythm={rhythm} settings={settings} />
			<p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-ink-3">
				<Icon name="lock" size={12} />
				Everything here stays on this Mac
			</p>
		</div>
	);
}
