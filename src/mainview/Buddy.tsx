import { useEffect, useState } from "react";

// The stand-in: a pair of glowing eyes that lives in the dial and acts out
// what the app is doing. Pure CSS transforms, so every change springs.

export type Mood =
	| "sleep"
	| "awake"
	| "read"
	| "glance"
	| "move"
	| "happy"
	| "listen"
	| "coffee"
	| "locked"
	| "tired";

type Shape = { w: number; h: number; r: string; y?: number; tilt?: number };

const SHAPES: Record<Mood, Shape> = {
	sleep: { w: 22, h: 4, r: "3px", y: 7 },
	locked: { w: 22, h: 4, r: "3px", y: 7 },
	awake: { w: 19, h: 26, r: "9px" },
	glance: { w: 19, h: 24, r: "9px" },
	move: { w: 19, h: 24, r: "9px" },
	read: { w: 20, h: 16, r: "8px", y: 6 },
	happy: { w: 22, h: 12, r: "12px 12px 4px 4px", y: -1 },
	coffee: { w: 22, h: 12, r: "12px 12px 4px 4px", y: 1 },
	listen: { w: 19, h: 21, r: "9px", y: 2 },
	tired: { w: 21, h: 9, r: "5px", y: 5, tilt: 10 },
};

const OPEN: Mood[] = ["awake", "glance", "move", "read", "listen"];

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SMOOTH = "cubic-bezier(0.22, 1, 0.36, 1)";

function useBlink(mood: Mood) {
	const [closed, setClosed] = useState(false);
	useEffect(() => {
		if (!OPEN.includes(mood)) return;
		let alive = true;
		let t: ReturnType<typeof setTimeout>;
		const blinkOnce = (then: () => void) => {
			setClosed(true);
			t = setTimeout(() => {
				setClosed(false);
				then();
			}, 110);
		};
		const loop = () => {
			t = setTimeout(
				() => {
					if (!alive) return;
					blinkOnce(() => {
						// Occasional double blink.
						if (Math.random() < 0.2) t = setTimeout(() => blinkOnce(loop), 160);
						else loop();
					});
				},
				2200 + Math.random() * 3800,
			);
		};
		loop();
		return () => {
			alive = false;
			clearTimeout(t);
			setClosed(false);
		};
	}, [mood]);
	return closed;
}

// Where the eyes are looking. Awake: idle saccades. Glance/move: scripted.
function useLook(mood: Mood) {
	const [look, setLook] = useState({ x: 0, y: 0 });
	useEffect(() => {
		const timers: Array<ReturnType<typeof setTimeout>> = [];
		const at = (ms: number, x: number, y: number) => timers.push(setTimeout(() => setLook({ x, y }), ms));
		if (mood === "glance") {
			const dir = Math.random() < 0.5 ? -1 : 1;
			at(0, 8 * dir, -1);
			at(700, -7 * dir, 0);
			at(1500, 0, 0);
		} else if (mood === "move") {
			const dir = Math.random() < 0.5 ? -1 : 1;
			at(0, 6 * dir, 2);
			at(900, 0, 0);
		} else if (mood === "awake") {
			let alive = true;
			const loop = () => {
				timers.push(
					setTimeout(
						() => {
							if (!alive) return;
							setLook(
								Math.random() < 0.4
									? { x: 0, y: 0 }
									: { x: (Math.random() * 2 - 1) * 6, y: (Math.random() * 2 - 1) * 3 },
							);
							loop();
						},
						1600 + Math.random() * 3200,
					),
				);
			};
			setLook({ x: 0, y: 0 });
			loop();
			return () => {
				alive = false;
				timers.forEach(clearTimeout);
			};
		} else {
			setLook({ x: 0, y: 0 });
		}
		return () => timers.forEach(clearTimeout);
	}, [mood]);
	return look;
}

function Eye({ shape, side, look, closed, tone, mood }: {
	shape: Shape;
	side: -1 | 1;
	look: { x: number; y: number };
	closed: boolean;
	tone: string;
	mood: Mood;
}) {
	const tilt = (shape.tilt ?? 0) * side;
	return (
		<span
			className={mood === "read" ? "buddy-scan" : ""}
			style={{
				display: "block",
				transform: `translate(${look.x}px, ${look.y + (shape.y ?? 0)}px) rotate(${tilt}deg)`,
				transition: `transform 380ms ${SPRING}`,
			}}
		>
			<span
				style={{
					display: "block",
					width: shape.w,
					height: shape.h,
					borderRadius: shape.r,
					background: `rgb(var(${tone}))`,
					boxShadow: `0 0 14px rgb(var(${tone}) / 0.55), 0 0 2px rgb(var(${tone}) / 0.9)`,
					transform: `scaleY(${closed ? 0.08 : 1})`,
					transition: closed
						? "transform 70ms ease-in"
						: `transform 160ms ${SMOOTH}, width 420ms ${SPRING}, height 420ms ${SPRING}, border-radius 420ms ${SMOOTH}, background-color 700ms, box-shadow 700ms`,
				}}
			/>
		</span>
	);
}

