'use strict';

// Renders the README images in docs/ from the real app UI: the hero banner,
// the animated demo, radial-menu tiles, and framed editor/settings windows.
//
//   npm run screenshots
//   (Linux/CI: xvfb-run -a npx electron --no-sandbox scripts/screenshots.js)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');

const S = 2; // render everything at 2x for crisp images
app.commandLine.appendSwitch('force-device-scale-factor', String(S));

const protocol = require('../src/main/protocol');
protocol.registerSchemes();

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'convertdrag-shots-'));
const FONT_CSS = "html, body, button, input, select { font-family: Inter, -apple-system, 'Segoe UI', system-ui, sans-serif !important; }";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * S}" height="${h * S}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const png = (buf) => sharp(buf).png().toBuffer();

// --- Artwork ------------------------------------------------------------------

function wallpaper(w, h) {
  return svg(
    w,
    h,
    `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".48" stop-color="#ff5e3a"/><stop offset="1" stop-color="#7b6cf6"/></linearGradient>
      <radialGradient id="a" cx=".18" cy=".12" r=".55"><stop offset="0" stop-color="#ffd98a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
      <radialGradient id="b" cx=".88" cy=".92" r=".6"><stop offset="0" stop-color="#a98bff" stop-opacity=".85"/><stop offset="1" stop-color="#a98bff" stop-opacity="0"/></radialGradient>
      <radialGradient id="c" cx=".62" cy=".42" r=".45"><stop offset="0" stop-color="#ff3d6e" stop-opacity=".35"/><stop offset="1" stop-color="#ff3d6e" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#a)"/><rect width="${w}" height="${h}" fill="url(#b)"/><rect width="${w}" height="${h}" fill="url(#c)"/>`,
  );
}

