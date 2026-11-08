// Renders the PWA icons and iOS splash screens from the same tile as the login screen (ForgeIcon):
// lucide "hammer" in #e8c58a on a sand-tinted dark tile. Output goes to public/.
// Run:  npm i --no-save sharp && node scripts/generate-pwa-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SAND = '#e8c58a';
const BG = '#16130f';

// Tile on a 512 canvas. `rounded` adds the corner radius and border of the login tile; without it the
// artwork is full-bleed (iOS and maskable icons are masked by the system).
const HAMMER_SCALE = 11; // 24-unit lucide grid -> 264 px, centered
const tile = (rounded) => `
  <defs>
    <linearGradient id="tint" gradientUnits="userSpaceOnUse" x1="51.3" y1="-36.1" x2="460.7" y2="548.1">
      <stop offset="0" stop-color="#e8c58a" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#b48c50" stop-opacity="0.12"/>
    </linearGradient>
    <clipPath id="shape"><rect width="512" height="512" rx="${rounded ? 128 : 0}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="512" height="512" fill="${BG}"/>
    <rect width="512" height="512" fill="url(#tint)"/>
  </g>
  ${rounded ? `<rect x="4" y="4" width="504" height="504" rx="124" fill="none" stroke="#e8c58a" stroke-opacity="0.32" stroke-width="8"/>` : ''}
  <g transform="translate(${256 - 12 * HAMMER_SCALE} ${256 - 12 * HAMMER_SCALE}) scale(${HAMMER_SCALE})" fill="none" stroke="${SAND}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9"/>
    <path d="m18 15 4-4"/>
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>
  </g>`;

const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${tile(rounded)}</svg>`;
const png = (source, size, file) => sharp(Buffer.from(source), { density: 384 }).resize(size, size).png().toFile(join(publicDir, file));

writeFileSync(join(publicDir, 'favicon.svg'), svg(true));
await png(svg(true), 192, 'icon-192.png');
await png(svg(true), 512, 'icon-512.png');
await png(svg(false), 512, 'icon-maskable-512.png');
await png(svg(false), 180, 'apple-touch-icon.png');

// iOS ignores the manifest splash: one launch image per device size (portrait), matched by media query.
const devices = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
  [820, 1180, 2], [834, 1194, 2], [834, 1112, 2], [768, 1024, 2], [1024, 1366, 2],
];
mkdirSync(join(publicDir, 'splash'), { recursive: true });
const links = [];
for (const [w, h, ratio] of devices) {
  const width = w * ratio;
  const height = h * ratio;
  const box = Math.round(Math.min(width, height) * 0.26);
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${BG}"/>
    <svg x="${Math.round((width - box) / 2)}" y="${Math.round((height - box) / 2)}" width="${box}" height="${box}" viewBox="0 0 512 512">${tile(true)}</svg>
  </svg>`;
  const file = `splash/launch-${width}x${height}.png`;
  await sharp(Buffer.from(source), { density: 72 }).png({ compressionLevel: 9 }).toFile(join(publicDir, file));
  links.push(`    <link rel="apple-touch-startup-image" href="/${file}?v=forge-2" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" />`);
}
console.log(links.join('\n'));
