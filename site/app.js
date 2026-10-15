// Focus Timer site. A dependency-free port of the app's own pieces: the
// buddy (src/mainview/Buddy.tsx), the dial and session loop (Focus.tsx), the
// odometer digits (ui.tsx Rolling) and the Insights cards, so the page shows
// the real thing running rather than a picture of it.

(() => {
	"use strict";

	const SVGNS = "http://www.w3.org/2000/svg";
	const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const $ = (sel, root = document) => root.querySelector(sel);
	const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
	const rand = (a, b) => a + Math.random() * (b - a);
	const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

	const DMG_URL = "https://github.com/gab-cat/focus-timer/releases/latest/download/stable-macos-arm64-FocusTimer.dmg";

	function svg(tag, attrs = {}) {
		const el = document.createElementNS(SVGNS, tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		return el;
	}

	// ── Icons ─────────────────────────────────────────────────────────────────
	// The app's own set (20px grid, 1.6 stroke, round joins), plus the GitHub
	// and Apple marks from Simple Icons.

	const ICONS = {
		play: '<path d="M7 5.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
		stop: '<rect x="6" y="6" width="8" height="8" rx="1.6" fill="currentColor" stroke="none"/>',
		spark: '<path d="M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3"/><path d="M10 7.5l.9 1.6 1.6.9-1.6.9-.9 1.6-.9-1.6-1.6-.9 1.6-.9z"/>',
		moon: '<path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z"/>',
		timer: '<circle cx="10" cy="11" r="5.5"/><path d="M10 8v3l2 1.2M8.2 3.5h3.6"/>',
		nudge: '<path d="M8 6l8 3.4-3.4 1.2L11.4 14z"/><path d="M3.5 8.5h2.5M4.5 11.5h3M6 14.5h2.5"/>',
		battery: '<rect x="2.5" y="6.5" width="13" height="7" rx="2"/><path d="M17.5 9v2M5 9v2"/>',
		phone: '<path d="M6.2 3.8l2 .4.9 3-1.6 1.1a8 8 0 0 0 4 4l1.1-1.6 3 .9.4 2a1.5 1.5 0 0 1-1.6 1.6A12.5 12.5 0 0 1 4.6 5.4a1.5 1.5 0 0 1 1.6-1.6z"/>',
		lock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>',
		check: '<path d="M5 10.5l3 3 7-7"/>',
		window: '<rect x="3" y="4.5" width="14" height="11" rx="2.5"/><path d="M3 8h14"/>',
		download: '<path d="M10 3.5v9M6.3 9l3.7 3.7L13.7 9M4.5 16.5h11"/>',
		up: '<path d="M6 12l4-4 4 4"/>',
		down: '<path d="M6 8l4 4 4-4"/>',
		shift: '<path d="M10 3.8l6.2 6.4h-3.4v5.6H7.2v-5.6H3.8z"/>',
	};

	const BRAND = {
		github:
			'<path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
		apple:
			'<path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',
	};

	function icon(name, size = 16) {
		if (BRAND[name]) {
			return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${BRAND[name]}</svg>`;
		}
		return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
	}

	function paintIcons(root = document) {
		for (const el of $$("[data-icon]", root)) {
			const name = el.dataset.icon;
			let size = 16;
			if (el.classList.contains("apple")) size = el.closest(".btn-sm") ? 14 : 17;
			else if (el.closest(".icon-btn")) size = 20;
			else if (el.closest(".btn")) size = 18;
			else if (el.classList.contains("step-ic")) size = 20;
			else if (el.closest(".fact")) size = 18;
			else if (el.classList.contains("row-ic")) size = 15;
			else if (el.classList.contains("arrow")) size = 18;
			el.innerHTML = icon(name, size);
			if (el.classList.contains("apple") || el.closest(".btn")) el.style.display = "inline-flex";
		}
	}

	// ── Formatting (src/mainview/format.ts) ───────────────────────────────────

	function mmss(ms) {
		const total = Math.max(0, Math.round(ms / 1000));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, "0")}`;
	}

	function duration(ms) {
		const total = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
		if (m > 0) return `${m}m`;
		return `${total}s`;
	}

	function ago(ms) {
		const s = Math.round(ms / 1000);
		if (s < 10) return "just now";
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		return `${Math.floor(m / 60)}h ago`;
	}

	const ROUTINE_LABELS = { cmdtab: "⌘-Tab", mouse: "Mouse", scroll: "Scroll", shift: "Shift tap" };
	const NARRATE = { cmdtab: "Switched apps", mouse: "Nudged the cursor", scroll: "Scrolled a line", shift: "Tapped Shift" };

	// Swap an element's content with the app's blur-rise entrance, but only
	// when its key changes, so a 1s render tick doesn't replay it.
	function swap(el, key, html, delay = 0) {
		if (el.dataset.key === key) return false;
		el.dataset.key = key;
		const span = document.createElement("span");
		span.className = "swap";
		span.style.display = "inline-flex";
		span.style.alignItems = "center";
		span.style.setProperty("--d", `${delay}ms`);
		span.innerHTML = html;
		el.replaceChildren(span);
		return true;
	}

	// ── Rolling digits (ui.tsx Rolling) ───────────────────────────────────────
	// Each digit is a 0-9 column that rolls to its value. A spin plays the
	// slot-machine entrance: every digit drops from 9 and settles, left to right.

	class Rolling {
		constructor(el) {
			this.el = el;
			this.el.classList.add("roll");
			this.text = null;
			this.strips = [];
		}

		set(text, spin = false) {
			this.el.setAttribute("aria-label", text);
			const shapeOf = (t) => t.replace(/\d/g, "0");
			if (!spin && this.text != null && shapeOf(text) === shapeOf(this.text)) {
				let n = 0;
				for (const ch of text) {
					if (!/\d/.test(ch)) continue;
					this.roll(this.strips[n++], Number(ch), 520, 0, "cubic-bezier(0.22, 1, 0.36, 1)");
				}
				this.text = text;
				return;
			}
			this.build(text, spin);
		}

		build(text, spin) {
			this.text = text;
			this.strips = [];
			this.el.replaceChildren();
			let order = 0;
			for (const ch of text) {
				if (!/\d/.test(ch)) {
					const s = document.createElement("span");
					s.className = "roll-sep";
					s.setAttribute("aria-hidden", "true");
					s.textContent = ch;
					this.el.append(s);
					continue;
				}
				const win = document.createElement("span");
				win.className = "roll-window";
				win.setAttribute("aria-hidden", "true");
				const ghost = document.createElement("span");
				ghost.className = "ghost";
				ghost.textContent = "0";
				const strip = document.createElement("span");
				strip.className = "roll-strip";
				for (let n = 0; n < 10; n++) {
					const c = document.createElement("span");
					c.className = "roll-cell";
					c.textContent = String(n);
					strip.append(c);
				}
				win.append(ghost, strip);
				this.el.append(win);
				const d = Number(ch);
				strip._d = spin && !REDUCE ? 9 : d;
				strip.style.transform = `translateY(${-strip._d * 10}%)`;
				this.strips.push(strip);
				if (spin && !REDUCE) {
					const delay = order * 90;
					requestAnimationFrame(() =>
						requestAnimationFrame(() => this.roll(strip, d, 1100, delay, "cubic-bezier(0.16, 1, 0.3, 1)")),
					);
				}
				order++;
			}
		}

		roll(strip, d, ms, delay, ease) {
			if (!strip || strip._d === d) return;
			const dist = Math.abs(d - strip._d);
			strip._d = d;
			strip.style.transition = `transform ${ms}ms ${ease} ${delay}ms`;
			strip.style.transform = `translateY(${-d * 10}%)`;
			if (REDUCE || !strip.animate) return;
			// A brief motion blur, scaled by how many digits it passes.
			const peak = Math.min(0.09, 0.03 + dist * 0.007);
			strip.animate(
				[
					{ filter: "blur(0em)" },
					{ filter: `blur(${peak}em)`, offset: 0.08 },
					{ filter: "blur(0em)", offset: 0.55 },
					{ filter: "blur(0em)" },
				],
				{ duration: ms, delay },
			);
		}
	}

	// ── Buddy (Buddy.tsx) ─────────────────────────────────────────────────────
	// A pair of glowing eyes that acts out what the app is doing. Pure CSS
	// transforms, so every change springs.

	const SHAPES = {
		sleep: { w: 22, h: 4, r: "3px", y: 7 },
		locked: { w: 22, h: 4, r: "3px", y: 7 },
		awake: { w: 19, h: 26, r: "9px" },
		glance: { w: 19, h: 24, r: "9px" },
		move: { w: 19, h: 24, r: "9px" },
		read: { w: 20, h: 16, r: "8px", y: 6 },
		happy: { w: 22, h: 12, r: "12px 12px 4px 4px", y: -1 },
		listen: { w: 19, h: 21, r: "9px", y: 2 },
		tired: { w: 21, h: 9, r: "5px", y: 5, tilt: 10 },
	};
	const OPEN = ["awake", "glance", "move", "read", "listen"];
	const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
	const SMOOTH = "cubic-bezier(0.22, 1, 0.36, 1)";

	const pointer = { x: 0, y: 0, t: 0 };
	const followers = new Set();

	class Buddy {
		constructor(host, { follow = false } = {}) {
			this.el = document.createElement("div");
			this.el.className = "buddy";
			this.el.setAttribute("aria-hidden", "true");
			this.el.innerHTML = `
				<svg class="phones" viewBox="0 0 96 44">
					<path d="M14 30 C14 4, 82 4, 82 30" fill="none" stroke-width="2.5" stroke-linecap="round"/>
					<rect x="7" y="24" width="10" height="16" rx="4"/>
					<rect x="79" y="24" width="10" height="16" rx="4"/>
				</svg>
				<div class="eyes">
					<span class="eye-pos"><span class="eye"></span></span>
					<span class="eye-pos"><span class="eye"></span></span>
				</div>
				<span class="zzz"><span style="font-size:9px;animation-delay:0s">z</span><span style="font-size:11px;animation-delay:1.1s">z</span><span style="font-size:13px;animation-delay:2.2s">z</span></span>`;
			host.append(this.el);
			this.pos = $$(".eye-pos", this.el);
			this.eyes = $$(".eye", this.el);
			this.phones = $(".phones", this.el);
			this.zzz = $(".zzz", this.el);
			this.mood = null;
			this.tone = null;
			this.closed = false;
			this.look = { x: 0, y: 0 };
			this.timers = [];
			this.blinkTimer = null;
			this.follow = follow;
			if (follow) followers.add(this);
		}

		set(mood, tone) {
			if (mood === this.mood && tone === this.tone) return;
			const changed = mood !== this.mood;
			this.mood = mood;
			this.tone = tone;
			this.el.classList.toggle("listen", mood === "listen");
			this.el.classList.toggle("sleepy", mood === "sleep" || mood === "locked");
			this.el.classList.toggle("scan", mood === "read");
			const c = (a) => `rgb(var(${tone}) / ${a})`;
			this.phones.querySelector("path").style.stroke = c(0.55);
			for (const r of this.phones.querySelectorAll("rect")) r.style.fill = c(0.75);
			this.zzz.style.color = `rgb(var(${tone}))`;
			if (changed) {
				this.startBlink();
				this.startLook();
			}
			this.paint();
		}

		// Replays a scripted mood (glance / move) on the mood stage.
		replay() {
			this.startLook();
		}

		paint() {
			const sh = SHAPES[this.mood];
			const tone = this.tone;
			this.pos.forEach((p, i) => {
				const side = i === 0 ? -1 : 1;
				const tilt = (sh.tilt ?? 0) * side;
				p.style.transform = `translate(${this.look.x}px, ${this.look.y + (sh.y ?? 0)}px) rotate(${tilt}deg)`;
			});
			for (const e of this.eyes) {
				e.style.width = `${sh.w}px`;
				e.style.height = `${sh.h}px`;
				e.style.borderRadius = sh.r;
				e.style.background = `rgb(var(${tone}))`;
				e.style.boxShadow = `0 0 14px rgb(var(${tone}) / 0.55), 0 0 2px rgb(var(${tone}) / 0.9)`;
				e.style.transform = `scaleY(${this.closed ? 0.08 : 1})`;
				e.style.transition = this.closed
					? "transform 70ms ease-in"
					: `transform 160ms ${SMOOTH}, width 420ms ${SPRING}, height 420ms ${SPRING}, border-radius 420ms ${SMOOTH}, background-color 700ms, box-shadow 700ms`;
			}
		}

		setLook(x, y) {
			this.look = { x, y };
			this.paint();
		}

		startBlink() {
			clearTimeout(this.blinkTimer);
			this.closed = false;
			if (!OPEN.includes(this.mood) || REDUCE) return;
			const mood = this.mood;
			const blinkOnce = (then) => {
				this.closed = true;
				this.paint();
				this.blinkTimer = setTimeout(() => {
					this.closed = false;
					this.paint();
					then();
				}, 110);
			};
			const loop = () => {
				this.blinkTimer = setTimeout(
					() => {
						if (this.mood !== mood) return;
						blinkOnce(() => {
							// Occasional double blink.
							if (Math.random() < 0.2) this.blinkTimer = setTimeout(() => blinkOnce(loop), 160);
							else loop();
						});
					},
					2200 + Math.random() * 3800,
				);
			};
			loop();
		}

		// Where the eyes are looking. Awake: idle saccades, or the visitor's
		// pointer when it's moving. Glance / move: scripted.
		startLook() {
			for (const t of this.timers) clearTimeout(t);
			this.timers = [];
			const at = (ms, x, y) => this.timers.push(setTimeout(() => this.setLook(x, y), ms));
			const mood = this.mood;
			if (REDUCE) {
				this.look = { x: 0, y: 0 };
				return;
			}
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
				this.look = { x: 0, y: 0 };
				const loop = () => {
					this.timers.push(
						setTimeout(
							() => {
								if (this.mood !== "awake") return;
								if (!(this.follow && Date.now() - pointer.t < 2500)) {
									this.setLook(
										...(Math.random() < 0.4 ? [0, 0] : [(Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 3]),
									);
								}
								loop();
							},
							1600 + Math.random() * 3200,
						),
					);
				};
				loop();
			} else {
				this.look = { x: 0, y: 0 };
			}
		}

		followPointer() {
			if (this.mood !== "awake") return;
			const r = this.el.getBoundingClientRect();
			if (!r.width) return;
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			this.setLook(clamp((pointer.x - cx) / 40, -6, 6), clamp((pointer.y - cy) / 60, -3, 3));
		}
	}

	let pointerRaf = 0;
	addEventListener(
		"pointermove",
		(e) => {
			pointer.x = e.clientX;
			pointer.y = e.clientY;
			pointer.t = Date.now();
			if (REDUCE || pointerRaf) return;
			pointerRaf = requestAnimationFrame(() => {
				pointerRaf = 0;
				for (const b of followers) b.followPointer();
			});
		},
		{ passive: true },
	);

	function moodFor({ enabled, pauseReason, routine, fresh }) {
		if (!enabled) return "sleep";
		if (pauseReason === "call") return "listen";
		if (pauseReason === "lock") return "locked";
		if (pauseReason === "battery") return "tired";
		if (fresh) {
			if (routine === "scroll") return "read";
			if (routine === "cmdtab") return "glance";
			if (routine === "mouse") return "move";
			if (routine === "shift") return "happy";
		}
		return "awake";
	}

	// ── Dial geometry (Focus.tsx) ─────────────────────────────────────────────

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

	// Sparks thrown off the comet head when a wait runs out: fanned evenly
	// with a little jitter so the burst doesn't look stamped.
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
	const REWIND = "850ms cubic-bezier(0.65, 0, 0.35, 1) 160ms";

	function tickLines(parent) {
		return TICK_GEOM.map(({ major, x1, y1, x2, y2 }) => {
			const l = svg("line", { x1, y1, x2, y2, "stroke-linecap": "round", "stroke-width": major ? 2 : 1.2 });
			l.style.stroke = `rgb(var(--ink) / ${major ? 0.22 : 0.1})`;
			parent.append(l);
			return l;
		});
	}

	// A wave of light runs clockwise round the bezel, and the head at
	// 12 o'clock flares and throws sparks.
	function lapBurst(waveLayer, burstLayer) {
		if (REDUCE) return;
		const g = svg("g");
		g.style.filter = "drop-shadow(0 0 3px rgb(var(--accent) / 0.8))";
		TICK_GEOM.forEach(({ major, x1, y1, x2, y2 }, i) => {
			const l = svg("line", { x1, y1, x2, y2, "stroke-linecap": "round", "stroke-width": major ? 2.6 : 2, class: "lap-tick" });
			l.style.stroke = "rgb(var(--accent))";
			l.style.setProperty("--i", i);
			g.append(l);
		});
		waveLayer.append(g);

		const b = svg("g", { transform: `translate(${C} ${C - ARC_R})` });
		const flare = svg("circle", { r: 6, class: "lap-flare" });
		flare.style.fill = "rgb(var(--accent) / 0.35)";
		const ring = svg("circle", { r: 5, fill: "none", "stroke-width": 1.2, class: "lap-flare" });
		ring.style.stroke = "rgb(var(--accent))";
		ring.style.setProperty("--d", "60ms");
		b.append(flare, ring);
		for (const sp of SPARKS) {
			const el = sp.star ? svg("path", { d: STAR, class: "lap-spark" }) : svg("circle", { r: sp.r, class: "lap-spark" });
			el.style.fill = `rgb(var(--accent) / ${sp.star ? 1 : 0.75})`;
			el.style.setProperty("--dx", `${sp.dx.toFixed(1)}px`);
			el.style.setProperty("--dy", `${sp.dy.toFixed(1)}px`);
			el.style.setProperty("--rot", `${sp.rot}deg`);
			el.style.setProperty("--d", `${sp.delay}ms`);
			b.append(el);
		}
		burstLayer.append(b);
		setTimeout(() => {
			g.remove();
			b.remove();
		}, 1500);
	}

	function coreStyle(core, state, tone) {
		core.style.background =
			state === "idle"
				? "radial-gradient(circle at 50% 30%, rgb(var(--ink) / 0.05), transparent 65%), rgb(var(--surface))"
				: `radial-gradient(circle at 50% 28%, rgb(var(${tone}) / 0.16), transparent 62%), radial-gradient(circle at 50% 110%, rgb(var(${tone}) / 0.1), transparent 55%), rgb(var(--surface))`;
		core.style.boxShadow = `inset 0 1px 0 rgb(255 255 255 / 0.05), 0 0 0 1px rgb(var(--line)), 0 24px 60px -28px rgb(var(${
			state === "idle" ? "--shadow" : tone
		}) / ${state === "idle" ? 0.4 : 0.5})`;
	}

	// ── The demo session ──────────────────────────────────────────────────────
	// Same rules as src/bun/index.ts, sped up 15×: a 90-180 s wait becomes
	// 6-12 s, and every time shown on screen is in "app time".

	const SPEED = 15;
	const TRACE_WINDOW = (30 * 60_000) / SPEED;

	const D = {
		enabled: false,
		sessionStartedAt: null,
		waitStartedAt: null,
		nextActionAt: null,
		lastActionAt: null,
		lastRoutine: null,
		recent: [],
		actionType: "cmdtab",
		preventSleep: true,
		pauseOnCall: true,
		pauseOnLock: true,
		pauseOnBattery: false,
		moving: false,
		lapAt: null,
		today: 41,
		touched: false,
	};

	// A few earlier moves so the trace isn't bare on arrival.
	{
		const now = Date.now();
		const seed = [
			[104, "cmdtab"],
			[86, "cmdtab"],
			[63, "mouse"],
			[41, "cmdtab"],
			[22, "scroll"],
		];
		D.recent = seed.map(([s, routine]) => ({ at: now - s * 1000, routine }));
	}

	const listeners = new Set();
	const emit = () => {
		for (const fn of listeners) fn();
	};

	let lapTimer = 0;
	let actTimer = 0;

	const randWait = () => (rand(90, 180) * 1000) / SPEED;

	function startWait(ms) {
		D.waitStartedAt = Date.now();
		D.nextActionAt = D.waitStartedAt + ms;
		D.lapAt = null;
		clearTimeout(lapTimer);
		lapTimer = setTimeout(onLap, ms);
	}

	function onLap() {
		if (!D.enabled) return;
		D.lapAt = D.nextActionAt;
		emit();
		clearTimeout(actTimer);
		actTimer = setTimeout(() => act(D.actionType), 450);
	}

	function act(routine) {
		const now = Date.now();
		D.lastActionAt = now;
		D.lastRoutine = routine;
		D.recent.push({ at: now, routine });
		D.recent = D.recent.filter((r) => now - r.at <= TRACE_WINDOW + 2000);
		D.today += 1;
		hero?.ripple();
		if (D.enabled) startWait(randWait());
		emit();
	}

	function start() {
		if (D.enabled) return;
		D.enabled = true;
		D.sessionStartedAt = Date.now();
		startWait(D.touched ? randWait() : 4800);
		emit();
	}

	function stop() {
		D.enabled = false;
		D.sessionStartedAt = null;
		D.waitStartedAt = null;
		D.nextActionAt = null;
		D.lapAt = null;
		clearTimeout(lapTimer);
		clearTimeout(actTimer);
		emit();
	}

	function toggle(byUser = true) {
		if (byUser) D.touched = true;
		D.enabled ? stop() : start();
	}

	function moveNow() {
		if (D.moving) return;
		D.touched = true;
		D.moving = true;
		emit();
		clearTimeout(lapTimer);
		clearTimeout(actTimer);
		setTimeout(() => {
			act(D.actionType);
			setTimeout(() => {
				D.moving = false;
				emit();
			}, 250);
		}, 350);
	}

	setInterval(emit, 1000);

	// The 3D buddy (bot.js) reads the same session.
	const stageFns = new Set();
	let lastStage = null;
	window.FT = {
		D,
		SPEED,
		toggle,
		moveNow,
		Rolling,
		mmss,
		NARRATE,
		touch: () => (D.touched = true),
		onStageMood(fn) {
			stageFns.add(fn);
			if (lastStage) fn(lastStage);
		},
	};

	// ── Hero window ───────────────────────────────────────────────────────────

	let hero = null;

	function buildHero() {
		const mac = $("#mac");
		if (!mac) return;
		mac.innerHTML = `
			<div class="mac-bar">
				<div class="lights" aria-hidden="true"><i></i><i></i><i></i></div>
				<div class="seg" id="tabs" role="radiogroup" aria-label="Sections">
					<span class="seg-thumb" aria-hidden="true"></span>
					<button role="radio" data-tab="focus" aria-checked="true">Focus</button>
					<button role="radio" data-tab="insights" aria-checked="false">Insights</button>
					<button role="radio" data-tab="settings" aria-checked="false">Settings</button>
				</div>
				<span class="mac-dot" id="mac-dot" aria-hidden="true"></span>
			</div>
			<div class="mac-main">
				<div class="view" data-view="focus">
					<div class="focus" id="focus" data-state="idle">
						<div class="ambient"></div>
						<div class="status-line">
							<div class="left"><span class="sdot"></span><span class="s-title" id="s-title"></span><span class="s-mode" id="s-mode"></span></div>
							<span class="s-time"><span id="s-time"></span></span>
						</div>
						<div class="dial-zone">
							<div class="dial">
								<svg width="288" height="288" viewBox="0 0 288 288" aria-hidden="true">
									<g class="d-ticks"></g><g class="d-wave"></g>
									<circle cx="144" cy="144" r="120" fill="none" stroke-width="1" style="stroke: rgb(var(--ink) / 0.07)"/>
									<g class="d-arc" style="opacity:0; transition: opacity 900ms cubic-bezier(0.22,1,0.36,1)">
										<circle class="d-arc-line" cx="144" cy="144" r="120" fill="none" stroke-width="2" stroke-linecap="round" transform="rotate(-90 144 144)"/>
										<g class="d-comet" style="transform-origin: 144px 144px"><circle cx="144" cy="24" r="4"/></g>
									</g>
									<g class="d-burst"></g>
								</svg>
								<div class="core-wrap" id="core-wrap"><div class="core" id="core"><div id="core-buddy"></div><div class="core-text" id="core-text"></div></div></div>
							</div>
							<div class="narration" id="narration"></div>
						</div>
						<div class="focus-bottom">
							<div class="trace">
								<div class="trace-head"><span>Last 30 minutes</span><span id="trace-count"></span></div>
								<svg viewBox="0 0 400 48" aria-hidden="true">
									<line x1="0" x2="400" y1="24" y2="24" stroke-dasharray="2 4" style="stroke: rgb(var(--ink) / 0.14)"/>
									<line x1="100" x2="100" y1="21" y2="27" style="stroke: rgb(var(--ink) / 0.14)"/>
									<line x1="200" x2="200" y1="21" y2="27" style="stroke: rgb(var(--ink) / 0.14)"/>
									<line x1="300" x2="300" y1="21" y2="27" style="stroke: rgb(var(--ink) / 0.14)"/>
									<g class="t-marks"></g>
								</svg>
								<div class="trace-empty" id="trace-empty"></div>
								<div class="trace-axis"><span>30m</span><span>15m</span><span>now</span></div>
							</div>
							<div class="chips" id="chips"></div>
							<div class="actions">
								<button class="start press" id="start"><span id="start-label"></span><span class="kbd">Space</span></button>
								<button class="nudge press" id="nudge" aria-label="Move now" title="Move now (R)">${icon("nudge", 20)}</button>
							</div>
						</div>
					</div>
				</div>
				<div class="view" data-view="insights" hidden><div class="pad-view scroll-y" id="v-insights"></div></div>
				<div class="view" data-view="settings" hidden><div class="pad-view scroll-y" id="v-settings"></div></div>
			</div>`;

		const q = (s) => $(s, mac);
		const dialSvg = q(".dial svg");
		const ticks = tickLines(q(".d-ticks"));
		const arcG = q(".d-arc");
		const arc = q(".d-arc-line");
		arc.setAttribute("stroke-dasharray", ARC_LEN);
		arc.setAttribute("stroke-dashoffset", ARC_LEN);
		arc.style.stroke = "rgb(var(--accent))";
		arc.style.filter = "drop-shadow(0 0 4px rgb(var(--accent) / 0.6))";
		const comet = q(".d-comet");
		const head = comet.querySelector("circle");
		head.style.fill = "rgb(var(--accent))";
		head.style.filter = "drop-shadow(0 0 8px rgb(var(--accent) / 0.95))";

		const buddy = new Buddy(q("#core-buddy"), { follow: true });
		const sessionRoll = new Rolling(q("#s-time"));
		const focus = q("#focus");
		const heroSection = $("#demo");
		const coreText = q("#core-text");
		const marks = q(".t-marks");
		const markEls = new Map();
		let countRoll = null;
		let countKey = null;
		let lastState = null;
		let lastLap = null;

		const startBtn = q("#start");
		startBtn.addEventListener("click", () => toggle(true));
		q("#nudge").addEventListener("click", moveNow);

		function render() {
			const now = Date.now();
			const state = D.enabled ? "active" : "idle";
			const tone = state === "active" ? "--accent" : "--ink-3";
			focus.dataset.state = state;
			heroSection.dataset.state = state;
			q("#mac-dot").classList.toggle("on", D.enabled && currentTab !== "focus");

			const rewinding = state === "active" && D.waitStartedAt != null && now - D.waitStartedAt < 1000;
			const span = D.nextActionAt && D.waitStartedAt ? Math.max(1, D.nextActionAt - D.waitStartedAt) : 1;
			const progress =
				state === "active" && !rewinding && D.nextActionAt
					? clamp((now + 1000 - D.waitStartedAt) / span, 0, 1)
					: 0;
			const remaining = D.nextActionAt ? D.nextActionAt - now : 0;
			const fresh = D.lastActionAt != null && now - D.lastActionAt < 6000;
			const reacting = D.lastActionAt != null && now - D.lastActionAt < 2800;
			const lapDone = state === "active" && D.lapAt != null && D.lapAt === D.nextActionAt;

			// Bezel ticks: near the leading edge glow brightest, fading behind.
			const lit = state === "active" ? Math.floor(progress * TICKS) : 0;
			ticks.forEach((l, i) => {
				const major = i % 6 === 0;
				const on = i < lit;
				const trail = on ? 0.4 + 0.6 * Math.pow((i + 1) / Math.max(1, lit), 1.6) : 0;
				l.setAttribute("stroke-width", major ? 2 : on ? 1.6 : 1.2);
				l.style.stroke = on ? `rgb(var(${tone}) / ${trail.toFixed(3)})` : `rgb(var(--ink) / ${major ? 0.22 : 0.1})`;
				l.style.transition = `stroke 600ms ease-out ${rewinding ? 160 + (TICKS - 1 - i) * 9 : 0}ms`;
			});

			// Arc and comet. A new wait rewinds them instead of snapping back.
			arcG.style.opacity = state === "active" ? "1" : "0";
			arc.style.transition = `stroke-dashoffset ${rewinding ? REWIND : "1s linear"}`;
			arc.setAttribute("stroke-dashoffset", (ARC_LEN * (1 - progress)).toFixed(2));
			comet.style.transition = `transform ${rewinding ? REWIND : "1s linear"}`;
			comet.style.transform = `rotate(${progress * 360}deg)`;

			if (lapDone && lastLap !== D.lapAt) {
				lastLap = D.lapAt;
				lapBurst(q(".d-wave"), q(".d-burst"));
				const c = coreText.querySelector(".count");
				if (c && !REDUCE) {
					c.classList.remove("lap");
					void c.offsetWidth;
					c.classList.add("lap");
				}
			}

			coreStyle(q("#core"), state, tone);
			buddy.set(moodFor({ enabled: D.enabled, pauseReason: null, routine: D.lastRoutine, fresh: reacting || D.moving }), tone);

			// Status line
			swap(q("#s-title"), state, state === "active" ? "Active" : "Idle");
			swap(q("#s-mode"), state === "active" ? D.actionType : "none", state === "active" ? `· ${ROUTINE_LABELS[D.actionType]}` : "", 80);
			if (D.sessionStartedAt) {
				q("#s-time").style.visibility = "visible";
				sessionRoll.set(duration((now - D.sessionStartedAt) * SPEED));
			} else {
				q("#s-time").style.visibility = "hidden";
			}

			// Core text
			if (state !== lastState) {
				lastState = state;
				countKey = null;
				coreText.replaceChildren();
				if (state === "active") {
					coreText.innerHTML = `<span class="swap" style="--d:120ms"><span class="count"></span></span><div class="count-label swap" style="--d:320ms">until next move</div>`;
				} else {
					coreText.innerHTML = `<div class="ready swap" style="--d:100ms">Ready</div><div class="ready-sub swap" style="--d:220ms">Moves after 2 min idle</div>`;
				}
			}
			if (state === "active") {
				const count = coreText.querySelector(".count");
				if (countKey !== D.waitStartedAt) {
					countKey = D.waitStartedAt;
					countRoll = new Rolling(count);
					count.classList.remove("lap");
					countRoll.set(mmss(remaining * SPEED), true);
				} else {
					countRoll.set(mmss(remaining * SPEED));
				}
			}

			// Narration
			const nar = q("#narration");
			if (state === "active" && D.lastActionAt && D.lastActionAt >= (D.sessionStartedAt ?? 0)) {
				const key = `a${D.lastActionAt}`;
				if (!swap(nar, key, `<span class="n-act${fresh ? " fresh" : ""}"><span class="n-dot"></span><b>${NARRATE[D.lastRoutine]}</b><span class="n-ago">· ${ago((now - D.lastActionAt) * SPEED)}</span></span>`)) {
					const act = nar.querySelector(".n-act");
					act.classList.toggle("fresh", fresh);
					nar.querySelector(".n-ago").textContent = `· ${ago((now - D.lastActionAt) * SPEED)}`;
				}
			} else {
				swap(nar, `${state}-hint`, state === "active" ? "Holding the fort until you step away" : "Asleep until you press Space", 440);
			}

			// Trace: one stroke per move, height by how big the action was.
			const H = { cmdtab: 24, mouse: 12, scroll: 18, shift: 7 };
			const visible = D.recent.filter((r) => now - r.at <= TRACE_WINDOW);
			swap(q("#trace-count"), String(visible.length), `${visible.length} ${visible.length === 1 ? "move" : "moves"}`);
			const keep = new Set();
			for (const r of visible) {
				keep.add(r.at);
				let g = markEls.get(r.at);
				const x = 400 - ((now - r.at) / TRACE_WINDOW) * 400;
				const age = (now - r.at) / TRACE_WINDOW;
				if (!g) {
					const h = H[r.routine] ?? 14;
					g = svg("g");
					const l = svg("line", { x1: 0, x2: 0, y1: 24 - h / 2 - 2, y2: 24 + h / 2 + 2, "stroke-width": 2, "stroke-linecap": "round", class: "trace-mark" });
					g.append(l);
					g.style.transform = `translateX(${x.toFixed(1)}px)`;
					marks.append(g);
					markEls.set(r.at, g);
					void g.getBoundingClientRect();
					g.style.transition = "transform 1s linear";
					l.style.transition = "stroke 1s linear";
				}
				g.style.transform = `translateX(${(x - (1000 / TRACE_WINDOW) * 400).toFixed(1)}px)`;
				g.firstChild.style.stroke = `rgb(var(--accent) / ${(1 - age * 0.75).toFixed(2)})`;
			}
			for (const [at, l] of markEls) {
				if (!keep.has(at)) {
					l.remove();
					markEls.delete(at);
				}
			}
			const empty = q("#trace-empty");
			if (visible.length === 0) {
				empty.style.display = "";
				swap(empty, state, `<span>${state === "active" ? "Waiting for you to step away" : "Moves will trace here"}</span>`, state === "active" ? 420 : 0);
			} else {
				empty.style.display = "none";
				empty.dataset.key = "";
			}

			// Chips
			const chips = q("#chips");
			if (D.enabled && D.preventSleep) swap(chips, "sleep", `<span class="chip accent">${icon("moon", 13)}Sleep blocked</span>`, 380);
			else if (D.enabled) swap(chips, "none", "");
			else
				swap(
					chips,
					`note-${D.preventSleep}`,
					`<span class="chip-note">${D.preventSleep ? "Blocks system sleep while running" : "Keeps the display awake while running"}</span>`,
					300,
				);

			// Buttons
			startBtn.classList.toggle("on", D.enabled);
			swap(q("#start-label"), D.enabled ? "end" : "start", `${icon(D.enabled ? "stop" : "play", 16)}<span style="margin-left:8px">${D.enabled ? "End session" : "Start session"}</span>`);
			q("#nudge").classList.toggle("moving", D.moving);
		}

		listeners.add(render);
		render();

		hero = {
			ripple() {
				const wrap = q("#core-wrap");
				const r = document.createElement("span");
				r.className = "ripple";
				wrap.prepend(r);
				setTimeout(() => r.remove(), 1700);
			},
			pressStart() {
				startBtn.classList.add("is-pressed");
				setTimeout(() => startBtn.classList.remove("is-pressed"), 150);
			},
		};

		buildTabs(mac);
	}

	// ── Window tabs: Focus / Insights / Settings ──────────────────────────────

	let currentTab = "focus";
	const TABS = ["focus", "insights", "settings"];

	function layoutSeg(seg, animate = true) {
		const thumb = $(".seg-thumb", seg);
		const btn = $('[aria-checked="true"]', seg);
		if (!thumb || !btn) return;
		if (!animate) thumb.style.transition = "none";
		thumb.style.width = `${btn.offsetWidth}px`;
		thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
		if (!animate) {
			void thumb.offsetWidth;
			thumb.style.transition = "";
		}
	}

	function buildTabs(mac) {
		const seg = $("#tabs", mac);
		requestAnimationFrame(() => layoutSeg(seg, false));
		let outTimer = 0;
		for (const b of $$("button", seg)) {
			b.addEventListener("click", () => {
				const next = b.dataset.tab;
				if (next === currentTab) return;
				const dir = TABS.indexOf(next) > TABS.indexOf(currentTab) ? 1 : -1;
				const from = $(`[data-view="${currentTab}"]`, mac);
				const to = $(`[data-view="${next}"]`, mac);
				for (const x of $$("button", seg)) x.setAttribute("aria-checked", String(x === b));
				layoutSeg(seg);
				clearTimeout(outTimer);
				for (const v of $$(".view", mac)) {
					if (v !== from && v !== to) {
						v.hidden = true;
						v.classList.remove("in", "out");
					}
				}
				from.classList.remove("in");
				from.style.setProperty("--dir", dir);
				from.classList.add("out");
				to.hidden = false;
				to.classList.remove("out");
				to.style.setProperty("--dir", dir);
				void to.offsetWidth;
				to.classList.add("in");
				outTimer = setTimeout(() => {
					from.hidden = true;
					from.classList.remove("out");
				}, 260);
				currentTab = next;
				if (next === "insights") showInsights();
				if (next === "settings") showSettings();
				emit();
			});
		}
	}

	// ── Sample stats (Insights.tsx) ───────────────────────────────────────────
	// One deterministic sample week shared by the window and the big card.

	function mulberry32(a) {
		return () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const DAY = 86_400_000;
	const WEEK = (() => {
		const rng = mulberry32(20261016);
		const days = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(Date.now() - i * DAY);
			const label = i === 0 ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" });
			const weekend = d.getDay() === 0 || d.getDay() === 6;
			const row = Array.from({ length: 24 }, (_, h) => {
				let base = 0;
				if (!weekend) {
					if (h >= 9 && h <= 18) base = 2.2;
					if (h === 12 || h === 13) base = 5.5; // lunch: away from the desk
					if (h === 15) base = 3.6;
					if (h === 10 || h === 16) base = 1.4; // heads-down, fewer idle gaps
				} else if (h >= 11 && h <= 16) {
					base = rng() < 0.4 ? 1.6 : 0;
				}
				if (i === 0 && h > 15) base = 0; // the day isn't over yet
				const v = Math.round(base * (0.55 + rng() * 0.9));
				return Math.max(0, v);
			});
			days.push({ label, row });
		}
		const total = days.reduce((s, d) => s + d.row.reduce((a, b) => a + b, 0), 0);
		const today = days[6].row.reduce((a, b) => a + b, 0);
		return { days, total, today };
	})();

	const LEVELS = [0.2, 0.42, 0.68, 1];
	const MIX = [
		["cmdtab", 0.58],
		["mouse", 0.21],
		["scroll", 0.14],
		["shift", 0.07],
	];
	const MIX_ALPHA = [1, 0.72, 0.52, 0.38];
	const hh = (h) => `${String(h).padStart(2, "0")}:00`;

	function buildHeat(grid, info, legend) {
		grid.replaceChildren();
		const max = Math.max(1, ...WEEK.days.flatMap((d) => d.row));
		grid.append(document.createElement("span"));
		for (let h = 0; h < 24; h++) {
			const l = document.createElement("span");
			l.className = "hl";
			l.textContent = h % 6 === 0 ? hh(h).slice(0, 2) : "";
			grid.append(l);
		}
		let peak = null;
		WEEK.days.forEach((d, di) => {
			const label = document.createElement("span");
			label.className = "dl";
			label.textContent = d.label;
			grid.append(label);
			d.row.forEach((v, hour) => {
				if (v > 0 && (!peak || v > peak.v)) peak = { day: d.label, hour, v };
				const wrap = document.createElement("span");
				wrap.className = "cell-wrap";
				// Diagonal wave: left to right, top to bottom.
				wrap.style.setProperty("--dl", `${hour * 14 + di * 30}ms`);
				const cell = document.createElement("span");
				cell.className = "cell";
				cell.style.height = "100%";
				const level = v === 0 ? -1 : Math.min(3, Math.floor((v / max) * 3.999));
				cell.style.backgroundColor = level < 0 ? "rgb(var(--ink) / 0.06)" : `rgb(var(--accent) / ${LEVELS[level]})`;
				cell.addEventListener("mouseenter", () => showInfo({ day: d.label, hour, v }, true));
				wrap.append(cell);
				grid.append(wrap);
			});
		});
		const showInfo = (p, hover) => {
			info.innerHTML = p
				? `${hover ? "" : "Busiest · "}${p.day} ${hh(p.hour)}<span style="color: rgb(var(--ink-3))">, ${p.v} ${p.v === 1 ? "move" : "moves"}</span>`
				: `<span style="color: rgb(var(--ink-3))">Nothing recorded yet</span>`;
		};
		grid.addEventListener("mouseleave", () => showInfo(peak, false));
		showInfo(peak, false);
		legend.innerHTML = `less${[-1, 0, 1, 2, 3]
			.map((l) => `<i style="background-color:${l < 0 ? "rgb(var(--ink) / 0.06)" : `rgb(var(--accent) / ${LEVELS[l]})`}"></i>`)
			.join("")}more`;
	}

	function buildMix(bar, list, total) {
		bar.innerHTML = MIX.map(
			([, f], i) =>
				`<i style="width:${f * 100}%;background-color:rgb(var(--accent) / ${MIX_ALPHA[i]});${i === 0 ? "border-radius:999px 0 0 999px" : ""}${i === MIX.length - 1 ? "border-radius:0 999px 999px 0" : ""}"></i>`,
		).join("");
		list.innerHTML = MIX.map(
			([name, f], i) =>
				`<div><i style="background-color:rgb(var(--accent) / ${MIX_ALPHA[i]})"></i><span>${ROUTINE_LABELS[name]}</span><em>${Math.round(f * total).toLocaleString()}</em></div>`,
		).join("");
	}

	function countUp(el, value, ms = 900) {
		if (REDUCE) {
			el.textContent = value.toLocaleString();
			return;
		}
		const start = performance.now();
		const from = Number(el.dataset.shown || 0);
		const step = (t) => {
			const k = Math.min(1, (t - start) / ms);
			const eased = 1 - Math.pow(1 - k, 4);
			const v = Math.round(from + (value - from) * eased);
			el.textContent = v.toLocaleString();
			if (k < 1) requestAnimationFrame(step);
			else el.dataset.shown = String(value);
		};
		requestAnimationFrame(step);
	}

	let insightsBuilt = false;
	function showInsights() {
		const root = $("#v-insights");
		if (!insightsBuilt) {
			insightsBuilt = true;
			root.innerHTML = `
				<div class="panel totals">
					<div><div class="big" data-k="today">0</div><div class="label">Today</div></div>
					<div><div class="big" data-k="week">0</div><div class="label">Last 7 days</div></div>
					<div><div class="big" data-k="all">0</div><div class="label">All time</div></div>
				</div>
				<div class="panel card-pad">
					<div class="card-head"><h4>When it happens</h4><span>Last 7 days</span></div>
					<div class="heat"></div>
					<div class="heat-foot"><span class="tabular"></span><span class="legend"></span></div>
				</div>
				<div class="panel card-pad">
					<div class="card-head" style="margin-bottom: 12px"><h4>Mix</h4><span>By action</span></div>
					<div class="mix-bar"></div>
					<div class="mix-list"></div>
				</div>
				<p class="local-note">${icon("lock", 12)}Everything here stays on this Mac</p>`;
			buildHeat($(".heat", root), $(".heat-foot .tabular", root), $(".legend", root));
			buildMix($(".mix-bar", root), $(".mix-list", root), WEEK.total);
			// The window's mix shows percentages, like the app.
			$$(".mix-list em", root).forEach((em, i) => (em.textContent = `${Math.round(MIX[i][1] * 100)}%`));
		}
		const heat = $(".heat", root);
		heat.classList.remove("live");
		void heat.offsetWidth;
		heat.classList.add("live");
		const extra = D.today - 41;
		countUp($('[data-k="today"]', root), WEEK.today + extra, 900);
		countUp($('[data-k="week"]', root), WEEK.total + extra, 1050);
		countUp($('[data-k="all"]', root), 1958 + WEEK.total + extra, 1200);
	}

	// ── Settings view (Settings.tsx) ──────────────────────────────────────────

	const MODES = [
		{ value: "cmdtab", title: "⌘-Tab", description: "Nudges the cursor, then presses ⌘-Tab 1 to 6 times." },
		{ value: "mouse", title: "Mouse only", description: "A small cursor nudge. Never changes focus." },
		{ value: "scroll", title: "Scroll", description: "One line up and back down. Net zero." },
		{ value: "shift", title: "Shift tap", description: "A single modifier key press. Silent." },
	];

	let settingsBuilt = false;
	function showSettings() {
		if (settingsBuilt) return;
		settingsBuilt = true;
		const root = $("#v-settings");
		const row = (ic, title, desc, key) => `
			<div class="row">
				${ic ? `<span class="row-ic">${icon(ic, 15)}</span>` : ""}
				<div class="row-txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</div>
				<button class="toggle" role="switch" aria-label="${title}" aria-checked="${D[key]}" data-setting="${key}"></button>
			</div>`;
		root.innerHTML = `
			<h3 class="sec-title">How it moves</h3>
			<div class="panel rows" role="radiogroup" aria-label="Activity mode">
				${MODES.map(
					(m) => `<button class="mode" role="radio" data-mode="${m.value}" aria-checked="${m.value === D.actionType}">
						<span class="radio"></span><span><b>${m.title}</b><small>${m.description}</small></span></button>`,
				).join("")}
			</div>
			<h3 class="sec-title">Pause when</h3>
			<div class="panel rows">
				${row("lock", "Screen is locked", "", "pauseOnLock")}
				${row("phone", "On a call", "Zoom, Teams, FaceTime, Webex, Discord.", "pauseOnCall")}
				${row("battery", "On battery", "", "pauseOnBattery")}
			</div>
			<h3 class="sec-title">Keep awake</h3>
			<div class="panel rows">
				${row("moon", "Block system sleep", "Runs pmset disablesleep while a session is on, even with the lid closed. Restored when it ends.", "preventSleep")}
			</div>
			<h3 class="sec-title">General</h3>
			<div class="panel rows">
				<div class="row">
					<div class="row-txt"><b>Appearance</b></div>
					<div class="seg" data-theme-seg role="radiogroup" aria-label="Appearance">
						<span class="seg-thumb" aria-hidden="true"></span>
						<button role="radio" data-theme-opt="auto">Auto</button>
						<button role="radio" data-theme-opt="light">Light</button>
						<button role="radio" data-theme-opt="dark">Dark</button>
					</div>
				</div>
			</div>`;
		for (const b of $$(".mode", root)) {
			b.addEventListener("click", () => {
				D.actionType = b.dataset.mode;
				for (const x of $$(".mode", root)) x.setAttribute("aria-checked", String(x === b));
				emit();
			});
		}
		for (const t of $$("[data-setting]", root)) {
			t.addEventListener("click", () => {
				const k = t.dataset.setting;
				D[k] = !D[k];
				t.setAttribute("aria-checked", String(D[k]));
				emit();
			});
		}
		wireThemeSeg($("[data-theme-seg]", root));
	}

	// ── Appearance ────────────────────────────────────────────────────────────

	const themeSegs = new Set();

	function currentTheme() {
		const t = document.documentElement.getAttribute("data-theme");
		return t === "light" || t === "dark" ? t : "auto";
	}

	function setTheme(pref) {
		if (pref === "auto") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", pref);
		try {
			if (pref === "auto") localStorage.removeItem("ft-theme");
			else localStorage.setItem("ft-theme", pref);
		} catch {}
		for (const seg of themeSegs) syncThemeSeg(seg, true);
	}

	function syncThemeSeg(seg, animate) {
		const cur = currentTheme();
		for (const b of $$("[data-theme-opt]", seg)) b.setAttribute("aria-checked", String(b.dataset.themeOpt === cur));
		layoutSeg(seg, animate);
	}

	function wireThemeSeg(seg) {
		if (!seg) return;
		themeSegs.add(seg);
		for (const b of $$("[data-theme-opt]", seg)) b.addEventListener("click", () => setTheme(b.dataset.themeOpt));
		requestAnimationFrame(() => syncThemeSeg(seg, false));
	}

	// ── Mood stage ────────────────────────────────────────────────────────────

	const MOODS = [
		{ m: "sleep", label: "Asleep", tone: "--ink-3", text: "No session running. Press Space and it wakes up." },
		{ m: "awake", label: "On duty", tone: "--accent", text: "Blinks, looks around and waits for you to step away." },
		{ m: "glance", label: "Glancing", tone: "--accent", text: "Just pressed ⌘-Tab, so its eyes dart across your apps." },
		{ m: "move", label: "Nudging", tone: "--accent", text: "Just moved the cursor a few pixels to the side." },
		{ m: "read", label: "Reading", tone: "--accent", text: "Just scrolled a line, and now it skims the page." },
		{ m: "happy", label: "Pleased", tone: "--accent", text: "Just tapped Shift. Small job, done well." },
		{ m: "listen", label: "Listening", tone: "--warn", text: "You're on a call. Headphones on, hands off until it ends." },
		{ m: "locked", label: "Locked", tone: "--warn", text: "Your screen is locked, so it naps until you're back." },
		{ m: "tired", label: "Low power", tone: "--warn", text: "Running on battery. It rests until you plug in." },
	];

	function buildMoods() {
		const dial = $("#mood-dial");
		if (!dial) return;
		const ticks = tickLines($("svg.ticks", dial));
		const core = $("#mood-core");
		const buddy = new Buddy($("#mood-buddy"), { follow: true });
		const pills = $("#mood-pills");
		const caption = $("#mood-caption");
		let idx = 1;
		let auto = true;
		let visible = false;
		let raf = 0;
		let replayTimer = 0;
		let autoTimer = 0;

		const scale = () => {
			const w = dial.getBoundingClientRect().width || 420;
			$("#mood-buddy").style.setProperty("--bs", (w / 420) * 2.5);
		};
		scale();
		new ResizeObserver(scale).observe(dial);

		pills.innerHTML = MOODS.map(
			(x, i) =>
				`<button class="mood-pill press" role="tab" id="mood-${x.m}" aria-selected="${i === idx}" style="--tone: var(${x.tone})"><i></i>${x.label}</button>`,
		).join("");
		// --tone holds a channel triplet, so the pill dot can use it with alpha.
		for (const [i, b] of $$(".mood-pill", pills).entries()) {
			b.style.setProperty("--tone", `var(${MOODS[i].tone})`);
			b.addEventListener("click", () => {
				auto = false;
				clearTimeout(autoTimer);
				select(i);
			});
		}

		function select(i) {
			idx = i;
			const x = MOODS[i];
			for (const [j, b] of $$(".mood-pill", pills).entries()) b.setAttribute("aria-selected", String(j === i));
			buddy.set(x.m, x.tone);
			lastStage = x;
			for (const fn of stageFns) fn(x);
			const state = x.m === "sleep" ? "idle" : x.tone === "--warn" ? "paused" : "active";
			coreStyle(core, state, x.tone);
			caption.innerHTML = `<b class="swap">${x.label}</b><span class="swap" style="--d:90ms">${x.text}</span>`;
			paintStatic();
			if (!raf && visible) raf = requestAnimationFrame(frame);
			clearInterval(replayTimer);
			if (x.m === "glance" || x.m === "move") replayTimer = setInterval(() => buddy.replay(), 2600);
			if (auto) {
				clearTimeout(autoTimer);
				autoTimer = setTimeout(() => {
					if (auto && visible) select((idx + 1) % MOODS.length);
				}, 3600);
			}
		}

		// Paused moods keep warn majors; asleep is neutral. Active moods get a
		// sweeping comet trail in the frame loop below.
		function paintStatic() {
			const x = MOODS[idx];
			ticks.forEach((l, i) => {
				const major = i % 6 === 0;
				l.style.transition = "stroke 600ms ease-out";
				l.setAttribute("stroke-width", major ? 2 : 1.2);
				l.style.stroke =
					x.tone === "--warn" && major ? "rgb(var(--warn) / 0.45)" : `rgb(var(--ink) / ${major ? 0.22 : 0.1})`;
			});
		}

		function frame(t) {
			raf = 0;
			const x = MOODS[idx];
			if (!visible || x.tone !== "--accent" || REDUCE) return;
			const headPos = ((t / 4200) % 1) * TICKS;
			ticks.forEach((l, i) => {
				const major = i % 6 === 0;
				const d = (headPos - i + TICKS) % TICKS;
				const lit = d < 26;
				const a = lit ? 0.15 + 0.85 * Math.pow(1 - d / 26, 1.6) : 0;
				l.style.transition = "none";
				l.setAttribute("stroke-width", lit ? (major ? 2.2 : 1.6) : major ? 2 : 1.2);
				l.style.stroke = lit ? `rgb(var(--accent) / ${a.toFixed(3)})` : `rgb(var(--ink) / ${major ? 0.22 : 0.1})`;
			});
			raf = requestAnimationFrame(frame);
		}

		new IntersectionObserver(
			([e]) => {
				visible = e.isIntersecting;
				if (visible) {
					if (!raf) raf = requestAnimationFrame(frame);
					if (auto) select(idx);
				}
			},
			{ threshold: 0.25 },
		).observe(dial);

		select(idx);
	}

	// ── Bento loops ───────────────────────────────────────────────────────────

	const CURSOR = [
		"X.......",
		"XX......",
		"XXX.....",
		"XXXX....",
		"XXXXX...",
		"XXXXXX..",
		"XXXXXXX.",
		"XXXXXXXX",
		"XXXXX...",
		"XX.XX...",
		"X...XX..",
		"....XX..",
		".....XX.",
		".....XX.",
	];
	// Pixel Heat: warm yellow at the tip cooling to mint, like the app icon.
	const HEAT = [
		[0, [255, 222, 89]],
		[0.35, [206, 240, 150]],
		[0.65, [112, 230, 170]],
		[1, [24, 168, 112]],
	];
	function heatAt(t) {
		for (let i = 1; i < HEAT.length; i++) {
			const [p1, c1] = HEAT[i];
			const [p0, c0] = HEAT[i - 1];
			if (t <= p1) {
				const k = (t - p0) / (p1 - p0);
				return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
			}
		}
		return HEAT[HEAT.length - 1][1];
	}

	function buildBento() {
		for (const el of $$("[data-pix]")) {
			el.style.gridTemplateColumns = "repeat(8, 9px)";
			CURSOR.forEach((row, r) => {
				for (const ch of row) {
					const i = document.createElement("i");
					if (ch === "X") {
						i.className = "on";
						const jitter = (Math.random() - 0.5) * 0.12;
						i.style.setProperty("--c", heatAt(clamp(r / (CURSOR.length - 1) + jitter, 0, 1)).join(" "));
					}
					el.append(i);
				}
			});
		}

		// Tiles only animate while on screen.
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) e.target.classList.toggle("live", e.isIntersecting);
			},
			{ threshold: 0.2 },
		);
		for (const t of $$("[data-live]")) io.observe(t);

		// ⌘-Tab: hold ⌘, tap Tab one to five times, let go.
		const sw = $("#switcher");
		if (!sw) return;
		const apps = $$(".app", sw);
		const cmd = $("#cmd-key");
		const tab = $("#tab-key");
		const tile = sw.closest(".tile");
		let sel = 0;
		const setSel = (i) => {
			sel = i;
			apps.forEach((a, j) => a.classList.toggle("sel", j === i));
		};
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		(async function loop() {
			for (;;) {
				await wait(1400);
				if (!tile.classList.contains("live") || REDUCE) continue;
				const n = 1 + Math.floor(Math.random() * 5);
				cmd.classList.add("down");
				await wait(260);
				for (let k = 0; k < n; k++) {
					tab.classList.add("down");
					setSel((sel + 1) % apps.length);
					await wait(140);
					tab.classList.remove("down");
					await wait(220);
				}
				await wait(260);
				cmd.classList.remove("down");
				const chosen = apps[sel];
				chosen.animate?.(
					[{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
					{ duration: 420, easing: SPRING },
				);
				await wait(900);
				setSel(0);
			}
		})();
	}

	// ── Back-off timeline ─────────────────────────────────────────────────────

	function buildTimeline() {
		const host = $("#timeline");
		if (!host) return;
		const W = 1000;
		const X0 = 118;
		const X1 = 990;
		const START = 9 * 60;
		const END = 18 * 60;
		const xOf = (min) => X0 + ((min - START) / (END - START)) * (X1 - X0);
		const rng = mulberry32(7);

		// Away stretches. Inside them you're idle, so it would move unless
		// a pause rule says otherwise.
		const ZONES = [
			{ id: "call", key: "pauseOnCall", from: 10 * 60 + 30, to: 11 * 60 + 15, label: "Call", icon: "phone" },
			{ id: "lock", key: "pauseOnLock", from: 12 * 60 + 25, to: 13 * 60 + 20, label: "Locked", icon: "lock" },
			{ id: "battery", key: "pauseOnBattery", from: 15 * 60 + 5, to: 15 * 60 + 55, label: "On battery", icon: "battery" },
		];
		const state = { pauseOnCall: true, pauseOnLock: true, pauseOnBattery: false };

		// You: bursts of work with short and long gaps between them.
		const busy = [];
		let t = START + 4;
		while (t < END - 4) {
			const z = ZONES.find((z) => t >= z.from - 2 && t < z.to);
			if (z) {
				t = z.to + 2;
				continue;
			}
			const len = 6 + rng() * 34;
			const nextZone = ZONES.find((z) => z.from > t);
			const end = Math.min(t + len, nextZone ? nextZone.from - 1 : END - 3, END - 3);
			if (end > t + 1) busy.push([t, end]);
			const gap = rng() < 0.55 ? 0.5 + rng() * 1.4 : 3 + rng() * 9;
			t = end + gap;
		}

		// Focus Timer: only in gaps, once you've been idle for 2 minutes,
		// then every 1.5 to 3 minutes until you're back.
		const ticks = [];
		const gaps = [];
		let prev = START;
		for (const [a, b] of busy) {
			gaps.push([prev, a]);
			prev = b;
		}
		gaps.push([prev, END]);
		for (const [a, b] of gaps) {
			let m = a + 2 + 1.5 + rng() * 1.5;
			while (m < b - 0.3) {
				const z = ZONES.find((z) => m >= z.from && m < z.to);
				ticks.push({ m, zone: z?.id ?? null, key: z?.key ?? null, h: 14 + Math.floor(rng() * 4) * 4 });
				m += 1.5 + rng() * 1.5;
			}
		}

		const LANE_YOU = 34;
		const LANE_FT = 96;
		const root = svg("svg", { viewBox: `0 0 ${W} 190`, role: "img", "aria-label": "A sample workday: your activity, Focus Timer's moves in your idle gaps, and paused stretches" });
		root.innerHTML = `
			<text class="tl-lane-label" x="0" y="${LANE_YOU + 4}">You</text>
			<text class="tl-lane-label" x="0" y="${LANE_FT + 4}">Focus Timer</text>`;
		const lane = (y) => {
			const r = svg("rect", { x: X0, y: y - 15, width: X1 - X0, height: 30, rx: 8 });
			r.style.fill = "rgb(var(--ink) / 0.035)";
			root.append(r);
		};
		lane(LANE_YOU);
		lane(LANE_FT);

		const zoneEls = {};
		for (const z of ZONES) {
			const g = svg("g", { class: "tl-zone" });
			const r = svg("rect", { x: xOf(z.from), y: 8, width: xOf(z.to) - xOf(z.from), height: 128, rx: 8 });
			r.style.fill = "rgb(var(--warn) / 0.1)";
			r.style.stroke = "rgb(var(--warn) / 0.35)";
			r.style.strokeDasharray = "3 4";
			const label = svg("text", { class: "tl-zone-label", x: xOf(z.from) + 8, y: 152 });
			label.style.fill = "rgb(var(--warn))";
			label.textContent = z.label;
			g.append(r, label);
			root.append(g);
			zoneEls[z.id] = g;
		}

		for (const [a, b] of busy) {
			const r = svg("rect", { x: xOf(a), y: LANE_YOU - 7, width: Math.max(2, xOf(b) - xOf(a)), height: 14, rx: 4 });
			r.style.fill = "rgb(var(--ink) / 0.22)";
			root.append(r);
		}

		const tickEls = ticks.map((tk) => {
			const x = xOf(tk.m);
			const l = svg("line", { x1: x, x2: x, y1: LANE_FT - tk.h / 2, y2: LANE_FT + tk.h / 2, "stroke-width": 2.4, "stroke-linecap": "round", class: "tl-tick" });
			l.style.stroke = "rgb(var(--accent))";
			root.append(l);
			return l;
		});

		for (let hr = 9; hr <= 18; hr++) {
			const x = xOf(hr * 60);
			const tk = svg("line", { x1: x, x2: x, y1: 166, y2: 171 });
			tk.style.stroke = "rgb(var(--ink) / 0.2)";
			const tx = svg("text", { class: "tl-hour", x, y: 186, "text-anchor": hr === 18 ? "end" : hr === 9 ? "start" : "middle" });
			tx.textContent = `${String(hr).padStart(2, "0")}:00`;
			root.append(tk, tx);
		}
		host.append(root);

		const countEl = $("#tl-count");
		let shown = 0;
		function apply(animate) {
			let n = 0;
			ticks.forEach((tk, i) => {
				const off = tk.key != null && state[tk.key];
				tickEls[i].classList.toggle("off", off);
				if (!off) n++;
			});
			for (const z of ZONES) zoneEls[z.id].style.opacity = state[z.key] ? "1" : "0.35";
			if (animate && !REDUCE) {
				const from = shown;
				const t0 = performance.now();
				const step = (t) => {
					const k = Math.min(1, (t - t0) / 600);
					countEl.textContent = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
					if (k < 1) requestAnimationFrame(step);
				};
				requestAnimationFrame(step);
			} else countEl.textContent = n;
			shown = n;
		}

		const toggles = $("#tl-toggles");
		toggles.innerHTML = ZONES.map(
			(z) =>
				`<button class="tl-toggle press" data-key="${z.key}" aria-pressed="${state[z.key]}">${icon(z.icon, 15)}Pause ${z.id === "call" ? "on calls" : z.id === "lock" ? "when locked" : "on battery"}<span class="toggle" aria-checked="${state[z.key]}"></span></button>`,
		).join("");
		for (const b of $$(".tl-toggle", toggles)) {
			b.addEventListener("click", () => {
				const k = b.dataset.key;
				state[k] = !state[k];
				b.setAttribute("aria-pressed", String(state[k]));
				$(".toggle", b).setAttribute("aria-checked", String(state[k]));
				apply(true);
			});
		}

		// Ticks grow in when the card first comes into view.
		tickEls.forEach((l) => l.classList.add("off"));
		new IntersectionObserver(
			([e], obs) => {
				if (!e.isIntersecting) return;
				obs.disconnect();
				tickEls.forEach((l, i) => (l.style.transitionDelay = `${i * 12}ms`));
				apply(true);
				setTimeout(() => tickEls.forEach((l) => (l.style.transitionDelay = "")), 2000);
			},
			{ threshold: 0.35 },
		).observe(host);
	}

	// ── Insights band ─────────────────────────────────────────────────────────

	function buildInsights() {
		const grid = $("#heat-big");
		if (!grid) return;
		buildHeat(grid, $("#heat-big-info"), $("#heat-big-legend"));
		buildMix($("#mix-big-bar"), $("#mix-big-list"), WEEK.total);
		const vals = [WEEK.today, WEEK.total, 1958 + WEEK.total];
		$$("#stat-stack [data-count]").forEach((el, i) => (el.dataset.count = vals[i]));
		new IntersectionObserver(
			([e], obs) => {
				if (!e.isIntersecting) return;
				obs.disconnect();
				$$("#stat-stack [data-count]").forEach((el, i) => countUp(el, Number(el.dataset.count), 900 + i * 150));
			},
			{ threshold: 0.4 },
		).observe($("#stat-stack"));
	}

	// ── Keyboard section and menu bar ─────────────────────────────────────────

	function buildKeys() {
		const host = $("#kb-buddy");
		if (!host) return;
		const mini = new Buddy(host);
		const text = $("#kb-text");
		const status = $("#mb-status");
		const tog = $("#mb-toggle");
		function render() {
			const now = Date.now();
			const reacting = D.lastActionAt != null && now - D.lastActionAt < 2800;
			mini.set(
				moodFor({ enabled: D.enabled, pauseReason: null, routine: D.lastRoutine, fresh: reacting || D.moving }),
				D.enabled ? "--accent" : "--ink-3",
			);
			const next = D.nextActionAt ? mmss((D.nextActionAt - now) * SPEED) : "";
			swap(
				text,
				D.enabled ? "on" : "off",
				D.enabled
					? `<span><b>Session running.</b> Next move in <span class="mono tabular" id="kb-next">${next}</span></span>`
					: `<span><b>Idle.</b> Press Space to start a session.</span>`,
			);
			const nx = $("#kb-next");
			if (nx) nx.textContent = next;
			status.textContent = D.enabled ? `Active · next in ${next}` : "Idle";
			tog.textContent = D.enabled ? "Pause" : "Resume";
		}
		listeners.add(render);
		render();
		for (const k of $$(".keycap[data-key]")) {
			k.addEventListener("click", () => {
				if (k.dataset.key === "space") toggle(true);
				else moveNow();
			});
		}
	}

	// Space and R drive the demo, like they drive the app. Space only while a
	// demo is on screen, so it still scrolls the page everywhere else.
	const inView = { top: false, hero: false, keys: false };
	function watchDemoViews() {
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) inView[e.target.dataset.demo] = e.isIntersecting;
			},
			{ threshold: 0.45 },
		);
		const m = $("#mac-fit");
		const k = $(".kb-grid");
		const top = $("#hero");
		if (top) {
			top.dataset.demo = "top";
			io.observe(top);
		}
		if (m) {
			m.dataset.demo = "hero";
			io.observe(m);
		}
		if (k) {
			k.dataset.demo = "keys";
			io.observe(k);
		}
	}

	function flashKey(key) {
		const el = $(`.keycap[data-key="${key}"]`);
		if (!el) return;
		el.classList.add("down");
		setTimeout(() => el.classList.remove("down"), 170);
	}

	addEventListener("keydown", (e) => {
		const t = e.target;
		if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
		if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
		const demo = inView.top || inView.hero || inView.keys;
		if (e.code === "Space") {
			if (!demo || (t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName))) return;
			e.preventDefault();
			flashKey("space");
			if (inView.hero) hero?.pressStart();
			toggle(true);
		} else if (e.key === "r" || e.key === "R") {
			if (!demo) return;
			flashKey("r");
			moveNow();
		}
	});

	// ── Fitting the window to small screens ───────────────────────────────────

	function fitMac() {
		const fit = $("#mac-fit");
		const stage = $(".hero-stage");
		if (!fit || !stage) return;
		const narrow = innerWidth <= 1000;
		const w = narrow ? stage.clientWidth : 440;
		const hAvail = narrow ? Infinity : innerHeight - 120;
		const s = clamp(Math.min(w / 440, hAvail / 700, 1), 0.6, 1);
		fit.style.setProperty("--s", s.toFixed(4));
	}

	// ── Release info ──────────────────────────────────────────────────────────
	// Version and size come from the latest GitHub release when it's reachable;
	// the static fallbacks in the markup stay otherwise.

	async function releaseInfo() {
		let data = null;
		try {
			data = JSON.parse(sessionStorage.getItem("ft-release") || "null");
		} catch {}
		if (!data) {
			try {
				const r = await fetch("https://api.github.com/repos/gab-cat/focus-timer/releases/latest", {
					headers: { Accept: "application/vnd.github+json" },
				});
				if (!r.ok) return;
				const j = await r.json();
				const dmg = (j.assets || []).find((a) => a.name.endsWith(".dmg"));
				data = { tag: j.tag_name, size: dmg?.size ?? null, url: dmg?.browser_download_url ?? null };
				try {
					sessionStorage.setItem("ft-release", JSON.stringify(data));
				} catch {}
			} catch {
				return;
			}
		}
		if (data.tag) for (const el of $$("[data-version]")) el.textContent = data.tag;
		if (data.size) {
			const mb = (data.size / 1_000_000).toFixed(0);
			for (const el of $$("[data-size]")) el.textContent = `, about ${mb} MB`;
		}
		if (data.tag) {
			const meta = $("#final-meta");
			if (meta) meta.textContent = `Free and open source. Version ${data.tag.replace(/^v/, "")} for Apple Silicon Macs.`;
		}
	}

	// ── Final dial: ticks fill round, lap, and start over ─────────────────────

	function buildFinalDial() {
		const dial = $("#final-dial");
		if (!dial) return;
		const s = $("svg", dial);
		const tg = svg("g");
		const wave = svg("g");
		const burst = svg("g");
		s.append(tg, wave, burst);
		const ticks = tickLines(tg);
		let visible = false;
		let i = 0;
		new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.3 }).observe(dial);
		if (REDUCE) return;
		setInterval(() => {
			if (!visible) return;
			if (i < 0) {
				i++;
				return;
			}
			if (i < TICKS) {
				const l = ticks[i];
				l.style.transition = "stroke 400ms ease-out";
				l.style.stroke = "rgb(var(--accent) / 0.9)";
				i++;
				return;
			}
			lapBurst(wave, burst);
			ticks.forEach((l, j) => {
				const major = j % 6 === 0;
				l.style.transition = `stroke 600ms ease-out ${160 + (TICKS - 1 - j) * 9}ms`;
				l.style.stroke = `rgb(var(--ink) / ${major ? 0.22 : 0.1})`;
			});
			i = -30;
		}, 70);
	}

	// ── Nav: a face for a logo, a live status, a thumb that follows you ───────

	function buildNav() {
		const face = $("#brand-face");
		if (face) {
			const b = new Buddy(face, { follow: true });
			let happyUntil = 0;
			const render = () => {
				const now = Date.now();
				const reacting = D.lastActionAt != null && now - D.lastActionAt < 2800;
				let mood = moodFor({ enabled: D.enabled, pauseReason: null, routine: D.lastRoutine, fresh: reacting || D.moving });
				if (now < happyUntil) mood = "happy";
				b.set(mood, mood === "sleep" ? "--ink-3" : "--accent");
			};
			listeners.add(render);
			render();
			for (const a of $$("[data-download]")) {
				a.addEventListener("pointerenter", () => {
					happyUntil = Date.now() + 1800;
					render();
				});
			}
		}

		// Live status: click it to wake or sleep the demo session.
		const st = $("#nav-status");
		const text = $("#ns-text");
		const time = $("#ns-time");
		if (st) {
			st.addEventListener("click", () => toggle(true));
			const render = () => {
				st.classList.toggle("on", D.enabled);
				const label = D.enabled ? "Awake" : "Asleep";
				if (text.textContent !== label) text.textContent = label;
				time.textContent = D.enabled && D.nextActionAt ? mmss((D.nextActionAt - Date.now()) * SPEED) : "";
				time.style.display = D.enabled ? "" : "none";
				st.title = D.enabled ? "Next demo move. Click to end the session." : "Click to start a demo session.";
			};
			listeners.add(render);
			render();
		}

		// Thumb: sits under the hovered link, or the section you're in.
		const links = $("#nav-links");
		if (!links) return;
		const thumb = $(".nav-thumb", links);
		const anchors = $$("a", links);
		let current = null;
		let hover = null;
		const place = () => {
			const target = hover ?? current;
			anchors.forEach((a) => a.classList.toggle("current", a === current));
			if (!target) {
				thumb.style.opacity = "0";
				return;
			}
			thumb.style.opacity = "1";
			thumb.style.width = `${target.offsetWidth}px`;
			thumb.style.transform = `translateX(${target.offsetLeft}px)`;
		};
		for (const a of anchors) {
			a.addEventListener("pointerenter", () => {
				hover = a;
				place();
			});
		}
		links.addEventListener("pointerleave", () => {
			hover = null;
			place();
		});
		const byId = new Map(anchors.map((a) => [a.getAttribute("href").slice(1), a]));
		const seen = new Map();
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
				let best = null;
				let ratio = 0;
				for (const [id, r] of seen) {
					if (r > ratio && byId.has(id)) {
						best = byId.get(id);
						ratio = r;
					}
				}
				current = best;
				place();
			},
			{ threshold: [0, 0.2, 0.4, 0.6], rootMargin: "-30% 0px -40% 0px" },
		);
		for (const id of byId.keys()) {
			const sec = document.getElementById(id);
			if (sec) io.observe(sec);
		}
	}

	// ── The buddy talks: idle nudges and a tab that keeps watch ───────────────

	function buildToast() {
		const toast = $("#toast");
		const textEl = $("#toast-text");
		if (!toast) return;
		const face = new Buddy($("#toast-face"));
		face.set("happy", "--accent");
		let hideTimer = 0;
		const say = (msg, mood = "happy", tone = "--accent") => {
			face.set(mood, tone);
			textEl.textContent = msg;
			toast.classList.add("show");
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => toast.classList.remove("show"), 5200);
		};
		window.FT.say = say;

		// Sit still long enough and it does exactly what the app does.
		const LINES = [
			"You went quiet, so I made a move. That's the whole job.",
			"Still here. Still holding the fort.",
			"Another nudge while you were away. Your Mac didn't notice a thing.",
		];
		let idleTimer = 0;
		let told = 0;
		const IDLE_MS = 28_000;
		const arm = () => {
			clearTimeout(idleTimer);
			if (told >= LINES.length) return;
			idleTimer = setTimeout(() => {
				if (document.hidden) return arm();
				if (!D.enabled) toggle(false);
				else moveNow();
				say(LINES[told++], "glance");
				arm();
			}, IDLE_MS);
		};
		for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) {
			addEventListener(ev, arm, { passive: true });
		}
		arm();

		// The tab keeps watch while you're somewhere else.
		const title = document.title;
		let backTimer = 0;
		document.addEventListener("visibilitychange", () => {
			clearTimeout(backTimer);
			if (document.hidden) {
				document.title = "Holding the fort · Focus Timer";
			} else {
				document.title = "Welcome back · Focus Timer";
				backTimer = setTimeout(() => (document.title = title), 2200);
			}
		});

		console.log(
			"%c ▮▮ %c Hi. I'm the buddy from Focus Timer. Source: https://github.com/gab-cat/focus-timer",
			"background:#0c0c0d;color:#70e6aa;font-weight:700;border-radius:4px;padding:2px 4px",
			"color:inherit",
		);
	}

	// ── Footer: a readout of this visit, and a wordmark made of hot pixels ────

	function buildFooter() {
		const visit = $("#foot-visit");
		const startedAt = Date.now();
		const movesAtStart = D.today;
		if (visit) {
			const render = () => {
				const secs = Math.round((Date.now() - startedAt) / 1000);
				const moves = D.today - movesAtStart;
				const t = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
				visit.innerHTML =
					moves === 0
						? `You've been here <b>${t}</b>. The buddy hasn't needed to move yet.`
						: `You've been here <b>${t}</b>. The buddy made <b>${moves} ${moves === 1 ? "move" : "moves"}</b> while you read.`;
			};
			listeners.add(render);
			render();
		}

		const host = $("#pixel-word");
		if (!host) return;
		const canvas = $("canvas", host);
		const ctx = canvas.getContext("2d");
		let cells = [];
		let cols = 0;
		let rows = 0;
		let cell = 0;
		let visible = false;
		const local = { x: -1e4, y: -1e4, t: 0 };

		function layout() {
			const w = host.clientWidth;
			const h = host.clientHeight;
			if (!w || !h) return;
			const dpr = Math.min(devicePixelRatio || 1, 2);
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			cols = w < 700 ? 96 : 168;
			cell = w / cols;
			rows = Math.floor(h / cell);
			// Rasterise the wordmark at grid resolution, then read it back.
			const off = document.createElement("canvas");
			off.width = cols;
			off.height = rows;
			const o = off.getContext("2d");
			const word = "Focus Timer";
			const lines = word.split("\n");
			let size = rows * (lines.length > 1 ? 0.46 : 0.86);
			o.font = `700 ${size}px Geist, ui-sans-serif, system-ui, sans-serif`;
			const widest = Math.max(...lines.map((l) => o.measureText(l).width));
			if (widest > cols * 0.98) size *= (cols * 0.98) / widest;
			o.font = `700 ${size}px Geist, ui-sans-serif, system-ui, sans-serif`;
			o.textAlign = "center";
			o.textBaseline = "middle";
			o.fillStyle = "#fff";
			lines.forEach((l, i) => o.fillText(l, cols / 2, rows / 2 + (i - (lines.length - 1) / 2) * size * 0.98));
			const data = o.getImageData(0, 0, cols, rows).data;
			cells = [];
			for (let y = 0; y < rows; y++) {
				for (let x = 0; x < cols; x++) {
					cells.push({ on: data[(y * cols + x) * 4 + 3] > 110, heat: 0 });
				}
			}
		}

		const ACC = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().split(/\s+/).map(Number);
		const INK = () => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim().split(/\s+/).map(Number);
		let acc = ACC();
		let ink = INK();
		// Bright accent means a dark page; lit cells need more weight on light.
		let base = acc[1] > 200 ? 0.55 : 0.85;
		const retheme = () => {
			acc = ACC();
			ink = INK();
			base = acc[1] > 200 ? 0.55 : 0.85;
		};
		new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);

		host.addEventListener("pointermove", (e) => {
			const r = host.getBoundingClientRect();
			local.x = e.clientX - r.left;
			local.y = e.clientY - r.top;
			local.t = performance.now();
		});
		host.addEventListener("pointerleave", () => {
			local.x = local.y = -1e4;
		});

		function draw(t) {
			if (!visible || !cells.length) return;
			const w = host.clientWidth;
			const h = host.clientHeight;
			ctx.clearRect(0, 0, w, h);
			const gap = Math.max(1, cell * 0.16);
			const s = cell - gap;
			const rad = Math.min(3, s * 0.28);
			// An idle shimmer drifts across even when no one's pointing.
			const sweep = ((t / 5200) % 1.4) * cols - cols * 0.2;
			for (let y = 0; y < rows; y++) {
				for (let x = 0; x < cols; x++) {
					const c = cells[y * cols + x];
					const cx = x * cell + cell / 2;
					const cy = y * cell + cell / 2;
					const d = Math.hypot(cx - local.x, cy - local.y);
					const near = Math.max(0, 1 - d / (cell * 9));
					const shimmer = REDUCE ? 0 : Math.max(0, 1 - Math.abs(x - sweep) / 7) * 0.35;
					c.heat = Math.max(c.heat * 0.93, near, c.on ? shimmer : 0);
					let r;
					let g;
					let b;
					let a;
					if (c.on) {
						// Mint at rest, warming to the icon's yellow under the pointer.
						const hc = heatAt(1 - c.heat);
						const k = c.heat;
						r = acc[0] + (hc[0] - acc[0]) * k;
						g = acc[1] + (hc[1] - acc[1]) * k;
						b = acc[2] + (hc[2] - acc[2]) * k;
						a = base + (1 - base) * k;
					} else {
						r = ink[0];
						g = ink[1];
						b = ink[2];
						a = 0.045 + c.heat * 0.12;
					}
					ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
					ctx.beginPath();
					ctx.roundRect(x * cell + gap / 2, y * cell + gap / 2, s, s, rad);
					ctx.fill();
				}
			}
		}

		let raf = 0;
		const loop = (t) => {
			raf = 0;
			draw(t);
			if (visible) raf = requestAnimationFrame(loop);
		};
		new IntersectionObserver(([e]) => {
			visible = e.isIntersecting;
			if (visible && !raf) raf = requestAnimationFrame(loop);
		}).observe(host);
		new ResizeObserver(layout).observe(host);
		document.fonts?.ready.then(layout);
		layout();
	}

	// ── Page plumbing ─────────────────────────────────────────────────────────

	function reveals() {
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					e.target.classList.add("in");
					io.unobserve(e.target);
				}
			},
			{ threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
		);
		for (const el of $$(".reveal")) io.observe(el);
	}

	function stickyNav() {
		const nav = $("#nav");
		const sentinel = document.createElement("div");
		sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px;pointer-events:none";
		document.body.prepend(sentinel);
		new IntersectionObserver(([e]) => nav.classList.toggle("is-stuck", !e.isIntersecting)).observe(sentinel);
	}

	function init() {
		paintIcons();
		buildHero();
		buildMoods();
		buildBento();
		buildTimeline();
		buildInsights();
		buildKeys();
		buildFinalDial();
		buildNav();
		buildToast();
		buildFooter();
		watchDemoViews();
		reveals();
		stickyNav();
		wireThemeSeg($("#theme-seg"));
		for (const a of $$("[data-download]")) a.href = DMG_URL;

		fitMac();
		const stage = $(".hero-stage");
		if (stage) new ResizeObserver(fitMac).observe(stage);
		addEventListener("resize", fitMac);
		const mac = $("#mac");
		mac?.addEventListener("animationend", () => (mac.style.animation = "none"), { once: true });

		// Wake it up once the window has landed, unless the visitor got there first.
		setTimeout(() => {
			if (D.touched || D.enabled) return;
			hero?.pressStart();
			toggle(false);
		}, 2700);

		releaseInfo();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
})();
