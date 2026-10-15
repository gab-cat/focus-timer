// Focus Timer site · the buddy, in 3D.
//
// The app's stand-in (two glowing eyes that act out what it's doing) gets a
// body: a ceramic companion with a black glass visor, floating in front of
// the app's 72-tick dial. It reads the same demo session as the page
// (window.FT, from app.js), so the dial fills, laps and throws sparks on the
// same beat as the window demo, and the eyes use the app's exact mood shapes.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const FT = window.FT;

// Hero framing: horizontal position (fraction of the canvas), camera height
// and aim. Vertical placement and scale come from the layout (see resize).
const HERO = { x: 0.5, camY: 0.35, lookY: 0.3, narrowAt: 1000 };
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t, 0, 1)));
const easeInOut = (t) => {
	t = clamp(t, 0, 1);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

// A small spring, for the same overshoot the app gets from its spring curve.
class Spring {
	constructor(v, k = 170, c = 15) {
		this.x = v;
		this.t = v;
		this.v = 0;
		this.k = k;
		this.c = c;
	}
	step(dt) {
		const f = (this.t - this.x) * this.k - this.v * this.c;
		this.v += f * dt;
		this.x += this.v * dt;
		return this.x;
	}
}

// ── Theme ───────────────────────────────────────────────────────────────────

function isDark() {
	const t = document.documentElement.getAttribute("data-theme");
	if (t === "dark" || t === "light") return t === "dark";
	return matchMedia("(prefers-color-scheme: dark)").matches;
}

const rgb = (s) => new THREE.Color(s);
const PALETTE = {
	dark: {
		bg: rgb("rgb(12,12,13)"),
		accent: rgb("rgb(112,230,170)"),
		warn: rgb("rgb(242,188,92)"),
		tick: rgb("rgb(36,36,40)"),
		tickMajor: rgb("rgb(64,64,70)"),
		shell: 0xd6d9d3,
		trim: 0x1a1c1f,
	},
	light: {
		bg: rgb("rgb(243,243,240)"),
		accent: rgb("rgb(20,158,101)"),
		warn: rgb("rgb(190,124,18)"),
		tick: rgb("rgb(214,214,210)"),
		tickMajor: rgb("rgb(180,180,176)"),
		shell: 0x2b2e33,
		trim: 0x101113,
	},
};
// Eyes sit on black glass in both themes, so they always use the bright set.
const EYE = {
	"--accent": rgb("rgb(112,230,170)"),
	"--warn": rgb("rgb(242,188,92)"),
	"--ink-3": rgb("rgb(132,136,142)"),
};

// three's NeutralToneMapping (Khronos PBR Neutral), and its inverse found by
// iterating, so a clear colour lands on the page background after mapping.
function neutral([r, g, b]) {
	const start = 0.8 - 0.04;
	const x = Math.min(r, g, b);
	const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	let c = [r - offset, g - offset, b - offset];
	const peak = Math.max(...c);
	if (peak < start) return c;
	const d = 1 - start;
	const newPeak = 1 - (d * d) / (peak + d - start);
	c = c.map((v) => (v * newPeak) / peak);
	const k = 1 - 1 / (0.15 * (peak - newPeak) + 1);
	return c.map((v) => v + (newPeak - v) * k);
}

function pageClear(target) {
	const t = [target.r, target.g, target.b];
	let x = [...t];
	for (let i = 0; i < 60; i++) {
		const y = neutral(x);
		x = x.map((v, j) => Math.max(0, v + (t[j] - y[j]) * 0.9));
	}
	return new THREE.Color(x[0], x[1], x[2]);
}

// ── Textures ────────────────────────────────────────────────────────────────

function canvasTex(size, draw) {
	const c = document.createElement("canvas");
	c.width = c.height = size;
	draw(c.getContext("2d"), size);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

const TEX = {
	glow: canvasTex(128, (g, s) => {
		const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
		r.addColorStop(0, "rgba(255,255,255,1)");
		r.addColorStop(0.35, "rgba(255,255,255,0.35)");
		r.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = r;
		g.fillRect(0, 0, s, s);
	}),
	dot: canvasTex(64, (g, s) => {
		const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
		r.addColorStop(0, "rgba(255,255,255,1)");
		r.addColorStop(0.45, "rgba(255,255,255,0.8)");
		r.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = r;
		g.fillRect(0, 0, s, s);
	}),
	z: canvasTex(64, (g, s) => {
		g.fillStyle = "#fff";
		g.font = `600 ${s * 0.8}px "Geist Mono", ui-monospace, monospace`;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText("z", s / 2, s / 2 + 2);
	}),
};

// ── Eyes (Buddy.tsx SHAPES, in px, converted with K) ────────────────────────

const K = 0.028;
const SHAPES = {
	sleep: { w: 22, h: 4, rt: 3, rb: 3, y: 7 },
	locked: { w: 22, h: 4, rt: 3, rb: 3, y: 7 },
	awake: { w: 19, h: 26, rt: 9, rb: 9 },
	glance: { w: 19, h: 24, rt: 9, rb: 9 },
	move: { w: 19, h: 24, rt: 9, rb: 9 },
	read: { w: 20, h: 16, rt: 8, rb: 8, y: 6 },
	happy: { w: 22, h: 12, rt: 12, rb: 4, y: -1 },
	listen: { w: 19, h: 21, rt: 9, rb: 9, y: 2 },
	tired: { w: 21, h: 9, rt: 5, rb: 5, y: 5, tilt: 10 },
};
const OPEN = ["awake", "glance", "move", "read", "listen"];

function eyeGeometry(w, h, rt, rb) {
	w = Math.max(w, 0.02);
	h = Math.max(h, 0.02);
	rt = Math.min(rt, w / 2, h);
	rb = Math.min(rb, w / 2, h);
	if (rt + rb > h) {
		const k = h / (rt + rb);
		rt *= k;
		rb *= k;
	}
	const x = -w / 2;
	const y = -h / 2;
	const s = new THREE.Shape();
	s.moveTo(x + rb, y);
	s.lineTo(x + w - rb, y);
	s.quadraticCurveTo(x + w, y, x + w, y + rb);
	s.lineTo(x + w, y + h - rt);
	s.quadraticCurveTo(x + w, y + h, x + w - rt, y + h);
	s.lineTo(x + rt, y + h);
	s.quadraticCurveTo(x, y + h, x, y + h - rt);
	s.lineTo(x, y + rb);
	s.quadraticCurveTo(x, y, x + rb, y);
	return new THREE.ShapeGeometry(s, 10);
}

function moodFor({ enabled, routine, fresh }) {
	if (!enabled) return "sleep";
	if (fresh) {
		if (routine === "scroll") return "read";
		if (routine === "cmdtab") return "glance";
		if (routine === "mouse") return "move";
		if (routine === "shift") return "happy";
	}
	return "awake";
}

// ── Pointer ─────────────────────────────────────────────────────────────────

const pointer = { x: innerWidth * 0.7, y: innerHeight * 0.4, t: -1e9 };
addEventListener(
	"pointermove",
	(e) => {
		pointer.x = e.clientX;
		pointer.y = e.clientY;
		pointer.t = performance.now();
	},
	{ passive: true },
);

// ── The dial (Focus.tsx geometry, as a ring of light behind the bot) ────────

const TICKS = 72;
const RING_R = 2.75;
const ARC_R = RING_R - 0.48;

const ARC_VERT = `
	varying vec3 vPos;
	void main() {
		vPos = position;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}`;
const ARC_FRAG = `
	uniform float uP;
	uniform vec3 uColor;
	uniform float uAlpha;
	varying vec3 vPos;
	void main() {
		float a = atan(vPos.x, vPos.y);
		if (a < 0.0) a += 6.2831853;
		float f = a / 6.2831853;
		if (f > uP) discard;
		float k = uP > 0.0 ? f / uP : 0.0;
		gl_FragColor = vec4(uColor * (0.5 + 1.1 * pow(k, 1.8)), uAlpha);
	}`;

// ── Scene ───────────────────────────────────────────────────────────────────

const scenes = new Set();

class BuddyScene {
	constructor(host, opts) {
		this.host = host;
		this.mode = opts.mode; // "hero" | "stage" | "final"
		this.opts = opts;
		this.visible = false;
		this.t0 = performance.now() / 1000;

		const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
		renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.5 : 1.75));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		// Neutral rolls off the hot highlights; the clear colour is run through
		// its inverse (pageClear) so the canvas still matches the page exactly.
		renderer.toneMapping = THREE.NeutralToneMapping;
		this.renderer = renderer;
		host.append(renderer.domElement);

		const scene = new THREE.Scene();
		this.scene = scene;
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		pmrem.dispose();

		this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
		this.camDist = 14;

		this.composer = new EffectComposer(renderer);
		this.composer.addPass(new RenderPass(scene, this.camera));
		// Only HDR emissives (eyes, lit ticks, comet) cross the threshold.
		this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.32, 1.7);
		this.composer.addPass(this.bloom);
		this.composer.addPass(new OutputPass());

		this.world = new THREE.Group();
		scene.add(this.world);

		this.lights();
		this.buildBot();
		if (opts.halo) this.buildHalo();
		if (opts.platform !== false) this.buildPlatform();
		if (opts.floor) this.buildFloor();
		this.buildParticles(opts.particles ?? 260);
		this.buildSparks();
		this.buildZzz();

		// Animation state
		this.mood = this.mode === "stage" ? "awake" : "sleep";
		this.tone = this.mode === "stage" ? "--accent" : "--ink-3";
		this.eyeColor = EYE[this.tone].clone();
		this.ringTone = new THREE.Color();
		const sh = SHAPES[this.mood];
		this.eye = {
			w: new Spring(sh.w, 210, 15),
			h: new Spring(sh.h, 210, 15),
			rt: new Spring(sh.rt, 180, 18),
			rb: new Spring(sh.rb, 180, 18),
			y: new Spring(sh.y ?? 0, 170, 14),
			tilt: new Spring(sh.tilt ?? 0, 170, 14),
		};
		this.eyeDims = "";
		this.look = { x: new Spring(0, 160, 13), y: new Spring(0, 160, 13) };
		this.head = { yaw: new Spring(0, 60, 11), pitch: new Spring(0, 60, 11), roll: new Spring(0, 60, 11) };
		this.bodyX = new Spring(0, 90, 10);
		this.blink = 1;
		this.nextBlink = 2 + Math.random() * 3;
		this.blinkAt = -1;
		this.saccadeAt = 0;
		this.saccade = { x: 0, y: 0 };
		this.script = [];
		this.hopUntil = 0;
		this.eyeOn = this.opts.intro && !REDUCE ? 0 : 1;
		this.lapKey = null;
		this.lapAt = -10;
		this.actKey = null;
		this.actAt = -10;
		this.ripples = [];
		this.stageMood = null;
		this.wakeUntil = 0;
		this.introStart = this.opts.intro && !REDUCE ? performance.now() / 1000 : -10;

		this.applyTheme();

		new ResizeObserver(() => this.resize()).observe(host);
		this.resize();
		if (this.mode === "hero") document.fonts?.ready.then(() => this.resize());
		new IntersectionObserver(([e]) => (this.visible = e.isIntersecting), { threshold: 0.01 }).observe(host);

		host.addEventListener("click", (e) => this.onClick(e));
		scenes.add(this);
		requestAnimationFrame(() => host.classList.add("ready"));
	}

	// ── Building ─────────────────────────────────────────────────────────────

	lights() {
		const key = new THREE.DirectionalLight(0xffffff, 0.7);
		key.position.set(-3.5, 3.2, 8);
		this.scene.add(key);
		this.rim = new THREE.PointLight(0x70e6aa, 8, 14, 2);
		this.rim.position.set(2.6, 1.8, -2.6);
		this.scene.add(this.rim);
		this.under = new THREE.PointLight(0x70e6aa, 3, 7, 2);
		this.under.position.set(0, -2.4, 1.4);
		this.scene.add(this.under);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1a221e, 0.25));
	}

	glowMat(color, intensity = 2) {
		const m = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity) });
		m.userData.base = color.clone();
		m.userData.k = intensity;
		return m;
	}

	buildBot() {
		const bot = new THREE.Group();
		this.bot = bot;
		this.world.add(bot);

		this.shellMat = new THREE.MeshPhysicalMaterial({
			color: 0xd6d9d3,
			roughness: 0.45,
			metalness: 0,
			clearcoat: 0.45,
			clearcoatRoughness: 0.28,
			envMapIntensity: 0.4,
		});
		this.trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.32, metalness: 0.75 });
		const visorMat = new THREE.MeshPhysicalMaterial({
			color: 0x020203,
			roughness: 0.12,
			metalness: 0.1,
			clearcoat: 1,
			clearcoatRoughness: 0.04,
			envMapIntensity: 0.38,
		});
		const accent = EYE["--accent"];

		// Head
		const head = new THREE.Group();
		head.position.y = 1.08;
		bot.add(head);
		this.headG = head;
		head.add(new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.8, 1.72, 8, 0.46), this.shellMat));
		const visor = new THREE.Mesh(new RoundedBoxGeometry(1.92, 1.28, 0.36, 6, 0.17), visorMat);
		visor.position.z = 0.71;
		head.add(visor);

		// Light spilling off the eyes onto the glass.
		this.eyeGlow = new THREE.Mesh(
			new THREE.PlaneGeometry(1.7, 1.05),
			new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }),
		);
		this.eyeGlow.position.z = 0.892;
		head.add(this.eyeGlow);

		this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
		this.eyesG = new THREE.Group();
		this.eyesG.position.set(0, 0.02, 0.895);
		head.add(this.eyesG);
		this.eyes = [-1, 1].map((side) => {
			const pivot = new THREE.Group();
			const m = new THREE.Mesh(eyeGeometry(19 * K, 26 * K, 9 * K, 9 * K), this.eyeMat);
			pivot.add(m);
			pivot.userData.side = side;
			this.eyesG.add(pivot);
			return pivot;
		});

		// Ear pods with light rings
		this.podRings = [];
		for (const side of [-1, 1]) {
			const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 48), this.trimMat);
			pod.rotation.z = Math.PI / 2;
			pod.position.x = side * 1.25;
			head.add(pod);
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 16, 64), this.glowMat(accent, 2.2));
			ring.rotation.y = Math.PI / 2;
			ring.position.x = side * 1.365;
			head.add(ring);
			this.podRings.push(ring);
			const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32), this.shellMat);
			cap.rotation.z = Math.PI / 2;
			cap.position.x = side * 1.37;
			head.add(cap);
		}

		// Antenna
		const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.036, 0.44, 16), this.trimMat);
		stalk.position.y = 1.1;
		head.add(stalk);
		this.tipMat = this.glowMat(accent, 3);
		this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 24), this.tipMat);
		this.tip.position.y = 1.36;
		head.add(this.tip);
		this.tipGlow = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: TEX.glow, color: accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }),
		);
		this.tipGlow.scale.setScalar(0.7);
		this.tipGlow.position.y = 1.36;
		head.add(this.tipGlow);

		// Headphones, for calls
		this.band = new THREE.Group();
		const arc = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.07, 16, 72, Math.PI), this.trimMat);
		arc.position.y = 0.05;
		this.band.add(arc);
		head.add(this.band);
		this.band.scale.setScalar(0.001);

		// Neck
		this.neckMat = this.glowMat(accent, 1.8);
		const neck = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 12, 64), this.neckMat);
		neck.rotation.x = Math.PI / 2;
		neck.position.y = 0.11;
		bot.add(neck);

		// Body
		const body = new THREE.Group();
		body.position.y = -0.98;
		bot.add(body);
		this.bodyG = body;
		const torso = new THREE.Mesh(new THREE.SphereGeometry(0.92, 64, 48), this.shellMat);
		torso.scale.set(1, 1.12, 0.92);
		body.add(torso);
		const seam = new THREE.Mesh(new THREE.TorusGeometry(0.905, 0.01, 8, 128), this.trimMat);
		seam.rotation.x = Math.PI / 2;
		seam.position.y = 0.32;
		seam.scale.set(1, 0.92, 1);
		body.add(seam);
		this.coreMat = this.glowMat(accent, 2);
		const core = new THREE.Mesh(new THREE.CircleGeometry(0.11, 48), this.coreMat);
		core.position.set(0, 0.12, 0.835);
		body.add(core);
		this.coreRingMat = this.glowMat(accent, 1.4);
		const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 12, 64), this.coreRingMat);
		coreRing.position.set(0, 0.12, 0.825);
		body.add(coreRing);
		this.coreGlow = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: TEX.glow, color: accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }),
		);
		this.coreGlow.position.set(0, 0.12, 0.9);
		this.coreGlow.scale.setScalar(0.9);
		body.add(this.coreGlow);

		// Hover jet under the body
		this.jet = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: TEX.glow, color: accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }),
		);
		this.jet.position.set(0, -1.12, 0);
		this.jet.scale.set(0.9, 0.5, 1);
		body.add(this.jet);

		// Hands
		this.hands = [-1, 1].map((side) => {
			const g = new THREE.Group();
			g.position.set(side * 1.24, -0.92, 0.08);
			const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 8, 24), this.shellMat);
			g.add(m);
			const tipL = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 8, 40), this.trimMat);
			tipL.rotation.x = Math.PI / 2;
			tipL.position.y = 0.05;
			g.add(tipL);
			g.userData.side = side;
			bot.add(g);
			return g;
		});
	}

	buildHalo() {
		const halo = new THREE.Group();
		halo.position.set(0, 0.05, -1.5);
		this.world.add(halo);
		this.halo = halo;

		// Ticks, as one instanced mesh. Index 0 sits at 12 o'clock, clockwise.
		const geo = new THREE.BoxGeometry(1, 1, 1);
		this.tickMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
		this.ticks = new THREE.InstancedMesh(geo, this.tickMat, TICKS);
		this.tickBase = [];
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		for (let i = 0; i < TICKS; i++) {
			const major = i % 6 === 0;
			const len = major ? 0.36 : 0.2;
			const th = (i / TICKS) * TAU;
			const r = RING_R - len / 2;
			const pos = new THREE.Vector3(Math.sin(th) * r, Math.cos(th) * r, 0);
			e.set(0, 0, -th);
			q.setFromEuler(e);
			const scl = new THREE.Vector3(major ? 0.05 : 0.032, len, 0.03);
			this.tickBase.push({ pos, q: q.clone(), scl, major });
			m.compose(pos, q, scl);
			this.ticks.setMatrixAt(i, m);
			this.ticks.setColorAt(i, new THREE.Color(0x333333));
		}
		halo.add(this.ticks);
		// Scatter for the power-on: ticks fly in from here.
		this.tickFrom = this.tickBase.map(() =>
			new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -2 - Math.random() * 6),
		);

		this.trackMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 });
		halo.add(new THREE.Mesh(new THREE.TorusGeometry(ARC_R, 0.007, 6, 200), this.trackMat));

		this.arcMat = new THREE.ShaderMaterial({
			uniforms: { uP: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 1 } },
			vertexShader: ARC_VERT,
			fragmentShader: ARC_FRAG,
			transparent: true,
		});
		halo.add(new THREE.Mesh(new THREE.TorusGeometry(ARC_R, 0.022, 10, 260), this.arcMat));

		this.cometMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
		this.comet = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), this.cometMat);
		halo.add(this.comet);
		this.cometGlow = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }),
		);
		this.cometGlow.scale.setScalar(0.9);
		halo.add(this.cometGlow);

		// The app's ambient light, as a disc of glow behind everything.
		this.ambient = new THREE.Mesh(
			new THREE.PlaneGeometry(RING_R * 3.2, RING_R * 3.2),
			new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
		);
		this.ambient.position.z = -0.3;
		halo.add(this.ambient);

		// Ripple on every move (the app's core ripple, scaled up).
		this.rippleGeo = new THREE.TorusGeometry(ARC_R * 0.62, 0.012, 6, 160);

		// Gyro rings with a node riding each.
		this.gyros = [];
		for (const [r, tx, ty, sp] of [
			[3.35, 1.25, 0.3, 0.12],
			[3.15, 1.05, -0.5, -0.09],
		]) {
			const g = new THREE.Group();
			g.rotation.set(tx, ty, 0);
			const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
			g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 240), ringMat));
			const node = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 16), this.glowMat(EYE["--accent"], 2.4));
			g.add(node);
			this.world.add(g);
			this.gyros.push({ g, node, r, sp, ringMat, phase: Math.random() * TAU });
		}
	}

	buildPlatform() {
		const plat = new THREE.Group();
		plat.position.y = -2.62;
		this.world.add(plat);
		this.plat = plat;
		this.platMats = [];
		const circle = (r, seg = 160) => {
			const pts = [];
			for (let i = 0; i < seg; i++) {
				const a = (i / seg) * TAU;
				pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
			}
			return new THREE.BufferGeometry().setFromPoints(pts);
		};
		const spin = new THREE.Group();
		plat.add(spin);
		this.platSpin = spin;
		[
			[0.9, 0.5],
			[1.5, 0.38],
			[2.2, 0.26],
			[3.0, 0.16],
		].forEach(([r, o]) => {
			const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, depthWrite: false });
			mat.userData.o = o;
			this.platMats.push(mat);
			spin.add(new THREE.LineLoop(circle(r), mat));
		});
		// Dashes on the outer ring, like the dial's bezel.
		const dash = [];
		for (let i = 0; i < 72; i++) {
			const a = (i / 72) * TAU;
			const r1 = 2.55;
			const r2 = i % 6 === 0 ? 2.8 : 2.66;
			dash.push(new THREE.Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1), new THREE.Vector3(Math.cos(a) * r2, 0, Math.sin(a) * r2));
		}
		const dmat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
		dmat.userData.o = 0.3;
		this.platMats.push(dmat);
		spin.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dash), dmat));

		this.platGlow = new THREE.Mesh(
			new THREE.PlaneGeometry(6, 6),
			new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
		);
		this.platGlow.rotation.x = -Math.PI / 2;
		plat.add(this.platGlow);
		this.shadow = new THREE.Mesh(
			new THREE.PlaneGeometry(3.2, 3.2),
			new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.55 }),
		);
		this.shadow.rotation.x = -Math.PI / 2;
		this.shadow.position.y = 0.01;
		plat.add(this.shadow);
	}

	// A grid floor running off to a glowing horizon.
	buildFloor() {
		const g = new THREE.Group();
		g.position.y = -2.64;
		this.world.add(g);
		// Explicit lines (rows across, rails running to the horizon), kept in
		// front of the camera so nothing gets clipped away.
		const pts = [];
		for (let z = -56; z <= 14; z++) pts.push(new THREE.Vector3(-60, 0, z), new THREE.Vector3(60, 0, z));
		for (let x = -40; x <= 40; x++) pts.push(new THREE.Vector3(x, 0, -56), new THREE.Vector3(x, 0, 14));
		const grid = new THREE.LineSegments(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
		);
		this.floorGrid = grid;
		g.add(grid);
		this.horizon = new THREE.Mesh(
			new THREE.PlaneGeometry(90, 18),
			new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
		);
		this.horizon.position.set(0, 2, -40);
		g.add(this.horizon);
		this.scene.fog = new THREE.Fog(0x000000, 18, 58);
	}

	buildParticles(n) {
		if (COARSE) n = Math.round(n * 0.5);
		const pos = new Float32Array(n * 3);
		const col = new Float32Array(n * 4);
		this.pSeed = [];
		for (let i = 0; i < n; i++) {
			pos[i * 3] = (Math.random() - 0.5) * 14;
			pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
			pos[i * 3 + 2] = -5 + Math.random() * 7;
			this.pSeed.push({ s: 0.08 + Math.random() * 0.25, ph: Math.random() * TAU, warm: Math.random() < 0.25 });
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
		this.pMat = new THREE.PointsMaterial({
			size: 0.06,
			map: TEX.dot,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.particles = new THREE.Points(geo, this.pMat);
		this.world.add(this.particles);
	}

	buildSparks() {
		const n = 46;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
		geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 4), 4));
		this.sMat = new THREE.PointsMaterial({
			size: 0.13,
			map: TEX.dot,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.sparks = new THREE.Points(geo, this.sMat);
		this.sparks.frustumCulled = false;
		this.sparkState = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1 }));
		(this.halo ?? this.world).add(this.sparks);
	}

	buildZzz() {
		this.zzz = [0, 1, 2].map((i) => {
			const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.z, transparent: true, depthWrite: false, opacity: 0 }));
			s.userData.ph = i / 3;
			this.headG.add(s);
			return s;
		});
	}

	// ── Theme ────────────────────────────────────────────────────────────────

	applyTheme() {
		const dark = isDark();
		this.dark = dark;
		const P = dark ? PALETTE.dark : PALETTE.light;
		this.P = P;
		// scene.background, not setClearColor: through EffectComposer the clear
		// colour gets sRGB-encoded twice, the background doesn't.
		this.scene.background = pageClear(P.bg);
		this.shellMat.color.set(P.shell);
		this.shellMat.roughness = dark ? 0.3 : 0.26;
		this.trimMat.color.set(P.trim);
		this.bloom.strength = dark ? 0.72 : 0.45;
		this.shellMat.envMapIntensity = dark ? 0.32 : 0.75;
		const add = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
		for (const m of [this.pMat, this.sMat]) {
			m.blending = add;
			m.needsUpdate = true;
		}
		if (this.platMats) {
			for (const m of this.platMats) {
				m.color.copy(P.accent);
				m.opacity = m.userData.o * (dark ? 0.9 : 1.1);
			}
			this.platGlow.material.blending = add;
			this.platGlow.material.color.copy(P.accent);
			this.platGlow.material.opacity = dark ? 0.45 : 0.18;
			this.platGlow.material.needsUpdate = true;
			this.shadow.material.opacity = dark ? 0.6 : 0.28;
		}
		if (this.halo) {
			this.trackMat.color.copy(P.tickMajor);
			this.ambient.material.blending = add;
			this.ambient.material.needsUpdate = true;
			for (const g of this.gyros) g.ringMat.color.copy(P.accent);
		}
		this.rim.intensity = dark ? 8 : 6;
		if (this.floorGrid) {
			this.floorGrid.material.color.copy(P.accent);
			this.floorGrid.material.opacity = dark ? 0.4 : 0.45;
			this.horizon.material.color.copy(P.accent);
			this.horizon.material.opacity = dark ? 0.35 : 0.2;
			this.horizon.material.blending = add;
			this.horizon.material.needsUpdate = true;
			this.scene.fog.color.copy(pageClear(P.bg));
		}

	}

	// ── Layout ───────────────────────────────────────────────────────────────

	resize() {
		const w = this.host.clientWidth;
		const h = this.host.clientHeight;
		if (!w || !h) return;
		this.w = w;
		this.h = h;
		this.renderer.setSize(w, h, false);
		this.composer.setSize(w, h);
		this.camera.aspect = w / h;
		const tan = Math.tan((this.camera.fov * Math.PI) / 360);
		const aspect = w / h;
		if (this.mode === "hero") {
			this.narrow = w <= HERO.narrowAt;
			// Fit the dial and platform into the band between the bottom of the
			// copy and the bottom of the hero, so the bot never sits under the
			// buttons on short windows and doesn't balloon on tall ones.
			const hostTop = this.host.getBoundingClientRect().top;
			const copy = document.querySelector(".hero-copy");
			const copyBottom = copy ? copy.getBoundingClientRect().bottom - hostTop : h * 0.4;
			const top = copyBottom + 20;
			const band = Math.max(h - 28 - top, h * 0.32);
			// Halo top to platform is about 5.7 units; the dial must also fit the width.
			const ppu = Math.min(band / 5.7, (w * 0.92) / 5.8, h / 6.2);
			const centerY = top + 2.85 * ppu;
			this.camDist = h / ppu / (2 * tan);
			// Shift the picture instead of the bot, so it stays front-on. The
			// camera looks at y = lookY, which sits that far above the dial centre.
			this.camera.setViewOffset(w, h, -(HERO.x - 0.5) * w, h / 2 + (HERO.lookY - 0.05) * ppu - centerY, w, h);
		} else if (this.mode === "stage") {
			this.camDist = Math.max(7.3 / (2 * tan), 7.3 / (2 * tan * aspect));
			this.camera.clearViewOffset();
		} else {
			this.camDist = Math.max(6.2 / (2 * tan), 6.0 / (2 * tan * aspect));
			this.camera.clearViewOffset();
		}
		this.camera.updateProjectionMatrix();
		// Fog starts just behind the bot, wherever the camera ends up.
		if (this.scene.fog) {
			this.scene.fog.near = this.camDist + 4;
			this.scene.fog.far = this.camDist + 44;
		}
	}

	onClick(e) {
		if (this.mode === "hero") {
			FT.touch?.();
			if (!FT.D.enabled) FT.toggle(true);
			else this.hopUntil = performance.now() / 1000 + 1.1;
		} else if (this.mode === "final") {
			this.wakeUntil = performance.now() / 1000 + 2.5;
			this.hopUntil = performance.now() / 1000 + 1.1;
		} else {
			this.hopUntil = performance.now() / 1000 + 1.1;
		}
	}

	// ── Per-frame state ──────────────────────────────────────────────────────

	sessionState(now) {
		const D = FT.D;
		const ms = Date.now();
		const active = D.enabled;
		let progress = 0;
		let rewinding = false;
		if (active && D.waitStartedAt && D.nextActionAt) {
			const since = ms - D.waitStartedAt;
			const span = Math.max(1, D.nextActionAt - D.waitStartedAt);
			if (since < 1010 && this.prevP > 0.5) {
				rewinding = true;
				progress = this.prevP * (1 - easeInOut((since - 160) / 850));
			} else {
				progress = clamp(since / span, 0, 1);
				this.prevP = progress;
			}
			if (since >= 1010) this.prevP = progress;
		} else {
			this.prevP = 0;
		}
		const fresh = D.lastActionAt != null && ms - D.lastActionAt < 2800;
		if (D.lapAt && D.lapAt !== this.lapKey) {
			this.lapKey = D.lapAt;
			this.lapAt = now;
			this.burst();
		}
		if (D.lastActionAt && D.lastActionAt !== this.actKey) {
			if (this.actKey !== null) this.react(now, D.lastRoutine);
			this.actKey = D.lastActionAt;
		}
		const mood = moodFor({ enabled: active, routine: D.lastRoutine, fresh: fresh || D.moving });
		return { active, progress, rewinding, mood, tone: active ? "--accent" : "--ink-3", ringTone: active ? "accent" : "none" };
	}

	react(now, routine) {
		this.actAt = now;
		this.ripples.push({ t: now, mesh: null });
		if (routine === "shift") this.hopUntil = now + 1.0;
	}

	burst() {
		if (REDUCE) return;
		const origin = new THREE.Vector3(0, ARC_R, 0.05);
		for (const s of this.sparkState) {
			const a = Math.random() * TAU;
			const sp = 1.2 + Math.random() * 2.2;
			s.p.copy(origin);
			s.v.set(Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.3) * 1.6);
			s.max = 0.6 + Math.random() * 0.6;
			s.life = s.max;
		}
	}

	frame(dt, now) {
		const P = this.P;
		const M = REDUCE ? 0 : 1;
		const intro = this.introStart > 0 ? clamp((now - this.introStart) / 2.4, 0, 1) : 1;

		// Where the state comes from depends on which scene this is.
		let st;
		if (this.mode === "hero") st = this.sessionState(now);
		else if (this.mode === "stage") {
			const sm = this.stageMood ?? { m: "awake", tone: "--accent" };
			const active = sm.m !== "sleep";
			const paused = sm.tone === "--warn";
			st = { active: active && !paused, paused, progress: 0, mood: sm.m, tone: sm.tone, ringTone: paused ? "warn" : active ? "sweep" : "none" };
		} else {
			const awake = now < this.wakeUntil;
			st = { active: awake, mood: awake ? (now < this.hopUntil ? "happy" : "awake") : "sleep", tone: awake ? "--accent" : "--ink-3", ringTone: "none" };
		}
		if (this.hopUntil > now && st.mood !== "sleep") st.mood = "happy";
		if (this.mode === "hero" && intro < 0.55) st.mood = "sleep";

		this.setMood(st.mood, st.tone, now);

		// Eye color and power-on flicker
		this.eyeColor.lerp(EYE[st.tone], 1 - Math.exp(-6 * dt));
		if (this.introStart > 0) {
			const t = (now - this.introStart) * 1000;
			this.eyeOn = t < 900 ? 0 : t < 1400 ? (Math.sin(t * 0.09) > 0.2 ? 0.9 : 0.15) : 1;
		}
		const sleepy = st.mood === "sleep" || st.mood === "locked";
		const eyeK = (sleepy ? 1.9 : 2.7) * this.eyeOn;
		this.eyeMat.color.copy(this.eyeColor).multiplyScalar(eyeK);
		this.eyeGlow.material.color.copy(this.eyeColor);
		this.eyeGlow.material.opacity = (sleepy ? 0.05 : 0.14) * this.eyeOn;

		this.animateEyes(dt, now, st);
		this.animateBody(dt, now, st, M, intro);
		if (this.halo) this.animateHalo(dt, now, st, M, intro);
		this.animateFx(dt, now, st, M);

		// Camera: a slow dolly in on the power-on, and a little parallax.
		const cam = this.camera;
		let dist = this.camDist * (1 + 0.28 * (1 - easeOut(intro)));
		let lift = 0;
		if (this.mode === "hero") {
			const r = this.host.getBoundingClientRect();
			const p = clamp(-r.top / Math.max(1, r.height), 0, 1);
			dist *= 1 + p * 0.18;
			lift = p * 1.1;
			this.world.rotation.y = damp(this.world.rotation.y, this.pointerYaw() * 0.08 * M, 3, dt);
		} else {
			this.world.rotation.y = damp(this.world.rotation.y, this.pointerYaw() * 0.12 * M, 3, dt);
		}
		const camY = this.mode === "hero" ? HERO.camY : 0.55;
		const lookY = this.mode === "hero" ? HERO.lookY : 0.05;
		cam.position.set(0, camY + lift * 0.4, dist);
		cam.lookAt(0, lookY + lift * 0.4, 0);
		if (this.floorGrid) this.floorGrid.position.z = ((now * 0.8) % 1) * M;
		this.world.position.y = lift * 0.3;

		this.composer.render(dt);
		if (this.mode === "hero") this.hud(st);
	}

	pointerYaw() {
		const r = this.host.getBoundingClientRect();
		return clamp((pointer.x - (r.left + r.width / 2)) / Math.max(1, r.width / 2), -1, 1);
	}

	setMood(mood, tone, now) {
		if (mood === this.mood && tone === this.tone) return;
		const changed = mood !== this.mood;
		this.mood = mood;
		this.tone = tone;
		const sh = SHAPES[mood];
		this.eye.w.t = sh.w;
		this.eye.h.t = sh.h;
		this.eye.rt.t = sh.rt;
		this.eye.rb.t = sh.rb;
		this.eye.y.t = sh.y ?? 0;
		this.eye.tilt.t = sh.tilt ?? 0;
		if (changed) this.startScript(mood, now);
	}

	// The app's scripted looks: glance darts across, move nudges once.
	startScript(mood, now) {
		this.script = [];
		const dir = Math.random() < 0.5 ? -1 : 1;
		if (mood === "glance") this.script = [[now, 8 * dir, -1], [now + 0.7, -7 * dir, 0], [now + 1.5, 0, 0]];
		else if (mood === "move") this.script = [[now, 6 * dir, 2], [now + 0.9, 0, 0]];
		if (mood === "move") {
			this.bodyX.t = dir * 0.22;
			setTimeout(() => (this.bodyX.t = 0), 650);
		}
	}

	replay() {
		this.startScript(this.mood, performance.now() / 1000);
	}

	animateEyes(dt, now, st) {
		const e = this.eye;
		const w = e.w.step(dt);
		const h = e.h.step(dt);
		const rt = e.rt.step(dt);
		const rb = e.rb.step(dt);
		const y = e.y.step(dt);
		const tilt = e.tilt.step(dt);
		const key = `${w.toFixed(2)}|${h.toFixed(2)}|${rt.toFixed(2)}|${rb.toFixed(2)}`;
		if (key !== this.eyeDims) {
			this.eyeDims = key;
			const g = eyeGeometry(w * K, h * K, rt * K, rb * K);
			const old = this.eyes[0].children[0].geometry;
			for (const eye of this.eyes) eye.children[0].geometry = g;
			old.dispose();
		}

		// Where they look: script, pointer, or idle saccades.
		let lx = 0;
		let ly = 0;
		const mood = this.mood;
		if (this.script.length) {
			for (const [at, x, yy] of this.script) if (now >= at) [lx, ly] = [x, yy];
			if (now > this.script[this.script.length - 1][0] + 0.4) this.script = [];
		} else if (mood === "read") {
			lx = Math.sin(now * 4.8) * 4;
		} else if (mood === "awake" || mood === "happy") {
			const recent = performance.now() - pointer.t < 2500;
			if (recent && !REDUCE) {
				const hp = this.headScreen();
				lx = clamp((pointer.x - hp.x) / 40, -6, 6);
				ly = clamp((pointer.y - hp.y) / 60, -3, 3);
			} else {
				if (now > this.saccadeAt) {
					this.saccadeAt = now + 1.6 + Math.random() * 3.2;
					this.saccade = Math.random() < 0.4 ? { x: 0, y: 0 } : { x: (Math.random() * 2 - 1) * 6, y: (Math.random() * 2 - 1) * 3 };
				}
				lx = this.saccade.x;
				ly = this.saccade.y;
			}
		}
		this.look.x.t = lx;
		this.look.y.t = ly;
		const lookX = this.look.x.step(dt);
		const lookY = this.look.y.step(dt);

		// Blink: quick shut, occasional double.
		if (OPEN.includes(mood) && !REDUCE) {
			if (now > this.nextBlink) {
				this.blinkAt = now;
				this.nextBlink = now + (Math.random() < 0.2 ? 0.27 : 2.2 + Math.random() * 3.8);
			}
		}
		const bt = (now - this.blinkAt) * 1000;
		const closed = bt >= 0 && bt < 180;
		this.blink = damp(this.blink, closed && bt < 110 ? 0.08 : 1, closed ? 40 : 22, dt);

		const gap = (w / 2 + 9) * K;
		for (const eye of this.eyes) {
			const side = eye.userData.side;
			eye.position.set(side * gap + lookX * K, -y * K - lookY * K, 0);
			eye.rotation.z = (-(tilt * side) * Math.PI) / 180;
			eye.scale.y = this.blink;
		}
		this.lookPx = { x: lookX, y: lookY };
	}

	headScreen() {
		const v = new THREE.Vector3();
		this.headG.getWorldPosition(v);
		v.project(this.camera);
		const r = this.host.getBoundingClientRect();
		return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
	}

	animateBody(dt, now, st, M, intro) {
		const mood = this.mood;
		const sleepy = mood === "sleep" || mood === "locked";
		const lp = this.lookPx ?? { x: 0, y: 0 };

		// Head pose
		let yaw = (lp.x / 6) * 0.32;
		let pitch = (lp.y / 3) * 0.14;
		let roll = 0;
		if (mood === "glance") yaw = lp.x * 0.05;
		if (sleepy) {
			pitch = 0.2;
			roll = 0.07;
			yaw = 0;
		}
		if (mood === "tired") {
			pitch = 0.13;
			roll = -0.1;
		}
		if (mood === "read") pitch = 0.09;
		if (mood === "listen") pitch = 0.04 + Math.sin(now * 5) * 0.035 * M;
		this.head.yaw.t = yaw * M;
		this.head.pitch.t = pitch;
		this.head.roll.t = roll;
		this.headG.rotation.set(this.head.pitch.step(dt), this.head.yaw.step(dt), this.head.roll.step(dt));

		// Float
		const speed = sleepy ? 0.9 : 1.6;
		const amp = sleepy ? 0.05 : 0.09;
		let y = Math.sin(now * speed) * amp * M;
		if (now < this.hopUntil) y += Math.abs(Math.sin((this.hopUntil - now) * 9)) * 0.14 * M;
		const rise = this.introStart > 0 ? (1 - easeOutExpo(intro / 0.7)) * -1.4 : 0;
		this.bot.position.set(this.bodyX.step(dt) * M, y + rise, 0);
		const sc = 0.9 + 0.1 * easeOut(intro / 0.6);
		this.bot.scale.setScalar(sc);
		this.bodyG.rotation.z = -this.bodyX.x * 0.4;

		// Hands
		const happy = mood === "happy";
		for (const hnd of this.hands) {
			const s = hnd.userData.side;
			const bob = Math.sin(now * speed + s * 1.3 + 1) * 0.06 * M;
			const ty = happy ? -0.45 : sleepy ? -1.02 : -0.92;
			hnd.position.y = damp(hnd.position.y, ty + bob, 8, dt);
			hnd.rotation.z = damp(hnd.rotation.z, happy ? -s * 0.9 : s * (sleepy ? 0.12 : 0.25), 8, dt);
			hnd.position.x = damp(hnd.position.x, s * (happy ? 1.38 : 1.24), 8, dt);
		}

		// Lights that read the state
		const tone = st.tone === "--warn" ? EYE["--warn"] : st.tone === "--ink-3" ? EYE["--ink-3"] : EYE["--accent"];
		const pulse = sleepy ? 0.25 : 1.5 + Math.sin(now * 3) * 0.5 * M;
		this.tipMat.color.copy(tone).multiplyScalar(pulse * this.eyeOn + 0.15);
		this.tipGlow.material.color.copy(tone);
		this.tipGlow.material.opacity = (sleepy ? 0.12 : 0.5) * this.eyeOn;
		const breathe = st.active ? 1.4 + Math.sin(now * 1.14) * 0.5 * M : 0.35;
		const flash = Math.max(0, 1 - (now - this.actAt) / 0.8) * 3;
		this.coreMat.color.copy(tone).multiplyScalar((breathe + flash) * this.eyeOn + 0.1);
		this.coreRingMat.color.copy(tone).multiplyScalar(0.6 + breathe * 0.4);
		this.coreGlow.material.color.copy(tone);
		this.coreGlow.material.opacity = this.dark ? (st.active ? 0.35 : 0.1) : 0.1;
		this.neckMat.color.copy(tone).multiplyScalar(st.active ? 2.1 : 0.5);
		const listen = mood === "listen";
		for (const r of this.podRings) r.material.color.copy(listen ? EYE["--warn"] : tone).multiplyScalar(listen ? 3 : st.active ? 2.2 : 0.5);
		this.band.scale.setScalar(damp(this.band.scale.x, listen ? 1 : 0.001, 10, dt));
		this.jet.material.color.copy(tone);
		this.jet.material.opacity = (this.dark ? 0.4 : 0.15) * (0.8 + Math.sin(now * 12) * 0.2 * M);
		this.rim.color.copy(tone);
		this.under.color.copy(tone);
		this.under.intensity = st.active ? 3 : 1;
	}

	animateHalo(dt, now, st, M, intro) {
		const P = this.P;
		const accent = P.accent;
		const c = new THREE.Color();
		const m = new THREE.Matrix4();
		const pos = new THREE.Vector3();

		let progress = st.progress ?? 0;
		let lit;
		let sweepHead = -1;
		if (st.ringTone === "sweep") {
			sweepHead = ((now / 4.2) % 1) * TICKS;
		}
		lit = Math.floor(progress * TICKS);

		const lapT = now - this.lapAt;
		for (let i = 0; i < TICKS; i++) {
			const b = this.tickBase[i];
			// Power-on: fly in from the scatter.
			if (intro < 1) {
				const k = easeOutExpo((intro * 2.4 - 0.15 - i * 0.012) / 1.1);
				pos.lerpVectors(this.tickFrom[i], b.pos, k);
				m.compose(pos, b.q, b.scl);
				this.ticks.setMatrixAt(i, m);
			} else if (!this.settled) {
				m.compose(b.pos, b.q, b.scl);
				this.ticks.setMatrixAt(i, m);
			}

			c.copy(b.major ? P.tickMajor : P.tick);
			if (st.ringTone === "accent" && i < lit) {
				const trail = 0.4 + 0.6 * Math.pow((i + 1) / Math.max(1, lit), 1.6);
				c.copy(accent).multiplyScalar(trail * (this.dark ? 2.3 : 1));
			} else if (st.ringTone === "sweep") {
				const d = (sweepHead - i + TICKS) % TICKS;
				if (d < 26) c.lerp(accent.clone().multiplyScalar(this.dark ? 2.3 : 1), Math.pow(1 - d / 26, 1.6));
			} else if (st.ringTone === "warn" && b.major) {
				c.copy(P.warn).multiplyScalar(this.dark ? 0.8 : 0.9);
			}
			// Lap: a wave of light runs clockwise round the bezel.
			const lt = (lapT - i * 0.008) / 0.62;
			if (lt > 0 && lt < 1) {
				const env = lt < 0.25 ? lt / 0.25 : 1 - (lt - 0.25) / 0.75;
				c.lerp(accent.clone().multiplyScalar(this.dark ? 3.2 : 1.2), env);
			}
			this.ticks.setColorAt(i, c);
		}
		if (intro >= 1 && !this.settled) this.settled = true;
		this.ticks.instanceMatrix.needsUpdate = true;
		this.ticks.instanceColor.needsUpdate = true;

		// Arc + comet
		const showArc = st.ringTone === "accent";
		const p = showArc ? progress : st.ringTone === "sweep" ? (sweepHead / TICKS) : 0;
		this.arcMat.uniforms.uP.value = showArc ? p : 0;
		this.arcMat.uniforms.uColor.value.copy(accent).multiplyScalar(this.dark ? 1.9 : 1);
		this.arcMat.uniforms.uAlpha.value = damp(this.arcMat.uniforms.uAlpha.value, showArc ? 1 : 0, 4, dt);
		const th = p * TAU;
		this.comet.position.set(Math.sin(th) * ARC_R, Math.cos(th) * ARC_R, 0.02);
		this.cometGlow.position.copy(this.comet.position);
		const cometOn = showArc || st.ringTone === "sweep";
		this.comet.visible = cometOn && intro > 0.7;
		this.cometMat.color.copy(accent).multiplyScalar(this.dark ? 5 : 2);
		this.cometGlow.material.color.copy(accent);
		this.cometGlow.material.opacity = cometOn ? (this.dark ? 0.9 : 0.4) : 0;
		this.cometGlow.visible = this.comet.visible;

		// Ambient glow behind the ring
		const amb =
			st.ringTone === "accent" ? (this.dark ? 0.13 : 0.08) : st.ringTone === "sweep" ? (this.dark ? 0.06 : 0.05) : st.ringTone === "warn" ? 0.05 : 0;
		this.ambient.material.color.copy(st.ringTone === "warn" ? P.warn : accent);
		this.ambient.material.opacity = damp(this.ambient.material.opacity, amb * easeOut(intro), 2.5, dt);
		this.trackMat.opacity = 0.6 * easeOut(intro);

		// Ripples on every move
		for (const r of this.ripples) {
			if (!r.mesh) {
				r.mesh = new THREE.Mesh(this.rippleGeo, new THREE.MeshBasicMaterial({ color: accent, transparent: true, depthWrite: false }));
				this.halo.add(r.mesh);
			}
			const k = (now - r.t) / 1.6;
			r.mesh.scale.setScalar(0.92 + easeOut(k) * 0.75);
			r.mesh.material.opacity = (1 - k) * 0.8;
			r.mesh.material.color.copy(accent).multiplyScalar(this.dark ? 1.6 : 1);
			if (k >= 1) {
				this.halo.remove(r.mesh);
				r.mesh.material.dispose();
				r.done = true;
			}
		}
		this.ripples = this.ripples.filter((r) => !r.done);

		// Gyros
		for (const g of this.gyros) {
			g.g.rotation.z += g.sp * dt * M;
			const a = now * 0.4 + g.phase;
			g.node.position.set(Math.cos(a) * g.r, Math.sin(a) * g.r, 0);
			g.ringMat.opacity = (this.dark ? 0.2 : 0.3) * easeOut(intro);
			g.node.material.color.copy(accent).multiplyScalar(this.dark ? 2.8 : 1.1);
		}
		this.halo.rotation.y = this.world.rotation.y * -0.5;
	}

	animateFx(dt, now, st, M) {
		const P = this.P;
		// Dust motes drifting up through the light.
		const pos = this.particles.geometry.attributes.position;
		const col = this.particles.geometry.attributes.color;
		const warm = new THREE.Color("rgb(255,222,89)");
		for (let i = 0; i < this.pSeed.length; i++) {
			const s = this.pSeed[i];
			let y = pos.getY(i) + s.s * dt * M;
			if (y > 4.2) y = -4;
			pos.setY(i, y);
			pos.setX(i, pos.getX(i) + Math.sin(now * 0.6 + s.ph) * 0.002 * M);
			const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 1.7 + s.ph));
			const base = s.warm ? warm : P.accent;
			col.setXYZW(i, base.r, base.g, base.b, tw * (this.dark ? 0.75 : 0.45));
		}
		pos.needsUpdate = true;
		col.needsUpdate = true;
		this.pMat.size = this.dark ? 0.06 : 0.05;

		// Sparks
		const sp = this.sparks.geometry.attributes.position;
		const sc = this.sparks.geometry.attributes.color;
		for (let i = 0; i < this.sparkState.length; i++) {
			const s = this.sparkState[i];
			if (s.life > 0) {
				s.life -= dt;
				s.p.addScaledVector(s.v, dt);
				s.v.multiplyScalar(Math.exp(-2.6 * dt));
			}
			const a = clamp(s.life / s.max, 0, 1);
			sp.setXYZ(i, s.p.x, s.p.y, s.p.z);
			const k = this.dark ? 2.2 : 1;
			sc.setXYZW(i, P.accent.r * k, P.accent.g * k, P.accent.b * k, a);
		}
		sp.needsUpdate = true;
		sc.needsUpdate = true;

		// Zzz while asleep
		const sleepy = this.mood === "sleep" || this.mood === "locked";
		for (const z of this.zzz) {
			const k = ((now / 3.3 + z.userData.ph) % 1 + 1) % 1;
			z.position.set(1.0 + k * 0.7, 1.15 + k * 1.1, 0.4);
			z.scale.setScalar(0.22 + k * 0.28);
			const target = sleepy && this.eyeOn > 0.5 && !REDUCE ? (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75) * 0.9 : 0;
			z.material.opacity = damp(z.material.opacity, target, 10, dt);
			z.material.color.copy(this.tone === "--warn" ? EYE["--warn"] : this.dark ? EYE["--ink-3"] : new THREE.Color(0x55585e));
		}

		if (this.platSpin) this.platSpin.rotation.y += dt * 0.12 * M;
	}

	// ── HUD (hero) ───────────────────────────────────────────────────────────

	hud(st) {
		const H = this.opts.hud;
		if (!H) return;
		const D = FT.D;
		const ms = Date.now();
		const show = !this.narrow && this.w > 0;
		H.root.classList.toggle("on", show && (this.introStart < 0 || performance.now() / 1000 - this.introStart > 1.6));
		if (!show) return;

		const project = (obj, local) => {
			const v = local.clone();
			obj.localToWorld(v);
			v.project(this.camera);
			return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
		};

		// Countdown, pinned to the dial at about 4 o'clock.
		const th = (118 / 360) * TAU;
		const a1 = project(this.halo, new THREE.Vector3(Math.sin(th) * RING_R, Math.cos(th) * RING_R, 0));
		const t1 = H.count;
		const w1 = t1.offsetWidth;
		const h1 = t1.offsetHeight;
		let x1 = Math.min(a1.x + 56, this.w - w1 - 28);
		let y1 = a1.y + 18;
		t1.style.transform = `translate(${x1}px, ${y1}px)`;

		// What it's doing, pinned to the dial at about 8 o'clock, on the left.
		const th2 = (242 / 360) * TAU;
		const a2 = project(this.halo, new THREE.Vector3(Math.sin(th2) * RING_R, Math.cos(th2) * RING_R, 0));
		const t2 = H.say;
		const w2 = t2.offsetWidth;
		const h2 = t2.offsetHeight;
		let x2 = Math.max(a2.x - 56 - w2, 28);
		let y2 = a2.y + 18;
		t2.style.transform = `translate(${x2}px, ${y2}px)`;

		// Elbow leader lines: anchor, a short diagonal, then into the tag.
		const right = (a, x, y, h) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${(x - 18).toFixed(1)} ${(y + h / 2).toFixed(1)} L${x.toFixed(1)} ${(y + h / 2).toFixed(1)}`;
		const left = (a, x, y, w, h) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${(x + w + 18).toFixed(1)} ${(y + h / 2).toFixed(1)} L${(x + w).toFixed(1)} ${(y + h / 2).toFixed(1)}`;
		H.line1.setAttribute("d", right(a1, x1, y1, h1));
		H.line2.setAttribute("d", left(a2, x2, y2, w2, h2));
		H.dot1.setAttribute("cx", a1.x.toFixed(1));
		H.dot1.setAttribute("cy", a1.y.toFixed(1));
		H.dot2.setAttribute("cx", a2.x.toFixed(1));
		H.dot2.setAttribute("cy", a2.y.toFixed(1));

		// Content, only when it changes.
		const active = D.enabled;
		const remaining = D.nextActionAt ? Math.max(0, D.nextActionAt - ms) : 0;
		const label = active ? "Next move" : "Session";
		if (H.countLabel.textContent !== label) H.countLabel.textContent = label;
		const val = active ? FT.mmss(remaining * FT.SPEED) : "off";
		if (val !== this.hudVal) {
			const spin = active && this.hudWait !== D.waitStartedAt;
			this.hudWait = D.waitStartedAt;
			this.hudVal = val;
			if (active) {
				if (!this.roll || spin) {
					H.countValue.replaceChildren();
					this.roll = new FT.Rolling(H.countValue);
				}
				this.roll.set(val, spin);
			} else {
				this.roll = null;
				H.countValue.textContent = "Off";
			}
		}
		let say;
		if (!active) say = COARSE ? "Asleep. Tap me to start a session." : "Asleep. Press Space to start a session.";
		else if (D.lastActionAt && ms - D.lastActionAt < 6000) say = `${FT.NARRATE[D.lastRoutine]}, just now`;
		else say = "Holding the fort until you step away";
		if (say !== this.hudSay) {
			this.hudSay = say;
			H.sayText.textContent = say;
			if (!REDUCE && H.sayText.animate) {
				H.sayText.animate(
					[
						{ opacity: 0, transform: "translateY(6px)" },
						{ opacity: 1, transform: "none" },
					],
					{ duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
				);
			}
		}
		H.root.dataset.state = active ? "active" : "idle";
	}
}

