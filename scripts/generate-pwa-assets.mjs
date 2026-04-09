// Generates all PWA raster assets from the master SVGs.
// Run: npm run pwa:icons
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT       = process.cwd();
const SRC        = join(ROOT, "assets/tifo-logo.svg");
const SRC_MASK   = join(ROOT, "assets/tifo-logo-maskable.svg");
const OUT_PUBLIC = join(ROOT, "public");
const OUT_SPLASH = join(OUT_PUBLIC, "splash");

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

async function png(srcSvg, size, outPath, { bg = "#0c0900" } = {}) {
  ensureDir(outPath);
  await sharp(srcSvg)
    .resize(size, size, { fit: "contain", background: bg })
    .flatten({ background: bg })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}×${size})`);
}

async function splash(srcSvg, w, h, outPath) {
  ensureDir(outPath);
  // Center the logo onto a 40 % width square, centered on a w×h canvas.
  const logoSize = Math.round(Math.min(w, h) * 0.4);
  const logoBuffer = await sharp(srcSvg)
    .resize(logoSize, logoSize, { fit: "contain", background: "#0c0900" })
    .flatten({ background: "#0c0900" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: w, height: h, channels: 4, background: "#0c0900" },
  })
    .composite([{ input: logoBuffer, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${w}×${h})`);
}

async function main() {
  // Standard icons
  await png(SRC, 192, join(OUT_PUBLIC, "icon-192.png"));
  await png(SRC, 256, join(OUT_PUBLIC, "icon-256.png"));
  await png(SRC, 384, join(OUT_PUBLIC, "icon-384.png"));
  await png(SRC, 512, join(OUT_PUBLIC, "icon-512.png"));

  // Maskable variants
  await png(SRC_MASK, 192, join(OUT_PUBLIC, "icon-maskable-192.png"));
  await png(SRC_MASK, 512, join(OUT_PUBLIC, "icon-maskable-512.png"));

  // Apple touch icon
  await png(SRC, 180, join(OUT_PUBLIC, "apple-touch-icon.png"));

  // Favicon 32
  await png(SRC, 32, join(OUT_PUBLIC, "favicon-32.png"));

  // iOS splash screens (portrait): iPhone X/11/12/13/14/15/Pro/Max + iPad Air/Pro
  const SPLASH = [
    [1125, 2436, "iphone-x-11pro-12mini-13mini"],
    [1170, 2532, "iphone-12-13-14"],
    [1290, 2796, "iphone-14pro-max-15-pro-max"],
    [1668, 2388, "ipad-air-11"],
    [2048, 2732, "ipad-pro-13"],
  ];
  for (const [w, h, label] of SPLASH) {
    await splash(SRC, w, h, join(OUT_SPLASH, `apple-splash-${label}.png`));
  }

  console.log("\n✅ All PWA assets generated.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
