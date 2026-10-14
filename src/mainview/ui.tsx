import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

// ── Icons ───────────────────────────────────────────────────────────────────
// One hand-drawn set, 20px grid, 1.6 stroke, round joins.

const PATHS = {
	play: <path d="M7 5.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
	stop: <rect x="6" y="6" width="8" height="8" rx="1.6" fill="currentColor" stroke="none" />,
	spark: (
		<>
			<path d="M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3" />
			<path d="M10 7.5l.9 1.6 1.6.9-1.6.9-.9 1.6-.9-1.6-1.6-.9 1.6-.9z" />
		</>
	),
	moon: <path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z" />,
	timer: (
		<>
			<circle cx="10" cy="11" r="5.5" />
			<path d="M10 8v3l2 1.2M8.2 3.5h3.6" />
		</>
	),
	cursor: <path d="M5 4l10 4.2-4.3 1.5L9 14z" />,
	nudge: (
		<>
			<path d="M8 6l8 3.4-3.4 1.2L11.4 14z" />
			<path d="M3.5 8.5h2.5M4.5 11.5h3M6 14.5h2.5" />
		</>
	),
	calendar: (
		<>
			<rect x="3.5" y="4.5" width="13" height="12" rx="2.5" />
			<path d="M3.5 8.5h13M7 3v3M13 3v3" />
		</>
	),
	battery: (
		<>
			<rect x="2.5" y="6.5" width="13" height="7" rx="2" />
			<path d="M17.5 9v2M5 9v2" />
		</>
	),
	phone: <path d="M6.2 3.8l2 .4.9 3-1.6 1.1a8 8 0 0 0 4 4l1.1-1.6 3 .9.4 2a1.5 1.5 0 0 1-1.6 1.6A12.5 12.5 0 0 1 4.6 5.4a1.5 1.5 0 0 1 1.6-1.6z" />,
	lock: (
		<>
			<rect x="4.5" y="9" width="11" height="8" rx="2" />
			<path d="M7 9V7a3 3 0 0 1 6 0v2" />
		</>
	),
	cup: (
		<>
			<path d="M4.5 8h9v4a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4z" />
			<path d="M13.5 9.5h1a2 2 0 0 1 0 4h-1M7.5 3.5v2M10.5 3.5v2" />
		</>
	),
	wave: <path d="M2.5 10h2.5l1.5-4 3 9 2.5-7 1.5 3.5 1-1.5h3" />,
	check: <path d="M5 10.5l3 3 7-7" />,
	arrow: <path d="M7 13l6-6M8 7h5v5" />,
	scroll: (
		<>
			<rect x="6.5" y="3" width="7" height="14" rx="3.5" />
			<path d="M10 6v2.5" />
		</>
	),
	window: (
		<>
			<rect x="3" y="4.5" width="14" height="11" rx="2.5" />
			<path d="M3 8h14" />
		</>
	),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
	return (
		<svg
			viewBox="0 0 20 20"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden
		>
			{PATHS[name]}
		</svg>
	);
}

// ── Controls ────────────────────────────────────────────────────────────────