function landscapeSvg() {
  const W = 1600;
  const H = 1000;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2d6e"/><stop offset=".45" stop-color="#f36f5a"/><stop offset=".7" stop-color="#ffc27a"/></linearGradient>
      <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6d5"/><stop offset=".35" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
      <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb37a"/><stop offset="1" stop-color="#3b2f6b"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="980" cy="560" r="260" fill="url(#sun)"/>
    <circle cx="980" cy="560" r="78" fill="#fff4cf"/>
    <path d="M0 620 L180 470 L330 560 L520 380 L700 540 L860 430 L1040 590 L1230 420 L1420 560 L1600 470 V700 H0Z" fill="#8f4e86" opacity=".85"/>
    <path d="M0 680 L240 540 L420 640 L640 500 L860 650 L1080 540 L1300 660 L1600 560 V720 H0Z" fill="#5e3a7a"/>
    <rect y="700" width="${W}" height="300" fill="url(#lake)"/>
    <ellipse cx="980" cy="760" rx="160" ry="10" fill="#fff1c9" opacity=".7"/>
    <ellipse cx="980" cy="800" rx="110" ry="6" fill="#fff1c9" opacity=".45"/>
    <ellipse cx="980" cy="840" rx="70" ry="4" fill="#fff1c9" opacity=".3"/>
    <path d="M0 720 L160 690 L320 720 Z M1250 715 L1450 680 L1600 715Z" fill="#2c2152" opacity=".6"/>
  </svg>`);
}

/** A made-up analytics app window, used for Add background / Annotate / Redact. */
function dashboardSvg() {
  const rows = [
    ['Jane Cooper', 'jane.cooper@example.com', '•••• 4242', '$1,284.00'],
    ['Devon Lane', 'devon.lane@example.com', '•••• 1881', '$932.50'],
    ['Esther Howard', 'esther.h@example.com', '•••• 5100', '$2,410.20'],
    ['Cody Fisher', 'cody.fisher@example.com', '•••• 7731', '$618.90'],
  ];
  const bars = [52, 61, 48, 70, 66, 82, 77, 94, 88, 102, 97, 118];
  const nav = ['Overview', 'Customers', 'Invoices', 'Reports', 'Settings'];
  const t = (x, y, s, w, c, txt, extra = '') => `<text x="${x}" y="${y}" font-family="Inter" font-size="${s}" font-weight="${w}" fill="${c}" ${extra}>${txt}</text>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880">
    <rect width="1400" height="880" fill="#f6f7fb"/>
    <rect width="250" height="880" fill="#ffffff"/><rect x="250" width="1" height="880" fill="#e6e8ef"/>
    <rect x="28" y="30" width="34" height="34" rx="9" fill="#ff5a1f"/>${t(74, 54, 20, 700, '#14151a', 'Lumen')}
    ${nav.map((n, i) => `<rect x="18" y="${104 + i * 50}" width="214" height="40" rx="10" fill="${i === 0 ? '#fff1ea' : 'none'}"/>${t(48, 130 + i * 50, 16, i === 0 ? 650 : 500, i === 0 ? '#ff5a1f' : '#5b6070', n)}`).join('')}
    ${t(290, 70, 30, 750, '#14151a', 'Revenue overview')}${t(290, 100, 15, 500, '#8a8f9e', 'March 2026 · All regions')}
    ${[
      ['Revenue', '$48,210', '+24%'],
      ['Customers', '1,842', '+8%'],
      ['Avg. order', '$26.17', '+3%'],
    ]
      .map(([k, v, d], i) => {
        const x = 290 + i * 362;
        return `<rect x="${x}" y="130" width="340" height="128" rx="16" fill="#fff" stroke="#e6e8ef"/>${t(x + 24, 168, 15, 600, '#8a8f9e', k)}${t(x + 24, 220, 34, 750, '#14151a', v)}<rect x="${x + 236}" y="194" width="80" height="30" rx="15" fill="#e8f8ef"/>${t(x + 254, 215, 15, 700, '#1f9d55', d)}`;
      })
      .join('')}
    <rect x="290" y="282" width="1064" height="276" rx="16" fill="#fff" stroke="#e6e8ef"/>${t(314, 322, 17, 700, '#14151a', 'Monthly revenue')}
    ${bars.map((b, i) => `<rect x="${330 + i * 84}" y="${530 - b * 1.7}" width="46" height="${b * 1.7}" rx="8" fill="${i === 11 ? '#ff5a1f' : '#ffc9b3'}"/>`).join('')}
    <rect x="290" y="582" width="1064" height="270" rx="16" fill="#fff" stroke="#e6e8ef"/>${t(314, 622, 17, 700, '#14151a', 'Recent customers')}
    ${['Name', 'Email', 'Card', 'Spent'].map((h, i) => t([314, 560, 900, 1150][i], 662, 13, 700, '#8a8f9e', h.toUpperCase(), 'letter-spacing="1"')).join('')}
    ${rows
      .map((r, j) => {
        const y = 704 + j * 42;
        return `<rect x="304" y="${y - 28}" width="1036" height="1" fill="#eef0f5"/>${t(314, y, 16, 600, '#14151a', r[0])}${t(560, y, 16, 500, '#5b6070', r[1])}${t(900, y, 16, 500, '#5b6070', r[2])}${t(1150, y, 16, 650, '#14151a', r[3])}`;
      })
      .join('')}
  </svg>`);
}

async function thumbData() {
  const buf = await sharp(landscapeSvg()).resize(144, 96).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const ICON_W = 120;
const ICON_H = 116;
/** Desktop-style file icon with its name underneath (120×116 DIP box). */
function iconBody({ ext, color, name, selected, thumb }) {
  const label = `<text x="60" y="103" text-anchor="middle" font-family="Inter" font-size="13" font-weight="600" fill="#fff" ${selected ? '' : 'filter="url(#ts)"'}>${name}</text>`;
  const labelBg = selected ? `<rect x="${60 - name.length * 3.9 - 8}" y="89" width="${name.length * 7.8 + 16}" height="20" rx="5" fill="#2f6fed"/>` : '';
  const sel = selected ? '<rect x="22" y="0" width="76" height="82" rx="9" fill="#000" fill-opacity=".2"/>' : '';
  let doc;
  if (thumb) {
    doc = `<g filter="url(#ds)"><rect x="24" y="16" width="72" height="54" rx="4" fill="#fff"/><image href="${thumb}" x="27" y="19" width="66" height="48" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    doc = `<g filter="url(#ds)" transform="translate(32 6)"><path d="M6 0 H40 L56 16 V66 a6 6 0 0 1 -6 6 H6 a6 6 0 0 1 -6 -6 V6 a6 6 0 0 1 6 -6 Z" fill="#fff"/><path d="M40 0 V12 a4 4 0 0 0 4 4 H56" fill="#e9e9ee"/>
      <rect x="9" y="22" width="30" height="3" rx="1.5" fill="#d5d7de"/><rect x="9" y="29" width="38" height="3" rx="1.5" fill="#d5d7de"/><rect x="9" y="36" width="34" height="3" rx="1.5" fill="#d5d7de"/>
      <rect x="7" y="47" width="42" height="17" rx="4" fill="${color}"/><text x="28" y="60" text-anchor="middle" font-family="Inter" font-size="10.5" font-weight="800" fill="#fff">${ext}</text></g>`;
  }
  return `<defs><filter id="ds" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity=".3"/></filter>
    <filter id="ts" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity=".55"/></filter></defs>${sel}${doc}${labelBg}${label}`;
}

const icon = (o) => png(svg(ICON_W, ICON_H, iconBody(o)));
const ghost = (o) => png(svg(ICON_W, ICON_H, `<g opacity=".72">${iconBody(o)}</g>`));
// Ghost without the file name, for stills where it sits next to a wedge label.
const GHOST_K = 0.85;
const bareGhost = (o) => png(svg(ICON_W * GHOST_K, 84 * GHOST_K, `<g opacity=".78" transform="scale(${GHOST_K})">${iconBody({ ...o, name: '' })}</g>`));
const cursor = () =>
  png(svg(26, 30, `<path d="M3 2 L3 23 L8.4 18 L12 26.4 L15.4 25 L11.8 16.8 L19 16.8 Z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>`));
