import type { Stats } from "../shared/types";

function last7Days(stats: Stats): Array<{ date: string; count: number }> {
	const days: Array<{ date: string; count: number }> = [];
	const now = new Date();
	for (let i = 6; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const m = (d.getMonth() + 1).toString().padStart(2, "0");
		const day = d.getDate().toString().padStart(2, "0");
		const key = `${d.getFullYear()}-${m}-${day}`;
		const count =
			key === stats.today.date ? stats.today.count : stats.history[key] || 0;
		days.push({ date: key, count });
	}
	return days;
}

export function Stats({ stats }: { stats: Stats }) {
	const days = last7Days(stats);
	const max = Math.max(1, ...days.map((d) => d.count));
	const barWidth = 8;
	const gap = 2;
	const width = days.length * (barWidth + gap) - gap;
	const height = 16;

	return (
		<div className="flex items-center justify-between gap-3 text-[10px] text-neutral-500 dark:text-neutral-500">
			<div className="font-mono">
				Today <span className="text-neutral-700 dark:text-neutral-300">{stats.today.count}</span>
				<span className="mx-1.5 opacity-40">·</span>
				All-time <span className="text-neutral-700 dark:text-neutral-300">{stats.totalActions}</span>
			</div>
			<svg width={width} height={height} aria-label="7-day activity">
				{days.map((d, i) => {
					const h = Math.round((d.count / max) * height);
					return (
						<rect
							key={d.date}
							x={i * (barWidth + gap)}
							y={height - h}
							width={barWidth}
							height={h || 1}
							className="fill-neutral-700 dark:fill-neutral-600"
						/>
					);
				})}
			</svg>
		</div>
	);
}
