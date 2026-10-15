import { useState } from "react";
import type { SessionPlan } from "../shared/types";
import { clock, minutesLabel } from "./format";
import { planSession } from "./rpc";
import { Icon } from "./ui";

// Planned length in ms, trimmed if the meeting it was fitted around has
// moved closer since planning.
export function planAutoStopMs(plan: SessionPlan): number {
	let ms = plan.minutes * 60_000;
	if (plan.endsBefore) ms = Math.min(ms, plan.endsBefore.start - Date.now() - 2 * 60_000);
	return Math.max(60_000, ms);
}

function Header({ left, right }: { left: string; right: React.ReactNode }) {
	return (
		<div className="mb-2 flex items-baseline justify-between">
			<span className="text-[12px] font-medium text-ink-2">{left}</span>
			<span className="font-mono text-[11px] text-ink-3">{right}</span>
		</div>
	);
}

// "What are you working on?" → Apple Intelligence → a plan.
export function PlanInput({
	draft,
	onDraft,
	onPlan,
}: {
	draft: string;
	onDraft: (text: string) => void;
	onPlan: (plan: SessionPlan) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (busy || !draft.trim()) return;
		setBusy(true);
		setError(null);
		try {
			const result = await planSession(draft);
			if (result.ok) onPlan(result.plan);
			else setError(result.error);
		} catch {
			setError("Couldn't reach Apple Intelligence. Try again.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={submit} className="animate-swap" style={{ ["--d" as string]: "200ms" }}>
			<Header left="Plan a session" right="Apple Intelligence" />
			<label
				className={`flex h-11 items-center gap-2.5 rounded-[14px] bg-ink/[0.05] px-3.5 ring-1 ring-transparent transition-shadow duration-300 focus-within:ring-accent/50 dark:bg-ink/[0.06] ${
					busy ? "opacity-70" : ""
				}`}
			>
				<Icon name="spark" size={16} className={busy ? "animate-pulse text-accent" : "text-accent"} />
				<input
					value={draft}
					onChange={(e) => onDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") (e.target as HTMLInputElement).blur();
					}}
					disabled={busy}
					maxLength={400}
					placeholder="What are you working on?"
					aria-label="What are you working on?"
					className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:rounded-none focus-visible:outline-none"
				/>
				{busy ? (
					<span className="animate-pulse text-[11.5px] text-ink-3">Planning…</span>
				) : draft.trim() ? (
					<span className="kbd bg-ink/[0.08] text-ink-3">Return</span>
				) : null}
			</label>
			<div className={`mt-1.5 h-4 truncate text-[11px] ${error ? "text-warn" : "text-ink-3"}`}>
				{error ?? "Turns into a length and a checklist, on your Mac"}
			</div>
		</form>
	);
}

export function PlanCard({
	plan,
	done,
	autoStopAt,
	onToggleStep,
	onClear,
}: {
	plan: SessionPlan;
	done: boolean[];
	// Set while the planned session is running.
	autoStopAt: number | null;
	onToggleStep: (i: number) => void;
	onClear: (() => void) | null;
}) {
	const finished = done.filter(Boolean).length;
	const right = autoStopAt
		? `${finished}/${plan.steps.length} · ends ${clock(autoStopAt)}`
		: plan.endsBefore
			? `${minutesLabel(planAutoStopMs(plan))} · before ${clock(plan.endsBefore.start)}`
			: minutesLabel(plan.minutes * 60_000);

	return (
		<div className="animate-swap">
			<Header left="Plan" right={right} />
			<div className="rounded-[14px] bg-ink/[0.04] px-3.5 py-3 dark:bg-ink/[0.05]">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="truncate text-[14px] font-semibold tracking-[-0.01em]">{plan.title}</div>
						{plan.endsBefore && !autoStopAt ? (
							<div className="mt-0.5 truncate text-[11px] text-ink-3">
								Ends before {plan.endsBefore.title}
							</div>
						) : null}
					</div>
					{onClear ? (
						<button
							onClick={onClear}
							aria-label="Clear plan"
							title="Clear plan"
							className="press -mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-ink/[0.08] hover:text-ink"
						>
							<svg viewBox="0 0 20 20" width={12} height={12} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
								<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
							</svg>
						</button>
					) : null}
				</div>
				<ul className="mt-2 space-y-0.5">
					{plan.steps.map((step, i) => (
						<li key={i}>
							<button
								onClick={() => onToggleStep(i)}
								role="checkbox"
								aria-checked={done[i] ?? false}
								className="press-soft flex min-h-[22px] w-full items-center gap-2 text-left text-[12.5px]"
							>
								<span
									className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
										done[i] ? "bg-accent text-accent-ink" : "ring-1 ring-inset ring-ink/25"
									}`}
								>
									{done[i] ? <Icon name="check" size={10} /> : null}
								</span>
								<span
									className={`truncate transition-colors duration-300 ${
										done[i] ? "text-ink-3 line-through" : "text-ink-2"
									}`}
								>
									{step}
								</span>
							</button>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
