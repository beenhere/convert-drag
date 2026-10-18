'use strict';

// Electron-side checks: pdf.js rendering/text, HTML printing, and screenshots
// of the overlay and editors. Run with `npm run test:electron` (needs a
// display; use xvfb-run on Linux CI).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const protocol = require('../../src/main/protocol');
protocol.registerSchemes();

const OUT = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', '.tmp', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'convertdrag-electron-'));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`ok - ${name}`);
  } catch (e) {
    results.push(['fail', name, e]);
    console.log(`not ok - ${name}\n  ${e.stack}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win, file, backdrop = true) {
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  if (!backdrop) return fs.writeFileSync(path.join(OUT, file), png);
  const { width, height } = img.getSize();
  // Composite the transparent overlay on a desktop-like gradient.
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7b733"/><stop offset=".55" stop-color="#fc4a1a"/><stop offset="1" stop-color="#8e7cc3"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  await sharp(Buffer.from(bg)).composite([{ input: png }]).png().toFile(path.join(OUT, file));
}

app.whenReady().then(async () => {
  protocol.handle();
  const { ChromiumBridge } = require('../../src/main/bridge');
  const bridge = new ChromiumBridge();
  const engine = require('../../src/main/engine');
  const ctx = { outDir: null, settings: {}, bridge };

  const pdfPath = path.join(work, 'Page 001.pdf');
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= 2; i++) {
      const page = doc.addPage([595, 842]);
      page.drawText(`Chapter ${i}`, { x: 60, y: 760, size: 26, font: bold });
      page.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 720, size: 12, font });
      page.drawText('A second line in the same paragraph.', { x: 60, y: 705, size: 12, font });
    }
    fs.writeFileSync(pdfPath, await doc.save());
  }
  const onePage = path.join(work, 'Single.pdf');
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 200]).drawText('Hello', { x: 20, y: 100, size: 30, font });
    fs.writeFileSync(onePage, await doc.save());
  }

  await step('pdf renders to JPG (single page -> file)', async () => {
    const { outputs } = await engine.run({ actionId: 'to:jpg', files: [onePage] }, ctx);
    const m = await sharp(outputs[0]).metadata();
    assert.equal(m.format, 'jpeg');
    assert.deepEqual([m.width, m.height], [600, 400]);
  });

  await step('pdf renders to PNG (multi page -> folder)', async () => {
    const { outputs } = await engine.run({ actionId: 'to:png', files: [pdfPath] }, ctx);
    const files = fs.readdirSync(outputs[0]);
    assert.equal(files.length, 2);
    fs.copyFileSync(path.join(outputs[0], files[0]), path.join(OUT, 'pdf-page.png'));
  });

  await step('pdf text extraction', async () => {
    const { outputs } = await engine.run({ actionId: 'to:txt', files: [pdfPath] }, ctx);
    const text = fs.readFileSync(outputs[0], 'utf8');
    assert.match(text, /Chapter 1\n+The quick brown fox jumps over the lazy dog\.\nA second line/);
    const { outputs: md } = await engine.run({ actionId: 'to:md', files: [pdfPath] }, ctx);
    assert.match(fs.readFileSync(md[0], 'utf8'), /^# Chapter 1/m);
    const { outputs: docx } = await engine.run({ actionId: 'to:docx', files: [pdfPath] }, ctx);
    assert.ok(fs.statSync(docx[0]).size > 1000);
  });

  await step('markdown prints to PDF', async () => {
    const md = path.join(work, 'Readme.md');
    fs.writeFileSync(md, '# Hello PDF\n\nSome *text* and a table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    const { outputs } = await engine.run({ actionId: 'to:pdf', files: [md] }, ctx);
    const doc = await PDFDocument.load(fs.readFileSync(outputs[0]));
    assert.equal(doc.getPageCount(), 1);
    const { outputs: imgs } = await engine.run({ actionId: 'to:png', files: [outputs[0]] }, ctx);
    fs.copyFileSync(imgs[0], path.join(OUT, 'markdown-pdf.png'));
  });

  await step('documents and images merge into one PDF', async () => {
    const md = path.join(work, 'Readme.md');
    const png = path.join(work, 'pic.png');
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#09f' } }).png().toFile(png);
    const { outputs } = await engine.run({ actionId: 'tool:merge-pdf', files: [md, png, pdfPath] }, ctx);
    assert.equal((await PDFDocument.load(fs.readFileSync(outputs[0]))).getPageCount(), 4);
  });

  // --- Overlay screenshots ---------------------------------------------------
  const { Overlay } = require('../../src/main/overlay');
  const catalog = require('../../src/main/catalog');
  const fakeJobs = { run: async () => ({ ok: true, outputs: [], errors: [], summary: { title: 'Saved JPG', detail: 'Page 001.jpg' } }) };
  const overlay = new Overlay({ jobs: fakeJobs, openEditor: () => {} });
  const win = overlay.create();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  win.setBounds({ x: 0, y: 0, width: 440, height: 440 });
  win.showInactive();

  const js = (code) => win.webContents.executeJavaScript(code);

  await step('overlay builds the menu from dragenter MIME types and hit-tests dragover', async () => {
    win.webContents.send('overlay:arm', { mode: 'drag' });
    await wait(100);
    const fire = (type, x, y) => `(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.png', { type: 'image/png' })); document.getElementById('stage').dispatchEvent(new DragEvent('${type}', { dataTransfer: dt, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true })); return true; })()`;
    await js(fire('dragenter', 220, 220));
    await wait(300);
    const first = await js('__overlay.state.menu.pages[0].items.map((i) => i.id)');
    assert.equal(first[0], 'to:jpg');
    assert.ok(!first.includes('to:png'), 'own format is hidden');
    await js(fire('dragover', 220, 110));
    assert.equal(await js('__overlay.state.hot'), 0, 'top wedge');
    await js(fire('dragover', 220 + 110, 220));
    assert.equal(await js('__overlay.state.hot'), 2, 'right wedge of 8');
    await js(fire('dragover', 220, 220));
    assert.equal(await js('__overlay.state.hot'), 'hub');
    await wait(1100); // hovering the hub flips to the next page
    assert.equal(await js('__overlay.state.page'), 1);
    await js(fire('dragover', 5, 5));
    assert.equal(await js('__overlay.state.hot'), null, 'outside the ring');
  });

  await step('overlay renders PDF convert page', async () => {
    const menu = catalog.menuForPaths([pdfPath]);
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(menu)})`);
    await wait(400);
    await js('__overlay.setHot(1)');
    await wait(250);
    await capture(win, 'overlay-pdf.png');
  });

  await step('overlay renders image tools page', async () => {
    const menu = catalog.menuForPaths(['/x/Page 001.jpg']);
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(menu)}); __overlay.nextPage()`);
    await wait(450);
    await js('__overlay.setHot(4)');
    await wait(250);
    await capture(win, 'overlay-image-tools.png');
  });

  await step('overlay renders image convert page with hub hover', async () => {
    const menu = catalog.menuForPaths(['/x/Page 001.jpg']);
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(menu)})`);
    await wait(400);
    await js(`__overlay.setHot('hub')`);
    await wait(200);
    await capture(win, 'overlay-image-convert.png');
  });

  await step('overlay renders done state', async () => {
    const menu = catalog.menuForPaths([pdfPath]);
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(menu)}); __overlay.setHot(0)`);
    await wait(350);
    await js(`__overlay.runItem(__overlay.state.menu.pages[0].items[0], ${JSON.stringify([pdfPath])})`);
    await wait(250);
    await capture(win, 'overlay-done.png');
  });

  await step('overlay renders mixed selection and unknown', async () => {
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(catalog.menuForPaths(['a.png', 'b.pdf']))})`);
    await wait(400);
    await capture(win, 'overlay-mixed.png');
    await js(`__overlay.setMode('drag'); __overlay.show(${JSON.stringify(catalog.menuForMimes(['']))})`);
    await wait(400);
    await capture(win, 'overlay-unknown.png');
  });

  // --- Editors ---------------------------------------------------------------
  const { Editors } = require('../../src/main/editors');
  const editors = new Editors({ jobs: { run: async (job) => ({ ok: true, outputs: [], errors: [], summary: {}, job }) } });
  const photo = path.join(work, 'Photo.jpg');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27f"/><stop offset="1" stop-color="#ff6f61"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect x="150" y="120" width="900" height="560" rx="24" fill="#fff"/><g fill="#999">${Array.from({ length: 12 }, (_, i) => `<rect x="200" y="${170 + i * 40}" width="${500 + ((i * 97) % 300)}" height="14" rx="7"/>`).join('')}</g></svg>`;
  await sharp(Buffer.from(svg)).jpeg().toFile(photo);
  const clip = path.join(work, 'Clip.mp4');
  await require('../../src/main/engine/ffmpeg').run(['-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', clip]);

  for (const tool of ['crop', 'background', 'edit', 'annotate', 'redact', 'trim']) {
    await step(`editor ${tool} renders`, async () => {
      const ew = editors.open(tool, tool === 'trim' ? clip : photo);
      await new Promise((r) => ew.webContents.once('did-finish-load', r));
      await ew.webContents.executeJavaScript('window.__ready');
      await wait(900);
      await ew.webContents.executeJavaScript('window.__demo && window.__demo()');
      await wait(300);
      const errors = await ew.webContents.executeJavaScript('window.__errors || []');
      assert.deepEqual(errors, []);
      await capture(ew, `editor-${tool}.png`, false);
      const params = await ew.webContents.executeJavaScript('window.__params && window.__params()');
      assert.ok(params && typeof params === 'object', 'editor exposes params');
      ew.destroy();
    });
  }

  await step('settings window renders', async () => {
    const { ipcMain } = require('electron');
    const values = { ...require('../../src/main/settings').DEFAULTS, outputMode: 'folder', outputFolder: '/Users/me/Converted' };
    ipcMain.handle('settings:get', () => ({ values, platform: 'darwin', version: '0.1.0', permission: false, hookRunning: false, conversions: require('../../src/main/catalog').countConversions() }));
    ipcMain.handle('settings:set', (_e, patch) => Object.assign(values, patch));
    const sw = new BrowserWindow({ width: 560, height: 760, show: true, webPreferences: { preload: path.join(__dirname, '..', '..', 'src', 'preload', 'settings.js'), sandbox: true } });
    await sw.loadURL(protocol.appUrl('settings/index.html'));
    await wait(500);
    await capture(sw, 'settings.png', false);
    sw.destroy();
  });

  const failed = results.filter((r) => r[0] === 'fail');
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${OUT}`);
  bridge.destroy();
  app.exit(failed.length ? 1 : 0);
});