const plusBadge = () => png(svg(22, 22, `<circle cx="11" cy="11" r="10" fill="#28c840" stroke="#fff" stroke-width="1.6"/><path d="M11 6.5 V15.5 M6.5 11 H15.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`));
const countBadge = (n) => png(svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="#ff3b30" stroke="#fff" stroke-width="1.6"/><text x="13" y="17.5" text-anchor="middle" font-family="Inter" font-size="13" font-weight="800" fill="#fff">${n}</text>`));
const keycap = (pressed) =>
  png(
    svg(
      150,
      62,
      `<defs><linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${pressed ? '#e4e4ea' : '#f1f1f5'}"/></linearGradient></defs>
      <rect x="4" y="${pressed ? 9 : 7}" width="142" height="48" rx="11" fill="#000" fill-opacity=".28"/>
      <rect x="4" y="${pressed ? 6 : 2}" width="142" height="48" rx="11" fill="url(#k)" stroke="#d2d2da"/>
      <text x="75" y="${pressed ? 37 : 33}" text-anchor="middle" font-family="Inter, DejaVu Sans" font-size="19" font-weight="650" fill="#2a2a33">⇧ shift</text>`,
    ),
  );

async function scaled(buf, k) {
  const m = await sharp(buf).metadata();
  return sharp(buf).resize(Math.max(1, Math.round(m.width * k)), Math.max(1, Math.round(m.height * k))).png().toBuffer();
}

async function roundCorners(buf, r) {
  const m = await sharp(buf).metadata();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><rect width="${m.width}" height="${m.height}" rx="${r}" ry="${r}"/></svg>`);
  return sharp(buf).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/** Puts a window screenshot in a macOS-style frame on the wallpaper. */
async function framed(content, title, { pad = 56 } = {}) {
  const m = await sharp(content).metadata();
  const cw = m.width / S;
  const ch = m.height / S;
  const bar = 34;
  const ww = cw;
  const wh = ch + bar;
  const W = ww + pad * 2;
  const H = wh + pad * 2;
  const frame = svg(
    ww,
    wh,
    `<rect width="${ww}" height="${wh}" rx="12" fill="#fafafc"/><rect width="${ww}" height="${bar}" rx="12" fill="#ececf0"/><rect y="${bar - 12}" width="${ww}" height="12" fill="#ececf0"/><rect y="${bar - 1}" width="${ww}" height="1" fill="#d9d9df"/>
     <circle cx="20" cy="17" r="6.2" fill="#ff5f57"/><circle cx="40" cy="17" r="6.2" fill="#febc2e"/><circle cx="60" cy="17" r="6.2" fill="#28c840"/>
     <text x="${ww / 2}" y="22" text-anchor="middle" font-family="Inter" font-size="13" font-weight="600" fill="#55555c">${title}</text>`,
  );
  let win = await sharp(frame).composite([{ input: content, left: 0, top: bar * S }]).png().toBuffer();
  win = await roundCorners(win, 12 * S);
  const shadow = await sharp(svg(W, H, `<rect x="${pad}" y="${pad + 18}" width="${ww}" height="${wh}" rx="14" fill="#000" fill-opacity=".38"/>`))
    .blur(22 * S)
    .png()
    .toBuffer();
  return sharp(wallpaper(W, H))
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: win, left: pad * S, top: pad * S },
    ])
    .png()
    .toBuffer();
}

async function save(buf, name, { width, format = 'webp', quality = 90 } = {}) {
  let img = sharp(buf);
  if (width) img = img.resize(width);
  const out = path.join(DOCS, name);
  if (format === 'webp') await img.webp({ quality, effort: 6, smartSubsample: true }).toFile(out);
  else if (format === 'jpg') await img.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(out);
  else await img.png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', path.relative(ROOT, out), `${Math.round(fs.statSync(out).size / 1024)} KB`);
  return out;
}

// --- Driving the overlay -------------------------------------------------------

const C = 220; // menu center inside the 440×440 overlay window

function wedgePoint(i, n, r = 113, turn = 0) {
  const a = -Math.PI / 2 + ((i + turn) * 2 * Math.PI) / n;
  return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
}

/** Where the cursor rests on a wedge: near its outer edge and off to one side, clear of the label. */
const POINT_R = 142;
const POINT_TURN = 0.27;
const pointer = (i, n) => wedgePoint(i, n, POINT_R, POINT_TURN);

