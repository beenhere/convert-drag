'use strict';

// End-to-end run of the real interaction on Linux/X11 with xdotool: a window
// starts an OS-level file drag, Shift is pressed mid-drag, the overlay must
// appear under the cursor, and the file is dropped on the JPG wedge.
//
// Under a bare Xvfb, Chromium's X11 drag-and-drop doesn't deliver drop events
// to other windows, so by default only the trigger part is required. Set
// E2E_REQUIRE_DROP=1 on a real X11 desktop to require the conversion too.
//
// Run: xvfb-run -a npx electron --no-sandbox test/electron/drag-trigger.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const sharp = require('sharp');

const protocol = require('../../src/main/protocol');
protocol.registerSchemes();

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'convertdrag-e2e-'));
const log = (...a) => console.log('[e2e]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle();
  const { Settings } = require('../../src/main/settings');
  const { JobRunner } = require('../../src/main/jobs');
  const { ChromiumBridge } = require('../../src/main/bridge');
  const { Overlay } = require('../../src/main/overlay');
  const { DragTrigger } = require('../../src/main/trigger');

  const settings = new Settings(path.join(work, 'settings.json'));
  settings.update({ notifications: false });
  const jobs = new JobRunner({ settings, bridge: new ChromiumBridge() });
  const overlay = new Overlay({ jobs, openEditor: (tool, file) => log('editor', tool, file) });
  const win = overlay.create();
  await new Promise((r) => win.webContents.once('did-finish-load', r));

  if (process.env.E2E_DEBUG) {
    overlay.onMove = () => {};
    win.webContents.on('console-message', (e) => log('renderer:', e.message));
    await win.webContents.executeJavaScript(`for (const t of ['dragenter','dragover','drop','dragleave']) document.addEventListener(t, e => { if (t !== 'dragover' || !window.__dov) { console.log(t, JSON.stringify(Array.from(e.dataTransfer.types)), Array.from(e.dataTransfer.items).map(i => i.kind + ':' + i.type).join(','), e.clientX, e.clientY); if (t === 'dragover') window.__dov = 1; } }, true); 1`);
  }
  const states = [];
  const origArm = overlay.arm.bind(overlay);
  overlay.arm = () => {
    origArm();
    states.push('armed');
    log('overlay armed at', win.getBounds());
  };

  const trigger = new DragTrigger({ modifier: 'shift' });
  trigger.on('trigger', () => overlay.arm());
  trigger.on('move', () => overlay.onMove());
  trigger.on('release', () => overlay.onRelease());
  if (!trigger.start()) throw new Error('hook did not start');

  // Source window that drags a real file.
  const sample = path.join(work, 'Sample.png');
  await sharp({ create: { width: 320, height: 200, channels: 3, background: '#ff7a33' } }).png().toFile(sample);
  const preload = path.join(work, 'preload.js');
  fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('api', { drag: () => require('electron').ipcRenderer.send('drag') })");
  const source = new BrowserWindow({ x: 0, y: 0, width: 360, height: 360, frame: false, webPreferences: { preload, sandbox: false } });
  ipcMain.on('drag', (e) => {
    log('startDrag');
    e.sender.startDrag({ file: sample, icon: nativeImage.createFromPath(sample).resize({ width: 48 }) });
  });
  await source.loadURL(`data:text/html,${encodeURIComponent('<body style="margin:0"><div id="d" draggable="true" style="width:360px;height:360px;background:#09f;color:#fff;font:20px sans-serif">drag me</div><script>d.addEventListener("dragstart", e => { e.preventDefault(); window.api.drag(); })</script></body>')}`);
  source.show();
  await wait(800);

  let entered = false;
  ipcMain.on('overlay:entered', () => {
    entered = true;
    log('overlay saw dragenter with files');
  });

  // startDrag() runs a nested loop on Linux that blocks this script's
  // timers, so the input sequence runs in a separate shell process.
  // The cursor is at (200,200) when Shift goes down; the overlay is clamped
  // to the screen at (0,0), which puts the menu center at (220,220) and the
  // JPG wedge (first on a PNG's Convert page) straight above it.
  const script = [
    'xdotool mousemove 150 150', 'sleep 0.2', 'xdotool mousedown 1', 'sleep 0.1',
    ...[160, 170, 180, 190].map((v) => `xdotool mousemove ${v} ${v}; sleep 0.05`),
    'sleep 0.4', 'xdotool keydown shift', 'sleep 0.3',
    ...[195, 200].map((v) => `xdotool mousemove ${v} ${v}; sleep 0.05`),
    'sleep 0.5',
    ...[180, 160, 140, 120, 110].map((y, i) => `xdotool mousemove ${200 + (i + 1) * 4} ${y}; sleep 0.06`),
    'sleep 0.6', 'xdotool keyup shift', 'xdotool mouseup 1',
  ].join('\n');
  const { spawn } = require('node:child_process');
  spawn('sh', ['-c', script], { stdio: 'inherit' });
  let hot = null;
  const hotTimer = setInterval(async () => {
    try {
      const h = await win.webContents.executeJavaScript('__overlay.state.hot');
      if (h != null) hot = h;
    } catch {}
  }, 100);

  const expected = path.join(work, 'Sample.jpg');
  for (let i = 0; i < 80 && !fs.existsSync(expected); i++) await wait(150);
  clearInterval(hotTimer);
  log('hot wedge seen', hot);
  const ok = fs.existsSync(expected);
  const meta = ok ? await sharp(expected).metadata() : null;
  log('result', ok ? `${expected} ${meta.format} ${meta.width}x${meta.height}` : 'no output');
  await wait(1500);
  log('overlay state after', overlay.state, 'visible', win.isVisible());

  const armed = states.includes('armed');
  const dropped = entered && hot === 0 && ok && meta.format === 'jpeg';
  log(`trigger: ${armed ? 'ok' : 'FAILED'}; drop + convert: ${dropped ? 'ok' : entered ? 'FAILED' : 'no dragenter delivered'}`);
  const pass = armed && (dropped || !process.env.E2E_REQUIRE_DROP);
  console.log(pass ? 'E2E PASS' : 'E2E FAIL');
  trigger.stop();
  app.exit(pass ? 0 : 1);
});
