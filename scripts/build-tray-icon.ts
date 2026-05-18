import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const PUBLIC_DIR = join(ROOT, "src", "mainview", "public");

// 16x16 template icon for the macOS menu bar.
// macOS expects black-on-transparent; the system inverts/tints based on state.
// Render at 2x (32px) for retina and let macOS downscale.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="16" r="10" stroke="black" stroke-width="2.5" fill="none"/>
  <circle cx="16" cy="16" r="3" fill="black"/>
</svg>
`.trim();

async function main() {
	await mkdir(PUBLIC_DIR, { recursive: true });
	const out = join(PUBLIC_DIR, "tray-icon.png");
	await sharp(Buffer.from(svg), { density: 384 })
		.resize(32, 32)
		.png({ compressionLevel: 9 })
		.toFile(out);
	console.log(`Wrote ${out}`);
}

void main();