async function main() {
  protocol.handle();
  fs.mkdirSync(DOCS, { recursive: true });
  const catalog = require('../src/main/catalog');
  const { Overlay } = require('../src/main/overlay');

  // Sample files the UI refers to.
  const heic = path.join(WORK, 'Photo.heic');
  fs.writeFileSync(heic, 'sample');
  const landscape = path.join(WORK, 'Lake.jpg');
  await sharp(landscapeSvg()).jpeg({ quality: 92 }).toFile(landscape);
  const dashboard = path.join(WORK, 'Dashboard.png');
  await sharp(dashboardSvg()).png().toFile(dashboard);

  const fakeJobs = {
    run: async (job, { onProgress } = {}) => {
      for (const v of [0.12, 0.3, 0.52, 0.74, 0.9, 1]) {
        onProgress?.(v);
        await wait(110);
      }
      return { ok: true, outputs: [], errors: [], summary: { title: 'Saved JPG', detail: 'Photo.jpg', name: 'Photo.jpg' } };
    },
  };
  const overlay = new Overlay({ jobs: fakeJobs, openEditor: () => {} });
  const win = overlay.create();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await win.webContents.insertCSS(FONT_CSS);
  win.setBounds({ x: 0, y: 0, width: 440, height: 440 });
  win.showInactive();
  const js = (code) => win.webContents.executeJavaScript(code);
  // SHOTS_DEBUG=1 logs what the overlay does, for when a capture comes out wrong.
  const DEBUG = Boolean(process.env.SHOTS_DEBUG);
  const T0 = Date.now();
  const trace = (...a) => DEBUG && console.log(`[${Date.now() - T0}ms]`, ...a);
  if (DEBUG) {
    win.webContents.on('ipc-message', (_e, channel) => trace('overlay ->', channel));
    win.on('hide', () => trace('overlay window hidden'));
    win.webContents.on('render-process-gone', (_e, d) => trace('overlay renderer gone', JSON.stringify(d)));
    const origHide = overlay.hide.bind(overlay);
    overlay.hide = () => {
      trace('overlay.hide() from', new Error().stack.split('\n').slice(2, 5).join(' | '));
      origHide();
    };
  }
  const grab = async () => (await win.webContents.capturePage()).toPNG();
  // Wait for running CSS transitions (not the endless spinner) and a paint.
  const settle = () =>
    js(`Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {})))
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => 1)`);
  const dragEvent = (type, x, y, mime = 'image/heic', count = 1) =>
    js(`(() => { const dt = new DataTransfer(); for (let i = 0; i < ${count}; i++) dt.items.add(new File(['x'], 'f' + i, { type: '${mime}' })); document.getElementById('stage').dispatchEvent(new DragEvent('${type}', { dataTransfer: dt, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true })); return true; })()`);

  const thumb = await thumbData();
  const parts = {
    cursor: await cursor(),
    plus: await plusBadge(),
    keyUp: await keycap(false),
    keyDown: await keycap(true),
    heicIcon: await icon({ name: 'Photo.heic', thumb }),
    heicSel: await icon({ name: 'Photo.heic', thumb, selected: true }),
    heicGhost: await ghost({ name: 'Photo.heic', thumb }),
    jpgIcon: await icon({ name: 'Photo.jpg', thumb }),
  };
  const deco = [
    { ext: 'PDF', color: '#e5413a', name: 'Report.pdf' },
    { ext: 'MOV', color: '#5856d6', name: 'Clip.mov' },
    { ext: 'DOCX', color: '#2b6cdf', name: 'Notes.docx' },
    { ext: 'MP3', color: '#ff2d74', name: 'Song.mp3' },
  ];
  for (const d of deco) d.png = await icon(d);

  // ---- Animated demo ----------------------------------------------------------
  const DW = 900;
  const DH = 520;
  const MENU = { x: 520, y: 262 };
  const ICON = { x: 190, y: 190 }; // icon box center
  const NEW = { x: 190, y: 330 };
  const OL = { x: MENU.x - C, y: MENU.y - C };
  const wall = await png(wallpaper(DW, DH));
  const decoLayers = deco.map((d, i) => ({ input: d.png, left: (DW - 135) * S, top: (24 + i * 120) * S }));
  const desktop = async (sel, extra = []) =>
    sharp(wall)
      .composite([...decoLayers, { input: sel ? parts.heicSel : parts.heicIcon, left: (ICON.x - ICON_W / 2) * S, top: (ICON.y - ICON_H / 2) * S }, ...extra])
      .png()
      .toBuffer();
  const desk = { plain: await desktop(false), sel: await desktop(true) };

  const frames = [];
  const framesDir = path.join(WORK, 'frames');
  fs.mkdirSync(framesDir);
  async function frame({ base = desk.sel, menu = null, at = null, drag = false, plus = false, key = null, layers = [] }) {
    const comp = [];
    if (menu) comp.push({ input: menu, left: OL.x * S, top: OL.y * S });
    comp.push(...layers);
    if (key) comp.push({ input: key === 'down' ? parts.keyDown : parts.keyUp, left: Math.round((DW / 2 - 75) * S), top: (DH - 78) * S });
    // The file was grabbed by its name, so the ghost hangs above the cursor.
    if (at && drag) comp.push({ input: parts.heicGhost, left: Math.round((at.x - ICON_W / 2) * S), top: Math.round((at.y - 98) * S) });
    if (at && plus) comp.push({ input: parts.plus, left: Math.round((at.x + 10) * S), top: Math.round((at.y + 14) * S) });
    if (at) comp.push({ input: parts.cursor, left: Math.round((at.x - 3) * S), top: Math.round((at.y - 2) * S) });
    const out = path.join(framesDir, `f${String(frames.length).padStart(4, '0')}.png`);
    await sharp(base).composite(comp).png().toFile(out);
    frames.push(out);
  }
  const hold = async (n, opts) => {
    for (let i = 0; i < n; i++) await frame(opts);
  };

  const iconCenter = { x: ICON.x, y: ICON.y + 40 }; // on the file name
  // 1. Cursor goes to the file and grabs it.
  for (let i = 0; i <= 16; i++) {
    const t = ease(i / 16);
    await frame({ base: desk.plain, at: { x: lerp(90, iconCenter.x, t), y: lerp(470, iconCenter.y, t) } });
  }
  await hold(5, { base: desk.sel, at: iconCenter });
  // 2. Drag it out.
  for (let i = 1; i <= 20; i++) {
    const t = ease(i / 20);
    await frame({ at: { x: lerp(iconCenter.x, MENU.x, t), y: lerp(iconCenter.y, MENU.y, t) + Math.sin(t * Math.PI) * -26 }, drag: true });
  }
  // 3. Press Shift: the menu pops under the cursor.
  await hold(3, { at: MENU, drag: true, key: 'up' });
  win.webContents.send('overlay:arm', { mode: 'drag' });
  await wait(80);
  await dragEvent('dragenter', C, C);
  for (let i = 0; i < 50 && !(await js('Boolean(__overlay.state.menu)')); i++) await wait(20);
  await wait(60);
  await js('window.__anims = document.getAnimations(); __anims.forEach((a) => { a.pause(); a.currentTime = 0; }); __anims.length');
  for (let t = 0; t <= 280; t += 35) {
    await js(`__anims.forEach((a) => (a.currentTime = ${t})); 1`);
    await wait(45);
    await frame({ menu: await grab(), at: MENU, drag: true, plus: true, key: 'down' });
  }
  await js('__anims.forEach((a) => a.finish()); 1');
  await wait(60);
  // 4. Move to the JPG wedge (the real hit-testing picks the hot wedge).
  const menuNow = await js('__overlay.state.menu');
  const n = menuNow.pages[0].items.length;
  const target = pointer(0, n);
  for (let i = 1; i <= 20; i++) {
    const t = ease(i / 20);
    const lx = lerp(C, target.x, t) + Math.sin(t * Math.PI) * 34;
    const ly = lerp(C, target.y, t);
    if (Math.hypot(lx - C, ly - C) > 64) await dragEvent('dragover', lx, ly);
    if (DEBUG) trace('hover', i, await js('__overlay.state.mode + " hot=" + __overlay.state.hot'));
    await wait(30);
    await frame({ menu: await grab(), at: { x: OL.x + lx, y: OL.y + ly }, drag: true, plus: true, key: 'down' });
  }
  const at = { x: OL.x + target.x, y: OL.y + target.y };
  await settle();
  const hotMenu = await grab();
  await hold(10, { menu: hotMenu, at, drag: true, plus: true, key: 'down' });
  // 5. Drop: a few "working" frames, then "Saved", then the menu fades out.
  // Fixed frame counts keep the GIF's pacing independent of capture speed.
  const item = menuNow.pages[0].items[0];
  if (DEBUG) trace('drop', await js('__overlay.state.mode'), win.isVisible());
  if (!win.isVisible()) win.showInactive();
  js(`__overlay.runItem(${JSON.stringify(item)}, ${JSON.stringify([heic])})`);
  const modes = [];
  const dropped = Date.now();
  let busyFrames = 0;
  let doneImg = null;
  let retries = 0;
  while (!doneImg) {
    const mode = await js('__overlay.state.mode');
    if (modes[modes.length - 1] !== mode) modes.push(mode);
    if (mode === 'idle' && retries < 3) {
      // Rarely, on a loaded machine, the menu resets mid-job; set it up again.
      retries++;
      trace('menu reset during the drop; re-arming');
      win.showInactive();
      win.webContents.send('overlay:arm', { mode: 'drag' });
      await wait(150);
      await dragEvent('dragenter', C, C);
      for (let i = 0; i < 100 && !(await js('Boolean(__overlay.state.menu)')); i++) await wait(30);
      await settle();
      await js('__overlay.setHot(0); 1');
      js(`__overlay.runItem(${JSON.stringify(item)}, ${JSON.stringify([heic])})`);
      continue;
    }
    if (mode === 'error') throw new Error(`Demo drop failed: ${await js("document.querySelector('.hub-sub').textContent")}`);
    if (Date.now() - dropped > 15000) throw new Error(`Demo drop stuck in "${mode}" (${modes.join(' > ')})`);
    const img = await grab();
    if (mode === 'done') doneImg = img;
    else if (mode === 'busy') {
      // The Shift key is let go right after the drop.
      for (let r = 0; r < 3 && busyFrames < 18; r++, busyFrames++) await frame({ menu: img, at, key: busyFrames < 4 ? 'up' : null });
    }
  }
  await hold(32, { menu: doneImg, at });
  // The app shrinks and fades the menu away; do the same from the last frame.
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const size = Math.round(440 * S * (1 - 0.15 * t));
    const off = Math.round((440 * S - size) / 2);
    const alpha = { input: Buffer.from([255, 255, 255, Math.round(255 * (1 - t))]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' };
    const faded = await sharp(doneImg).resize(size, size).ensureAlpha().composite([alpha]).png().toBuffer();
    await frame({ at, layers: [{ input: faded, left: OL.x * S + off, top: OL.y * S + off }] });
  }
  for (let i = 0; i < 40 && win.isVisible(); i++) await wait(100);
  // 6. The new file appears next to the original.
  for (let i = 1; i <= 8; i++) {
    const k = i < 6 ? lerp(0.4, 1.12, i / 6) : lerp(1.12, 1, (i - 6) / 2);
    const scaledIcon = await scaled(parts.jpgIcon, k);
    const m = await sharp(scaledIcon).metadata();
    await frame({ at, layers: [{ input: scaledIcon, left: Math.round(NEW.x * S - m.width / 2), top: Math.round(NEW.y * S - m.height / 2) }] });
  }
  const finalDesk = await desktop(false, [{ input: parts.jpgIcon, left: (NEW.x - ICON_W / 2) * S, top: (NEW.y - ICON_H / 2) * S }]);
  await hold(38, { base: finalDesk, at });
  console.log(`demo: ${frames.length} frames (states ${modes.join(' > ')})`);

  const gif = path.join(DOCS, 'demo.gif');
  await require('../src/main/engine/ffmpeg').run([
    '-framerate', '25', '-i', path.join(framesDir, 'f%04d.png'),
    '-filter_complex', 'scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0', '-y', gif,
  ]);
  console.log('wrote docs/demo.gif', `${Math.round(fs.statSync(gif).size / 1024)} KB`);
  const mp4 = path.join(DOCS, 'demo.mp4');
  await require('../src/main/engine/ffmpeg').run(['-framerate', '25', '-i', path.join(framesDir, 'f%04d.png'), '-vf', 'scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4]);
  console.log('wrote docs/demo.mp4', `${Math.round(fs.statSync(mp4).size / 1024)} KB`);

  // ---- Menu tiles -------------------------------------------------------------
  const TILE = 470;
  const bigWall = await png(wallpaper(TILE * 3, TILE * 2));
  async function tile(index, { paths: files, mimes, page = 0, hot, mode = 'drag', run = false, ghostIcon, count = 1 }) {
    win.showInactive();
    win.webContents.send('overlay:reset');
    await wait(60);
    const menu = files ? catalog.menuForPaths(files) : catalog.menuForMimes(mimes);
    await js(`__overlay.setMode('${mode}'); __overlay.show(${JSON.stringify(menu)}); 1`);
    await wait(50);
    await settle();
    for (let i = 0; i < page; i++) {
      await js('__overlay.nextPage(); 1');
      await wait(50);
      await settle();
      await wait(300); // the old page is removed after its exit transition
    }
    const items = menu.pages[page].items;
    const hi = typeof hot === 'number' ? hot : items.findIndex((it) => it.id === hot);
    const p = pointer(hi, items.length);
    const u = { x: (p.x - C) / POINT_R, y: (p.y - C) / POINT_R };
    await js(`__overlay.setHot(${hi}); 1`);
    await wait(30);
    await settle();
    if (run) {
      js(`__overlay.runItem(__overlay.state.menu.pages[${page}].items[${hi}], ${JSON.stringify([heic])})`);
      for (let i = 0; i < 200 && (await js('__overlay.state.mode')) !== 'done'; i++) await wait(50);
      await wait(30);
      await settle();
    }
    const shot = await grab();
    const off = (TILE - 440) / 2;
    const col = index % 3;
    const row = Math.floor(index / 3);
    const layers = [{ input: shot, left: off * S, top: off * S }];
    if (!run) {
      const at2 = { x: off + p.x, y: off + p.y };
      // Doc center of the ghost sits just outside the cursor, away from the menu center.
      const gx = at2.x + u.x * 44;
      const gy = at2.y + u.y * 44;
      if (ghostIcon) layers.push({ input: ghostIcon, left: Math.round((gx - 60 * GHOST_K) * S), top: Math.round((gy - 40 * GHOST_K) * S) });
      if (count > 1) layers.push({ input: await countBadge(count), left: Math.round((gx + 14) * S), top: Math.round((gy - 44) * S) });
      layers.push({ input: parts.plus, left: Math.round((at2.x + 10) * S), top: Math.round((at2.y + 14) * S) });
      layers.push({ input: parts.cursor, left: Math.round((at2.x - 3) * S), top: Math.round((at2.y - 2) * S) });
    }
    const bg = await sharp(bigWall).extract({ left: col * TILE * S, top: row * TILE * S, width: TILE * S, height: TILE * S }).png().toBuffer();
    return roundCorners(await sharp(bg).composite(layers).png().toBuffer(), 22 * S);
  }
  const photoGhost = await bareGhost({ thumb });
  const pdfGhost = await bareGhost({ ext: 'PDF', color: '#e5413a' });
  const movGhost = await bareGhost({ ext: 'MOV', color: '#5856d6' });
  const tiles = [
    ['menu-convert.webp', { mimes: ['image/heic'], hot: 'to:jpg', ghostIcon: photoGhost }],
    ['menu-tools.webp', { mimes: ['image/heic'], page: 1, hot: 'tool:background', ghostIcon: photoGhost }],
    ['menu-merge.webp', { mimes: ['image/png', 'image/jpeg', 'image/png'], page: 1, hot: 'tool:merge-pdf', ghostIcon: photoGhost, count: 3 }],
    ['menu-pdf.webp', { mimes: ['application/pdf'], hot: 'to:docx', ghostIcon: pdfGhost }],
    ['menu-video.webp', { mimes: ['video/quicktime'], page: 1, hot: 'tool:trim', ghostIcon: movGhost }],
    ['menu-done.webp', { mimes: ['image/heic'], hot: 'to:jpg', run: true }],
  ];
  for (let i = 0; i < tiles.length; i++) await save(await tile(i, tiles[i][1]), tiles[i][0], { width: 720, quality: 88 });

  // Hero menu (transparent), used in the banner. Let the "Saved" tile finish
  // hiding first, or its timer resets the menu mid-capture.
  for (let i = 0; i < 60 && win.isVisible(); i++) await wait(100);
  win.showInactive();
  win.webContents.send('overlay:reset');
  await wait(60);
  await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(catalog.menuForMimes(['image/heic']))}); 1`);
  await wait(50);
  await settle();
  await js('__overlay.setHot(0); 1');
  await wait(30);
  await settle();
  const heroMenu = path.join(WORK, 'hero-menu.png');
  fs.writeFileSync(heroMenu, await grab());
  win.hide();

  // ---- Editors ----------------------------------------------------------------
  const { Editors } = require('../src/main/editors');
  const editors = new Editors({ jobs: fakeJobs });
  const clip = path.join(WORK, 'Lake Timelapse.mp4');
  await require('../src/main/engine/ffmpeg').run([
    '-loop', '1', '-framerate', '24', '-t', '12', '-i', landscape,
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=12',
    '-vf', "scale=1920:-2,zoompan=z='1+0.0012*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x800:fps=24,format=yuv420p",
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', clip,
  ]);
  // Landscape sample is 1600×1000; the dashboard is 1400×880.
  const shapesAnnotate = [
    { type: 'rect', x: 278, y: 120, w: 364, h: 150, color: '#ff3b30', size: 6 },
    { type: 'text', x: 720, y: 296, text: 'Best month yet!', color: '#ff3b30', fontSize: 38 },
    { type: 'arrow', x1: 1040, y1: 318, x2: 1244, y2: 318, color: '#ff3b30', size: 6 },
    { type: 'highlight', x: 300, y: 680, w: 1046, h: 34, color: '#ffcc00' },
  ];
  const shapesRedact = [
    { type: 'redact', style: 'solid', x: 552, y: 682, w: 236, h: 158 },
    { type: 'redact', style: 'pixelate', x: 892, y: 682, w: 104, h: 158 },
    { type: 'redact', style: 'blur', x: 306, y: 682, w: 150, h: 158 },
  ];
  const editorShots = [
    ['crop', landscape, { ratio: '16:9', rect: { x: 400, y: 150, w: 960, h: 540 } }, 'Crop Image — Lake.jpg'],
    ['background', dashboard, { background: 7, padding: 120, radius: 26, shadow: 46, ratio: '16:9' }, 'Add Background — Dashboard.png'],
    ['annotate', dashboard, shapesAnnotate, 'Annotate — Dashboard.png'],
    ['redact', dashboard, shapesRedact, 'Redact — Dashboard.png'],
    ['edit', landscape, { brightness: 6, contrast: 22, saturation: 35 }, 'Edit Image — Lake.jpg'],
    ['trim', clip, { start: 0.18, end: 0.72 }, 'Trim — Lake Timelapse.mp4'],
  ];
  for (const [tool, file, demo, title] of editorShots) {
    const ew = editors.open(tool, file);
    ew.setSize(1120, tool === 'trim' ? 700 : 820);
    await new Promise((r) => ew.webContents.once('did-finish-load', r));
    await ew.webContents.insertCSS(FONT_CSS);
    await ew.webContents.executeJavaScript('window.__ready');
    await wait(tool === 'trim' ? 2600 : 700);
    await ew.webContents.executeJavaScript(`window.__demo(${JSON.stringify(demo)}); 1`);
    await wait(600);
    const shot = (await ew.webContents.capturePage()).toPNG();
    await save(await framed(shot, title), `editor-${tool}.webp`, { width: 1400, quality: 90 });
    ew.destroy();
  }

  // ---- Settings ---------------------------------------------------------------
  const values = { ...require('../src/main/settings').DEFAULTS };
  ipcMain.handle('settings:get', () => ({ values, platform: 'darwin', version: require('../package.json').version, permission: true, hookRunning: true, conversions: catalog.countConversions() }));
  ipcMain.handle('settings:set', (_e, patch) => Object.assign(values, patch));
  const sw = new BrowserWindow({ width: 560, height: 700, show: true, webPreferences: { preload: path.join(ROOT, 'src', 'preload', 'settings.js'), sandbox: true } });
  await sw.loadURL(protocol.appUrl('settings/index.html'));
  await sw.webContents.insertCSS(FONT_CSS);
  await wait(500);
  await save(await framed((await sw.webContents.capturePage()).toPNG(), 'ConvertDrag Settings', { pad: 48 }), 'settings.webp', { width: 760, quality: 90 });
  sw.destroy();

  // ---- Hero banner ------------------------------------------------------------
  fs.writeFileSync(path.join(WORK, 'ghost.png'), photoGhost);
  fs.writeFileSync(path.join(WORK, 'cursor.png'), parts.cursor);
  fs.writeFileSync(path.join(WORK, 'plus.png'), parts.plus);
  fs.writeFileSync(path.join(WORK, 'key.png'), parts.keyDown);
  fs.writeFileSync(path.join(WORK, 'wall.png'), await png(wallpaper(1280, 640)));
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'shared', 'logo.svg'), path.join(WORK, 'logo.svg'));
  const jpgHot = pointer(0, catalog.menuForMimes(['image/heic']).pages[0].items.length);
  const ju = { x: (jpgHot.x - C) / POINT_R, y: (jpgHot.y - C) / POINT_R };
  const heroMenuX = 700;
  const heroMenuY = 70;
  const k = 500 / 440;
  const hx = heroMenuX + jpgHot.x * k;
  const hy = heroMenuY + jpgHot.y * k;
  const chip = (t) => `<span class="chip">${t}</span>`;
  fs.writeFileSync(
    path.join(WORK, 'hero.html'),
    `<!doctype html><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; }
      body { width: 1280px; height: 640px; overflow: hidden; font-family: Inter, sans-serif; color: #fff; position: relative; }
      .bg { position: absolute; inset: 0; width: 1280px; height: 640px; }
      .copy { position: absolute; left: 84px; top: 112px; width: 600px; }
      .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 26px; }
      .brand img { width: 84px; height: 84px; filter: drop-shadow(0 10px 22px rgba(120, 30, 0, .45)); }
      h1 { font-size: 66px; font-weight: 800; letter-spacing: -2px; text-shadow: 0 2px 18px rgba(90, 20, 0, .25); }
      .tag { font-size: 34px; font-weight: 750; letter-spacing: -.8px; line-height: 1.15; margin-bottom: 18px; text-shadow: 0 2px 14px rgba(90, 20, 0, .25); }
      .sub { font-size: 20px; line-height: 1.45; font-weight: 500; opacity: .93; margin-bottom: 30px; max-width: 540px; }
      .chips { display: flex; gap: 10px; flex-wrap: wrap; }
      .chip { font-size: 15px; font-weight: 650; padding: 8px 14px; border-radius: 999px; background: rgba(255, 255, 255, .2); border: 1px solid rgba(255, 255, 255, .45); backdrop-filter: blur(6px); }
      .menu { position: absolute; left: ${heroMenuX}px; top: ${heroMenuY}px; width: 500px; height: 500px; }
      .abs { position: absolute; }
    </style>
    <img class="bg" src="wall.png">
    <div class="copy">
      <div class="brand"><img src="logo.svg"><h1>ConvertDrag</h1></div>
      <div class="tag">Hold Shift while you drag.<br>Convert anything.</div>
      <div class="sub">A radial menu pops up under your cursor. Drop a file on it to convert, compress, crop, trim or merge. Right where the file is, with nothing uploaded.</div>
      <div class="chips">${['macOS', 'Windows', 'Linux', '100% local', 'Open source · MIT'].map(chip).join('')}</div>
    </div>
    <img class="menu" src="hero-menu.png">
    <img class="abs" src="ghost.png" style="left:${hx + ju.x * 44 * k - 60 * GHOST_K}px; top:${hy + ju.y * 44 * k - 40 * GHOST_K}px; width:${ICON_W * GHOST_K}px">
    <img class="abs" src="plus.png" style="left:${hx + 10}px; top:${hy + 14}px; width:22px">
    <img class="abs" src="cursor.png" style="left:${hx - 3}px; top:${hy - 2}px; width:26px">
    <img class="abs" src="key.png" style="left:${heroMenuX + 175}px; top:${heroMenuY + 500}px; width:150px">`,
  );
  const hero = new BrowserWindow({ width: 1280, height: 640, show: true, frame: false, useContentSize: true });
  await hero.loadFile(path.join(WORK, 'hero.html'));
  await hero.webContents.executeJavaScript('Promise.all([...document.images].map((i) => i.decode())).then(() => document.fonts.ready).then(() => 1)');
  await wait(300);
  const heroPng = (await hero.webContents.capturePage()).toPNG();
  await save(heroPng, 'hero.webp', { width: 1600, quality: 90 });
  await save(heroPng, 'social-preview.jpg', { width: 1280, format: 'jpg', quality: 88 });
  hero.destroy();

  fs.rmSync(WORK, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error(e);
    app.exit(1);
  }),
);
