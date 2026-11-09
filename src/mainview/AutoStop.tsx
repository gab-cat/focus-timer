import { useEffect, useRef, useState } from "react";
import {
	atLabel,
	autoStopMode,
	type AutoStopMode,
	duration,
	MAX_AUTO_STOP_MS,
	plannedStopAt,
	suggestClockTime,
} from "../shared/time";
import type { JigglerStatus, Settings } from "../shared/types";
import { updateSettings } from "./rpc";
import { Segmented } from "./ui";

const PRESETS = [30, 60, 120, 240];
const MAX_MINUTES = MAX_AUTO_STOP_MS / 60_000;

const presetLabel = (m: number) => (m < 60 ? `${m}m` : `${m / 60}h`);

// When the session will (or would) stop, for the line under the controls.
export function stopEstimate(settings: Settings, status: JigglerStatus, now: number): string {
	if (status.enabled) {
		if (status.autoStopAt == null) return "Runs until you end it.";
		return `Stops ${atLabel(status.autoStopAt, now)}, ${duration(status.autoStopAt - now)} from now.`;
	}
	const at = plannedStopAt(settings, now);
	if (at == null) return "Runs until you end it.";
	return `Starting now, it stops ${atLabel(at, now)}.`;
}

export function AutoStopModePicker({ settings }: { settings: Settings }) {
	const mode = autoStopMode(settings);
	// Remember what was picked before switching modes, so Off → After → Off → After
	// comes back to the same value.
	const lastMs = useRef(settings.autoStopMs ?? 60 * 60_000);
	const lastTime = useRef(settings.autoStopTime);
	if (settings.autoStopMs) lastMs.current = settings.autoStopMs;
	if (settings.autoStopTime) lastTime.current = settings.autoStopTime;

	function pick(next: AutoStopMode) {
		if (next === mode) return;
		if (next === "off") void updateSettings({ autoStopMs: null, autoStopTime: null });
		else if (next === "after") void updateSettings({ autoStopMs: lastMs.current, autoStopTime: null });
		else void updateSettings({ autoStopMs: null, autoStopTime: lastTime.current ?? suggestClockTime() });
	}

	return (
		<Segmented
			size="sm"
			label="Auto-stop"
			value={mode}
			onChange={pick}
			options={[
				{ value: "off" as AutoStopMode, label: "Off" },
				{ value: "after" as AutoStopMode, label: "After" },
				{ value: "at" as AutoStopMode, label: "At a time" },
			]}
		/>
	);
}

// The "after N minutes" or "at HH:MM" control for the current mode.
export function AutoStopValue({ settings, autoFocus }: { settings: Settings; autoFocus?: boolean }) {
	const mode = autoStopMode(settings);
	if (mode === "after") return <DurationField ms={settings.autoStopMs ?? 0} autoFocus={autoFocus} />;
	if (mode === "at") return <TimeField value={settings.autoStopTime ?? ""} autoFocus={autoFocus} />;
	return null;
}

function DurationField({ ms, autoFocus }: { ms: number; autoFocus?: boolean }) {
	const minutes = Math.round(ms / 60_000);
	const [draft, setDraft] = useState(String(minutes));
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);

	// Follow outside changes (a preset, the other window) unless mid-edit.
	useEffect(() => {
		if (!editing) setDraft(String(minutes));
	}, [minutes, editing]);

	function commit() {
		const n = Number(draft.trim());
		if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) {
			setError(`Enter whole minutes from 1 to ${MAX_MINUTES}.`);
			return false;
		}
		setError(null);
		if (n !== minutes) void updateSettings({ autoStopMs: n * 60_000, autoStopTime: null });
		return true;
	}

	return (
		<div>
			<div className="flex flex-wrap items-center gap-1.5">
				{PRESETS.map((m) => (
					<button
						key={m}
						type="button"
						aria-pressed={m === minutes}
						onClick={() => {
							setError(null);
							setEditing(false);
							void updateSettings({ autoStopMs: m * 60_000, autoStopTime: null });
						}}
						className={`press h-[28px] rounded-[7px] px-2.5 text-[12px] font-medium ${
							m === minutes ? "bg-accent/15 text-ink" : "bg-ink/[0.05] text-ink hover:bg-ink/[0.09]"
						}`}
					>
						{presetLabel(m)}
					</button>
				))}
				<label
					className={`ml-auto flex h-[28px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] transition-colors ${
						error
							? "bg-danger/10 ring-1 ring-inset ring-danger/50"
							: PRESETS.includes(minutes)
								? "bg-ink/[0.05] focus-within:bg-ink/[0.08]"
								: "bg-accent/15 focus-within:bg-accent/20"
					}`}
				>
					<span className="sr-only">Custom minutes</span>
					<input
						ref={input}
						autoFocus={autoFocus}
						inputMode="numeric"
						aria-invalid={error != null}
						aria-describedby={error ? "autostop-error" : undefined}
						value={draft}
						onFocus={(e) => {
							setEditing(true);
							e.currentTarget.select();
						}}
						onChange={(e) => {
							setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 4));
							setError(null);
						}}
						onBlur={() => {
							if (commit()) setEditing(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								if (commit()) input.current?.blur();
							} else if (e.key === "Escape") {
								setDraft(String(minutes));
								setError(null);
								setEditing(false);
								// Let the popover close on a second Escape.
								if (draft !== String(minutes)) e.stopPropagation();
							}
						}}
						className="tabular w-[38px] bg-transparent text-right font-mono text-[12.5px] text-ink outline-none"
					/>
					<span className="text-ink">min</span>
				</label>
			</div>
			{error ? (
				<div id="autostop-error" role="alert" className="animate-swap mt-1.5 text-[11.5px] text-danger">
					{error}
				</div>
			) : null}
		</div>
	);
}

function TimeField({ value, autoFocus }: { value: string; autoFocus?: boolean }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<label className="flex items-center gap-2 text-[12.5px] text-ink">
			<span>Stop at</span>
			<input
				type="time"
				autoFocus={autoFocus}
				required
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					// WebKit reports "" while a segment is half typed; wait for a full time.
					if (/^\d{2}:\d{2}$/.test(e.target.value)) {
						void updateSettings({ autoStopTime: e.target.value, autoStopMs: null });
					}
				}}
				className="tabular h-[28px] rounded-[7px] bg-ink/[0.05] px-2 font-mono text-[12.5px] text-ink outline-none transition-colors focus:bg-ink/[0.08] focus-visible:ring-2 focus-visible:ring-accent/60"
			/>
			<span className="text-[11.5px] text-ink-3">Your local time</span>
		</label>
	);
}
