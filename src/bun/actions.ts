import type { ActionType } from "../shared/types";
import { runShell } from "./system";

async function moveMouseRandomly() {
	const dx = Math.floor(Math.random() * 20) - 10;
	const dy = Math.floor(Math.random() * 20) - 10;
	const steps = 25;
	const jxa = `
ObjC.import("CoreGraphics");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
var sx = loc.x, sy = loc.y;
var tx = sx + ${dx};
var ty = sy + ${dy};
var steps = ${steps};
for (var i = 1; i <= steps; i++) {
  var t = i / steps;
  var ease = t * t * (3 - 2 * t);
  var x = sx + (tx - sx) * ease;
  var y = sy + (ty - sy) * ease;
  var ev = $.CGEventCreateMouseEvent($(), 5, {x: x, y: y}, 0);
  $.CGEventPost(0, ev);
  delay(0.035 + Math.random() * 0.01);
}
`;
	await runShell(["osascript", "-l", "JavaScript", "-e", jxa]);
}

const TAB_COUNT_CHOICES = [1, 2, 3, 4, 5, 6] as const;

async function actionCmdTab() {
	await moveMouseRandomly();
	const tabCount = TAB_COUNT_CHOICES[Math.floor(Math.random() * TAB_COUNT_CHOICES.length)];
	for (let i = 0; i < tabCount; i++) {
		await runShell([
			"osascript",
			"-e",
			'tell application "System Events" to key code 48 using command down',
		]);
		if (i < tabCount - 1) {
			await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
		}
	}
}

async function actionMouseOnly() {
	await moveMouseRandomly();
}

async function actionScroll() {
	const jxa = `
ObjC.import("CoreGraphics");
var up = $.CGEventCreateScrollWheelEvent($(), 0, 1, 1);
$.CGEventPost(0, up);
delay(0.4);
var down = $.CGEventCreateScrollWheelEvent($(), 0, 1, -1);
$.CGEventPost(0, down);
`;
	await runShell(["osascript", "-l", "JavaScript", "-e", jxa]);
}

async function actionShift() {
	// Left shift tap — has no modifier effect on its own, so doesn't disrupt focus.
	await runShell([
		"osascript",
		"-e",
		'tell application "System Events" to key code 56',
	]);
}

export async function runAction(type: ActionType): Promise<void> {
	switch (type) {
		case "mouse":
			return actionMouseOnly();
		case "scroll":
			return actionScroll();
		case "shift":
			return actionShift();
		case "cmdtab":
		default:
			return actionCmdTab();
	}
}

export const ACTION_LABELS: Record<ActionType, string> = {
	cmdtab: "Cmd+Tab",
	mouse: "Mouse only",
	scroll: "Scroll wheel",
	shift: "Shift tap",
};