export function Buddy({ mood, tone }: { mood: Mood; tone: "--accent" | "--warn" | "--ink-3" }) {
	const closed = useBlink(mood);
	const look = useLook(mood);
	const shape = SHAPES[mood];

	return (
		<div className="relative flex h-[44px] w-[96px] items-center justify-center" aria-hidden>
			{/* Headphones while listening in on a meeting or call */}
			<svg
				viewBox="0 0 96 44"
				className="absolute inset-0 overflow-visible"
				style={{
					opacity: mood === "listen" ? 1 : 0,
					transform: mood === "listen" ? "translateY(0) scale(1)" : "translateY(-6px) scale(0.92)",
					transition: `opacity 400ms ${SMOOTH}, transform 500ms ${SPRING}`,
				}}
			>
				<path d="M14 30 C14 4, 82 4, 82 30" fill="none" strokeWidth={2.5} strokeLinecap="round" style={{ stroke: `rgb(var(${tone}) / 0.55)` }} />
				<rect x={7} y={24} width={10} height={16} rx={4} style={{ fill: `rgb(var(${tone}) / 0.75)` }} />
				<rect x={79} y={24} width={10} height={16} rx={4} style={{ fill: `rgb(var(${tone}) / 0.75)` }} />
			</svg>

			<div className="flex items-center gap-[18px]">
				<Eye shape={shape} side={-1} look={look} closed={closed} tone={tone} mood={mood} />
				<Eye shape={shape} side={1} look={look} closed={closed} tone={tone} mood={mood} />
			</div>

			{/* Zzz while asleep */}
			{mood === "sleep" || mood === "locked" ? (
				<span className="pointer-events-none absolute -right-1 -top-3 font-mono text-[11px] font-semibold" style={{ color: `rgb(var(${tone}))` }}>
					{[0, 1, 2].map((i) => (
						<span key={i} className="buddy-z absolute" style={{ animationDelay: `${i * 1.1}s`, fontSize: 9 + i * 2 }}>
							z
						</span>
					))}
				</span>
			) : null}

			{/* A cup of something warm on breaks */}
			<svg
				viewBox="0 0 24 28"
				width={22}
				height={26}
				className="absolute -bottom-3 -right-5"
				style={{
					opacity: mood === "coffee" ? 1 : 0,
					transform: mood === "coffee" ? "translateY(0) rotate(0)" : "translateY(8px) rotate(-12deg)",
					transition: `opacity 400ms ${SMOOTH}, transform 600ms ${SPRING}`,
				}}
			>
				<path className="buddy-steam" d="M8 9c-2-2 2-3 0-6" fill="none" strokeWidth={1.4} strokeLinecap="round" style={{ stroke: `rgb(var(${tone}) / 0.7)` }} />
				<path className="buddy-steam" d="M13 9c-2-2 2-3 0-6" fill="none" strokeWidth={1.4} strokeLinecap="round" style={{ stroke: `rgb(var(${tone}) / 0.7)`, animationDelay: "0.8s" }} />
				<path d="M4 12h14v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" style={{ fill: `rgb(var(${tone}) / 0.85)` }} />
				<path d="M18 14h1.5a2.5 2.5 0 0 1 0 5H18" fill="none" strokeWidth={1.6} style={{ stroke: `rgb(var(${tone}) / 0.85)` }} />
			</svg>
		</div>
	);
}

// Picks a mood from session state and the most recent routine.
export function moodFor(opts: {
	enabled: boolean;
	pauseReason: string | null;
	routine: string | null;
	fresh: boolean;
}): Mood {
	if (!opts.enabled) return "sleep";
	switch (opts.pauseReason) {
		case "meeting":
		case "call":
			return "listen";
		case "break":
			return "coffee";
		case "lock":
			return "locked";
		case "battery":
			return "tired";
	}
	if (opts.fresh) {
		switch (opts.routine) {
			case "read":
			case "browse":
			case "scroll":
				return "read";
			case "glance":
			case "cmdtab":
				return "glance";
			case "nudge":
			case "reach":
			case "mouse":
				return "move";
			case "fidget":
			case "shift":
				return "happy";
		}
	}
	return "awake";
}
