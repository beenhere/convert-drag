'use strict';

// The radial menu window. It is created once and moved under the cursor when
// the trigger fires. Until the OS reports a file drag entering it, its content
// stays invisible, so modifier-drags that aren't file drags (selecting text,
// drawing in an editor) never show anything.

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ipcMain, screen, app } = require('electron');
const { appUrl } = require('./protocol');
const catalog = require('./catalog');
const { formatBytes, sizeOf } = require('./jobs');
const { debug } = require('./log');

const SIZE = 440;
const ARM_TIMEOUT = 260; // ms without a dragenter before we give up...
const ARM_DISTANCE = 28; // ...once the mouse has moved this far

class Overlay {
  /**
   * @param {{jobs: import('./jobs').JobRunner, openEditor: (tool: string, file: string) => void}} deps
   */
  constructor({ jobs, openEditor }) {
    this.jobs = jobs;
    this.openEditor = openEditor;
    this.state = 'hidden'; // hidden | armed | active | pinned | busy
    this.win = null;
    this.armedAt = 0;
    this.armPoint = null;
    this.releaseTimer = null;
    this.registerIpc();
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const mac = process.platform === 'darwin';
    this.win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      ...(mac ? { type: 'panel' } : {}),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    if (mac) this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.win.on('blur', () => {
      if (this.state === 'pinned') this.hide();
    });
    this.win.loadURL(appUrl('overlay/index.html'));
    return this.win;
  }

  isOurs(e) {
    return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, data);
  }

  placeAt(point) {
    const display = screen.getDisplayNearestPoint(point);
    const wa = display.workArea;
    const x = Math.round(Math.min(Math.max(point.x - SIZE / 2, wa.x), wa.x + wa.width - SIZE));
    const y = Math.round(Math.min(Math.max(point.y - SIZE / 2, wa.y), wa.y + wa.height - SIZE));
    this.win.setBounds({ x, y, width: SIZE, height: SIZE });
  }

  /** Called when the drag trigger fires. */
  arm() {
    if (this.state === 'busy' || this.state === 'pinned') return;
    this.create();
    clearTimeout(this.releaseTimer);
    const point = screen.getCursorScreenPoint();
    this.placeAt(point);
    this.state = 'armed';
    this.armedAt = Date.now();
    this.armPoint = point;
    this.send('overlay:arm', { mode: 'drag' });
    debug('overlay armed at', point);
    this.win.showInactive();
    this.win.setAlwaysOnTop(true, 'screen-saver');
  }

  /** Open the menu in click mode for files we already know (CLI, tray, Open With). */
  open(paths, point = screen.getCursorScreenPoint()) {
    debug('overlay open (click mode)', paths, point);
    this.create();
    clearTimeout(this.releaseTimer);
    const go = () => {
      this.placeAt(point);
      this.state = 'pinned';
      this.send('overlay:arm', { mode: 'pinned', paths, ...this.inspect(paths) });
      this.win.show();
      this.win.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    };
    if (this.win.webContents.isLoading()) this.win.webContents.once('did-finish-load', go);
    else go();
  }

  hide() {
    if (this.state !== 'hidden') debug('overlay hide from', this.state);
    clearTimeout(this.releaseTimer);
    this.state = 'hidden';
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.send('overlay:reset');
      this.win.hide();
    }
  }

  /** Global mouse move while the overlay is armed but no file drag has entered it. */
  onMove() {
    if (this.state !== 'armed') return;
    if (Date.now() - this.armedAt < ARM_TIMEOUT) return;
    const p = screen.getCursorScreenPoint();
    if (Math.hypot(p.x - this.armPoint.x, p.y - this.armPoint.y) > ARM_DISTANCE) this.hide();
  }

  /** Global mouse button release. */
  onRelease() {
    if (this.state === 'armed') return this.hide();
    if (this.state !== 'active') return;
    // The drop event (if it landed on us) can arrive after the global mouseup.
    this.send('overlay:released');
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      if (this.state === 'active') this.hide();
    }, 700);
  }

  onTap() {
    if (this.state === 'active' || this.state === 'pinned') this.send('overlay:next-page');
  }

  inspect(paths) {
    const menu = catalog.menuForPaths(paths);
    const total = paths.reduce((a, p) => a + (sizeOf(p) || 0), 0);
    let sub;
    if (paths.length === 1) {
      const fmt = catalog.formatOfPath(paths[0]);
      sub = [fmt ? catalog.labelOf(fmt) : path.extname(paths[0]).slice(1).toUpperCase() || 'File', formatBytes(total)].filter(Boolean).join(' · ');
    } else {
      sub = `${paths.length} files · ${formatBytes(total)}`;
    }
    return { menu, sub };
  }

  registerIpc() {
    ipcMain.on('overlay:entered', (e) => {
      if (!this.isOurs(e)) return;
      if (this.state === 'armed') this.state = 'active';
      debug('file drag entered overlay');
    });
    ipcMain.handle('overlay:menu-for-mimes', (e, mimes) => {
      if (!this.isOurs(e)) return null;
      return catalog.menuForMimes(Array.isArray(mimes) ? mimes.map(String) : []);
    });
    ipcMain.handle('overlay:inspect', (e, paths) => {
      if (!this.isOurs(e)) return null;
      return this.inspect(validPaths(paths));
    });
    ipcMain.on('overlay:pin', (e) => {
      if (!this.isOurs(e)) return;
      clearTimeout(this.releaseTimer);
      this.state = 'pinned';
      this.win.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    });
    ipcMain.on('overlay:hide', (e) => {
      if (this.isOurs(e)) this.hide();
    });
    ipcMain.handle('overlay:run', async (e, { actionId, paths }) => {
      if (!this.isOurs(e)) return { ok: false, error: 'Not allowed' };
      const files = validPaths(paths);
      if (!files.length) return { ok: false, error: 'Nothing to convert' };
      const action = catalog.parseAction(actionId);
      if (!action) return { ok: false, error: 'Unknown action' };
      clearTimeout(this.releaseTimer);
      if (action.editor) {
        this.hide();
        this.openEditor(action.tool, files[0]);
        return { ok: true, editor: true };
      }
      this.state = 'busy';
      debug('run', actionId, files);
      const result = await this.jobs.run({ actionId, files }, { onProgress: (v) => this.send('overlay:progress', v) });
      if (this.state === 'busy') this.state = 'active';
      debug('result', result.ok ? result.outputs : result.error);
      return result;
    });
  }
}

function validPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p));
}

module.exports = { Overlay, SIZE };
