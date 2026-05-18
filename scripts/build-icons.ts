import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const SVG_PATH = join(ROOT, "assets", "logo.svg");
const ICONSET_DIR = join(ROOT, "icon.iconset");
const PUBLIC_DIR = join(ROOT, "src", "mainview", "public");

// macOS iconset sizes — name: logical size, px: actual pixel dimension.
const SIZES = [
	{ name: "icon_16x16.png", px: 16 },
	{ name: "icon_16x16@2x.png", px: 32 },
	{ name: "icon_32x32.png", px: 32 },
	{ name: "icon_32x32@2x.png", px: 64 },
	{ name: "icon_128x128.png", px: 128 },
	{ name: "icon_128x128@2x.png", px: 256 },
	{ name: "icon_256x256.png", px: 256 },
	{ name: "icon_256x256@2x.png", px: 512 },
	{ name: "icon_512x512.png", px: 512 },
	{ name: "icon_512x512@2x.png", px: 1024 },
];

async function main() {
	const svg = await readFile(SVG_PATH);

	await rm(ICONSET_DIR, { recursive: true, force: true });
	await mkdir(ICONSET_DIR, { recursive: true });
	await mkdir(PUBLIC_DIR, { recursive: true });

	for (const { name, px } of SIZES) {
		const out = join(ICONSET_DIR, name);
		await sharp(svg, { density: 384 })
			.resize(px, px)
			.png({ compressionLevel: 9 })
			.toFile(out);
		console.log(`  ${name.padEnd(28)} ${px}x${px}`);
	}

	// Favicon for the webview titlebar / dev server.
	await sharp(svg, { density: 384 })
		.resize(64, 64)
		.png({ compressionLevel: 9 })
		.toFile(join(PUBLIC_DIR, "favicon.png"));

	// Also drop the SVG into public so the index.html can reference it.
	await writeFile(join(PUBLIC_DIR, "logo.svg"), svg);

	console.log(`\nIconset written to ${ICONSET_DIR}`);
}

await main();