export function Toggle({
	value,
	onChange,
	label,
	disabled,
}: {
	value: boolean;
	onChange: (v: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			role="switch"
			aria-checked={value}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!value)}
			className={`group relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ease-out disabled:opacity-40 ${
				value ? "bg-accent" : "bg-ink/[0.12] dark:bg-ink/[0.14]"
			}`}
		>
			{/* Knob stretches while pressed, like a physical switch. */}
			<span
				className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-all duration-[380ms] ease-spring group-active:w-5 group-active:duration-150 ${
					value ? "left-[19px] group-active:left-[15px]" : "left-[3px]"
				}`}
			/>
		</button>
	);
}

// Segmented control with a sliding thumb.
export function Segmented<T extends string | number | null>({
	options,
	value,
	onChange,
	size = "md",
	label,
}: {
	options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
	value: T;
	onChange: (v: T) => void;
	size?: "sm" | "md";
	label: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
	const index = options.findIndex((o) => o.value === value);

	useLayoutEffect(() => {
		const el = ref.current?.children[index + 1] as HTMLElement | undefined;
		setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
	}, [index, options.length]);

	const pad = size === "sm" ? "px-2.5 h-[26px] text-[11.5px]" : "px-3.5 h-[30px] text-[12.5px]";
	return (
		<div
			ref={ref}
			role="radiogroup"
			aria-label={label}
			className="relative inline-flex rounded-[10px] bg-ink/[0.06] p-[3px] dark:bg-ink/[0.07]"
		>
			<span
				aria-hidden
				className="absolute top-[3px] bottom-[3px] rounded-[7px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-all duration-[420ms] ease-spring dark:bg-surface-2 dark:shadow-[0_1px_2px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.06)]"
				style={{ left: thumb?.x ?? 0, width: thumb?.w ?? 0, opacity: thumb ? 1 : 0 }}
			/>
			{options.map((o) => (
				<button
					key={String(o.value)}
					role="radio"
					aria-checked={o.value === value}
					disabled={o.disabled}
					title={o.title}
					onClick={() => onChange(o.value)}
					className={`press relative z-10 rounded-[7px] font-medium disabled:opacity-35 ${pad} ${
						o.value === value ? "text-ink" : "text-ink-3 hover:text-ink-2"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Section({
	title,
	hint,
	children,
	index = 0,
}: {
	title: string;
	hint?: ReactNode;
	children: ReactNode;
	index?: number;
}) {
	return (
		<section className="animate-rise" style={{ ["--i" as string]: index }}>
			<div className="mb-2 flex items-baseline justify-between px-1">
				<h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink-2">{title}</h2>
				{hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
			</div>
			<div className="panel divide-y divide-line/70 overflow-hidden">{children}</div>
		</section>
	);
}

export function Row({
	icon,
	title,
	description,
	control,
	children,
}: {
	icon?: IconName;
	title: ReactNode;
	description?: ReactNode;
	control?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-3">
				{icon ? (
					<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-ink/[0.05] text-ink-2 dark:bg-ink/[0.06]">
						<Icon name={icon} size={15} />
					</span>
				) : null}
				<div className="min-w-0 flex-1">
					<div className="text-[13.5px] font-medium tracking-[-0.01em] text-ink">{title}</div>
					{description ? (
						<div className="mt-0.5 text-[12px] leading-[1.45] text-ink-3 [text-wrap:pretty]">
							{description}
						</div>
					) : null}
				</div>
				{control ? <div className="shrink-0">{control}</div> : null}
			</div>
			{children}
		</div>
	);
}

export function LinkButton({
	children,
	onClick,
	tone = "default",
	disabled,
}: {
	children: ReactNode;
	onClick: () => void;
	tone?: "default" | "accent" | "danger";
	disabled?: boolean;
}) {
	const color =
		tone === "accent"
			? "text-accent hover:text-accent/80"
			: tone === "danger"
				? "text-danger hover:text-danger/80"
				: "text-ink-2 hover:text-ink";
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`press text-[12.5px] font-medium disabled:opacity-40 ${color}`}
		>
			{children}
		</button>
	);
}

// ── Motion helpers ──────────────────────────────────────────────────────────

// Odometer-style text: each digit is a 0–9 column that rolls to its value.
// Columns are keyed from the right so "10:00" → "9:59" keeps them in place.
export function Rolling({
	text,
	className,
	spin = false,
}: {
	text: string;
	className?: string;
	// Slot-machine entrance: each digit spins down from 9 and settles, left to right.
	spin?: boolean;
}) {
	const chars = text.split("");
	const mounted = useMounted();
	const [settled, setSettled] = useState(!spin);
	useEffect(() => {
		if (!spin) return;
		const t = setTimeout(() => setSettled(true), 1400);
		return () => clearTimeout(t);
	}, [spin]);
	let col = 0;
	return (
		<span className={`inline-flex ${className ?? ""}`} aria-label={text}>
			{chars.map((ch, i) => {
				const key = chars.length - i;
				if (!/\d/.test(ch)) {
					return (
						<span key={`s${key}`} aria-hidden className="inline-block h-[1em] leading-none">
							{ch}
						</span>
					);
				}
				const d = spin && !mounted ? 9 : Number(ch);
				const order = col++;
				return (
					<span key={`d${key}`} aria-hidden className="relative inline-block h-[1em] overflow-hidden leading-none">
						<span className="invisible">0</span>
						<span
							className="absolute left-0 top-0 flex flex-col"
							style={{
								transform: `translateY(${-d * 10}%)`,
								transition: settled
									? "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)"
									: `transform 1100ms cubic-bezier(0.16, 1, 0.3, 1) ${order * 90}ms`,
							}}
						>
							{Array.from({ length: 10 }, (_, n) => (
								<span key={n} className="block h-[1em] leading-none">
									{n}
								</span>
							))}
						</span>
					</span>
				);
			})}
		</span>
	);
}

// Animates a number from its previous value (0 on mount) with ease-out.
export function useCountUp(value: number, ms = 900) {
	const [shown, setShown] = useState(0);
	const from = useRef(0);
	useEffect(() => {
		const start = performance.now();
		const a = from.current;
		let raf = 0;
		const step = (t: number) => {
			const k = Math.min(1, (t - start) / ms);
			const eased = 1 - Math.pow(1 - k, 4);
			const v = Math.round(a + (value - a) * eased);
			setShown(v);
			if (k < 1) raf = requestAnimationFrame(step);
			else from.current = value;
		};
		raf = requestAnimationFrame(step);
		return () => {
			cancelAnimationFrame(raf);
			from.current = value;
		};
	}, [value, ms]);
	return shown;
}

// True one frame after mount — lets a transition run from an initial state.
export function useMounted() {
	const [m, setM] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setM(true));
		return () => cancelAnimationFrame(raf);
	}, []);
	return m;
}
