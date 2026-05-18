import { useState } from "react";
import type { ActionType, Settings as SettingsType, ThemePref } from "../shared/types";
import { resetStats, updateSettings } from "./rpc";

type Preset = "subtle" | "normal" | "aggressive" | "custom";

function presetFor(s: SettingsType): Preset {
	if (s.minDelayMs === 180_000 && s.maxDelayMs === 300_000 && s.idleThresholdMs === 300_000)
		return "subtle";
	if (s.minDelayMs === 90_000 && s.maxDelayMs === 180_000 && s.idleThresholdMs === 120_000)
		return "normal";
	if (s.minDelayMs === 30_000 && s.maxDelayMs === 60_000 && s.idleThresholdMs === 30_000)
		return "aggressive";
	return "custom";
}

const PRESET_VALUES: Record<Exclude<Preset, "custom">, Partial<SettingsType>> = {
	subtle: { minDelayMs: 180_000, maxDelayMs: 300_000, idleThresholdMs: 300_000 },
	normal: { minDelayMs: 90_000, maxDelayMs: 180_000, idleThresholdMs: 120_000 },
	aggressive: { minDelayMs: 30_000, maxDelayMs: 60_000, idleThresholdMs: 30_000 },
};

const ACTION_OPTIONS: Array<{ value: ActionType; label: string; hint: string }> = [
	{ value: "cmdtab", label: "Cmd+Tab", hint: "Cycles apps. Most reliable." },
	{ value: "mouse", label: "Mouse only", hint: "Tiny cursor move. No focus change." },
	{ value: "scroll", label: "Scroll wheel", hint: "One up, one down." },
	{ value: "shift", label: "Shift tap", hint: "Single key press. Silent." },
];

const AUTO_STOP_OPTIONS: Array<{ value: number | null; label: string }> = [
	{ value: null, label: "Off" },
	{ value: 30 * 60_000, label: "30 min" },
	{ value: 60 * 60_000, label: "1 hour" },
	{ value: 2 * 60 * 60_000, label: "2 hours" },
	{ value: 4 * 60 * 60_000, label: "4 hours" },
];

const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
	{ value: "auto", label: "Auto" },
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
];

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-500">
				{label}
			</span>
			<div className="flex items-center gap-1">{children}</div>
		</div>
	);
}

function SegBtn({
	active,
	onClick,
	children,
	title,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	title?: string;
}) {
	return (
		<button
			onClick={onClick}
			title={title}
			className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
				active
					? "bg-neutral-200 text-neutral-900 dark:bg-neutral-100 dark:text-neutral-900"
					: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
			}`}
		>
			{children}
		</button>
	);
}

function Toggle({
	value,
	onChange,
}: {
	value: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<button
			onClick={() => onChange(!value)}
			className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors ${
				value ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
			}`}
			aria-pressed={value}
		>
			<span
				className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
					value ? "translate-x-4" : "translate-x-0"
				}`}
			/>
		</button>
	);
}

export function Settings({ settings, onClose }: { settings: SettingsType; onClose: () => void }) {
	const preset = presetFor(settings);
	const [confirmingReset, setConfirmingReset] = useState(false);

	function patch(p: Partial<SettingsType>) {
		void updateSettings(p);
	}

	return (
		<div className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden">
			<div className="flex items-center justify-between px-6 pt-5 pb-3">
				<span className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-500">
					Settings
				</span>
				<button
					onClick={onClose}
					className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
				>
					Done
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-6 pb-5 space-y-4">
				<Row label="Interval">
					{(["subtle", "normal", "aggressive"] as const).map((p) => (
						<SegBtn
							key={p}
							active={preset === p}
							onClick={() => patch(PRESET_VALUES[p])}
						>
							{p[0].toUpperCase() + p.slice(1)}
						</SegBtn>
					))}
					{preset === "custom" ? (
						<SegBtn active onClick={() => {}} title="Edit settings.json for custom values">
							Custom
						</SegBtn>
					) : null}
				</Row>

				<div>
					<div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-500 mb-2">
						Action
					</div>
					<div className="grid grid-cols-2 gap-1">
						{ACTION_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								onClick={() => patch({ actionType: opt.value })}
								title={opt.hint}
								className={`text-left px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
									settings.actionType === opt.value
										? "bg-neutral-200 text-neutral-900 dark:bg-neutral-100 dark:text-neutral-900"
										: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
				</div>

				<div>
					<div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-500 mb-2">
						Pause when
					</div>
					<div className="space-y-1.5">
						<Row label="On battery">
							<Toggle value={settings.pauseOnBattery} onChange={(v) => patch({ pauseOnBattery: v })} />
						</Row>
						<Row label="On a call">
							<Toggle value={settings.pauseOnCall} onChange={(v) => patch({ pauseOnCall: v })} />
						</Row>
						<Row label="Screen locked">
							<Toggle value={settings.pauseOnLock} onChange={(v) => patch({ pauseOnLock: v })} />
						</Row>
					</div>
				</div>

				<Row label="Auto-stop">
					<select
						value={settings.autoStopMs ?? ""}
						onChange={(e) =>
							patch({ autoStopMs: e.target.value === "" ? null : Number(e.target.value) })
						}
						className="bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-[11px] rounded px-2 py-1 border border-neutral-200 dark:border-neutral-800"
					>
						{AUTO_STOP_OPTIONS.map((opt) => (
							<option key={String(opt.value)} value={opt.value ?? ""}>
								{opt.label}
							</option>
						))}
					</select>
				</Row>

				<Row label="Theme">
					{THEME_OPTIONS.map((opt) => (
						<SegBtn
							key={opt.value}
							active={settings.theme === opt.value}
							onClick={() => patch({ theme: opt.value })}
						>
							{opt.label}
						</SegBtn>
					))}
				</Row>

				<div className="pt-2 border-t border-neutral-200 dark:border-neutral-900">
					{confirmingReset ? (
						<div className="flex items-center justify-between">
							<span className="text-[11px] text-neutral-600 dark:text-neutral-400">
								Reset all stats?
							</span>
							<div className="flex gap-1">
								<button
									onClick={() => setConfirmingReset(false)}
									className="px-2 py-1 rounded text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
								>
									Cancel
								</button>
								<button
									onClick={() => {
										void resetStats();
										setConfirmingReset(false);
									}}
									className="px-2 py-1 rounded text-[11px] bg-red-500/90 text-white hover:bg-red-500"
								>
									Reset
								</button>
							</div>
						</div>
					) : (
						<button
							onClick={() => setConfirmingReset(true)}
							className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
						>
							Reset stats
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
