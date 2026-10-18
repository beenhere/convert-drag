'use strict';

// Generates the app icon, tray icons and in-app logo from one drawing.
// Run with `npm run icons` after changing the artwork.

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');

function wedges(cx, cy, rIn, rOut, n, gap) {
  const out = [];
  const span = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + i * span;
    const dO = gap / 2 / rOut;
    const dI = gap / 2 / rIn;
    const a0 = mid - span / 2;
    const a1 = mid + span / 2;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    out.push(`M${p(rOut, a0 + dO)} A${rOut} ${rOut} 0 0 1 ${p(rOut, a1 - dO)} L${p(rIn, a1 - dI)} A${rIn} ${rIn} 0 0 0 ${p(rIn, a0 + dI)} Z`);
  }
  return out;
}

function appIcon() {
  const w = wedges(512, 512, 218, 368, 6, 34);
  // Opaque shapes inside a translucent group, so fill and stroke don't stack.
  const seg = (d) => `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round"/>`;
  const segs = `<g opacity=".62">${w.filter((_, i) => i !== 1).map(seg).join('')}</g>${seg(w[1])}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb35c"/>
      <stop offset=".55" stop-color="#ff5a1f"/>
      <stop offset="1" stop-color="#ee3a6a"/>
    </linearGradient>
    <radialGradient id="shine" cx=".3" cy=".2" r=".9">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#shine)"/>
  ${segs}
  <circle cx="512" cy="512" r="150" fill="#fff"/>
  <g fill="none" stroke="#ff5a1f" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M440 480 h140 l-40 -40"/>
    <path d="M584 544 h-140 l40 40"/>
  </g>
</svg>`;
}

/** Monochrome ring for the macOS menu bar (template image). */
function trayTemplate() {
  const w = wedges(16, 16, 6.2, 14, 6, 2.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g opacity=".75">${w.filter((_, i) => i !== 1).map((d) => `<path d="${d}" fill="#000"/>`).join('')}</g><path d="${w[1]}" fill="#000"/><circle cx="16" cy="16" r="3.4" fill="#000"/></svg>`;
}

/** Colored ring for the Windows/Linux tray. */
function trayColor() {
  const w = wedges(16, 16, 6.2, 14.5, 6, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa24d"/><stop offset="1" stop-color="#ff4d1c"/></linearGradient></defs>${w.map((d, i) => `<path d="${d}" fill="${i === 1 ? '#ff4d1c' : 'url(#g)'}" fill-opacity="${i === 1 ? 1 : 0.85}"/>`).join('')}<circle cx="16" cy="16" r="3.6" fill="#ff4d1c"/></svg>`;
}

async function main() {
  const icon = appIcon();
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets', 'tray'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'shared', 'logo.svg'), icon);
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.svg'), icon);
  await sharp(Buffer.from(icon)).png().toFile(path.join(ROOT, 'build', 'icon.png'));
  await sharp(Buffer.from(icon)).resize(512, 512).png().toFile(path.join(ROOT, 'assets', 'icon.png'));
  const tpl = Buffer.from(trayTemplate());
  await sharp(tpl, { density: 36 }).resize(16, 16).png().toFile(path.join(ROOT, 'assets', 'tray', 'trayTemplate.png'));
  await sharp(tpl, { density: 72 }).resize(32, 32).png().toFile(path.join(ROOT, 'assets', 'tray', 'trayTemplate@2x.png'));
  const color = Buffer.from(trayColor());
  await sharp(color, { density: 72 }).resize(32, 32).png().toFile(path.join(ROOT, 'assets', 'tray', 'tray.png'));
  await sharp(color, { density: 144 }).resize(64, 64).png().toFile(path.join(ROOT, 'assets', 'tray', 'tray@2x.png'));
  console.log('Icons written to build/ and assets/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
