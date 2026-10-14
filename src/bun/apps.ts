// Classifies the frontmost app so routines can fit what's on screen: reading
// scrolls in a browser, no ⌘-Tab out of a terminal mid-command, and so on.

export type AppKind = "browser" | "reader" | "chat" | "code" | "terminal" | "self" | "other";

const EXACT: Record<string, AppKind> = {
	"com.apple.Safari": "browser",
	"com.apple.SafariTechnologyPreview": "browser",
	"com.google.Chrome": "browser",
	"com.google.Chrome.canary": "browser",
	"org.chromium.Chromium": "browser",
	"org.mozilla.firefox": "browser",
	"org.mozilla.firefoxdeveloperedition": "browser",
	"company.thebrowser.Browser": "browser",
	"company.thebrowser.dia": "browser",
	"com.microsoft.edgemac": "browser",
	"com.brave.Browser": "browser",
	"com.operasoftware.Opera": "browser",
	"com.vivaldi.Vivaldi": "browser",
	"app.zen-browser.zen": "browser",
	"com.kagi.kagimacOS": "browser",

	"com.apple.Preview": "reader",
	"com.adobe.Reader": "reader",
	"com.adobe.Acrobat.Pro": "reader",
	"com.apple.iWork.Pages": "reader",
	"com.apple.iWork.Numbers": "reader",
	"com.apple.iWork.Keynote": "reader",
	"com.microsoft.Word": "reader",
	"com.microsoft.Excel": "reader",
	"com.microsoft.Powerpoint": "reader",
	"com.apple.Notes": "reader",
	"com.apple.mail": "reader",
	"com.microsoft.Outlook": "reader",
	"com.readdle.smartemail-Mac": "reader",
	"notion.id": "reader",
	"md.obsidian": "reader",
	"com.linear": "reader",
	"com.figma.Desktop": "reader",
	"com.apple.iBooksX": "reader",

	"com.tinyspeck.slackmacgap": "chat",
	"com.microsoft.teams2": "chat",
	"com.microsoft.teams": "chat",
	"com.hnc.Discord": "chat",
	"com.apple.MobileSMS": "chat",
	"ru.keepcoder.Telegram": "chat",
	"net.whatsapp.WhatsApp": "chat",

	"com.apple.dt.Xcode": "code",
	"com.microsoft.VSCode": "code",
	"com.microsoft.VSCodeInsiders": "code",
	"com.todesktop.230313mzl4w4u92": "code", // Cursor
	"com.exafunction.windsurf": "code",
	"dev.zed.Zed": "code",
	"dev.zed.Zed-Preview": "code",
	"com.sublimetext.4": "code",
	"com.panic.Nova": "code",
	"com.google.android.studio": "code",

	"com.apple.Terminal": "terminal",
	"com.googlecode.iterm2": "terminal",
	"dev.warp.Warp-Stable": "terminal",
	"com.mitchellh.ghostty": "terminal",
	"net.kovidgoyal.kitty": "terminal",
	"io.alacritty": "terminal",
	"org.alacritty": "terminal",
	"com.github.wez.wezterm": "terminal",
	"co.zeit.hyper": "terminal",
	"com.raphaelamorim.rio": "terminal",
};

export function classifyApp(bundleId: string | null | undefined): AppKind {
	if (!bundleId) return "other";
	if (bundleId.startsWith("com.focustimer.")) return "self";
	const exact = EXACT[bundleId];
	if (exact) return exact;
	if (bundleId.startsWith("com.jetbrains.")) return "code";
	if (/terminal|term\b/i.test(bundleId)) return "terminal";
	return "other";
}

type Weights = Record<string, number>;

// Per-kind multipliers on routine weights. 0 removes a routine entirely.
const ADJUST: Record<AppKind, Weights> = {
	browser: { read: 1.7, browse: 1.5 },
	reader: { read: 1.6, browse: 1.3 },
	chat: { read: 1.2 },
	// Switching away from an editor can trigger blur/format-on-save, and
	// scrolling in a terminal can send arrow keys to full-screen programs.
	code: { glance: 0, read: 0.5, browse: 0.5 },
	terminal: { glance: 0, read: 0, browse: 0 },
	// Our own window has nothing to read; go look at something else.
	self: { read: 0, browse: 0, glance: 1.6 },
	other: {},
};

export function adjustForApp<T extends string>(weights: Record<T, number>, kind: AppKind) {
	const out = { ...weights };
	for (const [key, mult] of Object.entries(ADJUST[kind])) {
		if (key in out) out[key as T] *= mult;
	}
	return out;
}

export function allowsCmdTab(kind: AppKind) {
	return kind !== "code" && kind !== "terminal";
}

export function allowsScroll(kind: AppKind) {
	return kind !== "terminal" && kind !== "self";
}
