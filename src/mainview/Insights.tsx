import { useState } from "react";
import { ACTION_TYPES, type Stats } from "../shared/types";
import { routineLabel } from "./format";
import { Buddy } from "./Buddy";
import { Icon, useCountUp } from "./ui";

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

function Heatmap({ stats }: { stats: Stats }) {
	const [hover, setHover] = useState<{ day: string; hour: number; v: number } | null>(null);
	const days = lastDays(7);
	const data = stats.hourly;
	const max = Math.max(1, ...days.flatMap((d) => data[d.key] ?? []));

	let peak: { day: string; hour: number; v: number } | null = null;
	for (const d of days) {
		const row = data[d.key] ?? [];
		for (let hour = 0; hour < row.length; hour++) {
			const v = row[hour];
			if (v > 0 && (peak == null || v > peak.v)) peak = { day: d.label, hour, v };
		}
	}
	const unit = "moves";
	const shown = hover ?? peak;
	const hh = (h: number) => `${h.toString().padStart(2, "0")}:00`;

	return (
		<div className="panel animate-rise p-4" style={{ ["--i" as string]: 1 }}>
			<div className="mb-3.5 flex items-baseline justify-between">
				<h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">When it happens</h2>
				<span className="text-[11.5px] text-ink-3">Last 7 days</span>
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
								key={`${d.key}-${hour}`}
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
	// Only the current actions; counts from older modes stay in the file but aren't shown.
	const entries = Object.entries(stats.routines)
		.filter(([name, n]) => (ACTION_TYPES as string[]).includes(name) && n > 0)
		.sort((a, b) => b[1] - a[1]);
	const total = entries.reduce((s, [, n]) => s + n, 0);
	return (
		<div className="panel animate-rise p-4" style={{ ["--i" as string]: 2 }}>
			<div className="mb-3 flex items-baseline justify-between">
				<h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">Mix</h2>
				<span className="text-[11.5px] text-ink-3">By action</span>
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

export function Insights({ stats }: { stats: Stats }) {
	const days = lastDays(7);
	const week = days.reduce(
		(s, d) => s + (d.key === stats.today.date ? stats.today.count : stats.history[d.key] ?? 0),
		0,
	);

	return (
		<div className="no-scrollbar h-full space-y-3 overflow-y-auto px-5 pb-6">
			<div className="panel flex divide-x divide-line/70">
				<Total label="Today" value={stats.today.count} index={0} />
				<Total label="Last 7 days" value={week} index={1} />
				<Total label="All time" value={stats.totalActions} index={2} />
			</div>
			<Heatmap stats={stats} />
			<Mix stats={stats} />
			<p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-ink-3">
				<Icon name="lock" size={12} />
				Everything here stays on this Mac
			</p>
		</div>
	);
}