// ── Boot ────────────────────────────────────────────────────────────────────

function webglOK() {
	try {
		const c = document.createElement("canvas");
		return !!(c.getContext("webgl2") || c.getContext("webgl"));
	} catch {
		return false;
	}
}

function boot() {
	if (!FT || !webglOK()) {
		document.documentElement.classList.add("no-3d");
		return;
	}
	document.documentElement.classList.add("has-3d");
	const made = [];

	const heroHost = document.getElementById("hero-canvas");
	if (heroHost) {
		const hud = document.getElementById("hud");
		made.push(
			new BuddyScene(heroHost, {
				mode: "hero",
				halo: true,
				intro: true,
				floor: true,
				particles: 320,
				hud: hud && {
					root: hud,
					count: hud.querySelector(".hud-count"),
					countLabel: hud.querySelector(".hud-k"),
					countValue: hud.querySelector(".hud-v"),
					say: hud.querySelector(".hud-say"),
					sayText: hud.querySelector(".hud-say-text"),
					line1: hud.querySelector(".l1"),
					line2: hud.querySelector(".l2"),
					dot1: hud.querySelector(".d1"),
					dot2: hud.querySelector(".d2"),
				},
			}),
		);
	}

	const stageHost = document.getElementById("mood-canvas");
	if (stageHost) {
		const s = new BuddyScene(stageHost, { mode: "stage", halo: true, particles: 160 });
		FT.onStageMood?.((m) => {
			s.stageMood = m;
			if (m.m === "glance" || m.m === "move") s.replay();
		});
		setInterval(() => {
			if (s.visible && (s.mood === "glance" || s.mood === "move")) s.replay();
		}, 2600);
		made.push(s);
	}

	const finalHost = document.getElementById("final-canvas");
	if (finalHost) {
		const s = new BuddyScene(finalHost, { mode: "final", halo: false, particles: 120 });
		for (const b of document.querySelectorAll("#get .btn")) {
			const wake = () => (s.wakeUntil = performance.now() / 1000 + 600);
			const sleep = () => (s.wakeUntil = performance.now() / 1000 + 1.2);
			b.addEventListener("pointerenter", wake);
			b.addEventListener("focus", wake);
			b.addEventListener("pointerleave", sleep);
			b.addEventListener("blur", sleep);
			b.addEventListener("click", () => (s.hopUntil = performance.now() / 1000 + 1.2));
		}
		made.push(s);
	}

	const retheme = () => made.forEach((s) => s.applyTheme());
	new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);

	let last = performance.now();
	const loop = (t) => {
		const dt = Math.min(0.05, (t - last) / 1000);
		last = t;
		const now = t / 1000;
		for (const s of scenes) if (s.visible) s.frame(dt, now);
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}

try {
	boot();
} catch (err) {
	console.error(err);
	document.documentElement.classList.add("no-3d");
}
