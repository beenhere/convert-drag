'use strict';

// Windows for tools that need input: crop, background, edit, annotate,
// redact (images) and trim (audio/video). The page previews; the main process
// renders the final file from the parameters the page sends back.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { appUrl, shareFile, unshareFile } = require('./protocol');
const { formatOfPath, kindOf } = require('./catalog');
const image = require('./engine/image');
const media = require('./engine/media');
const { formatBytes, sizeOf } = require('./jobs');

const TITLES = {
  crop: 'Crop Image',
  background: 'Add Background',
  edit: 'Edit Image',
  annotate: 'Annotate',
  redact: 'Redact',
  trim: 'Trim',
};

class Editors {
  constructor({ jobs }) {
    this.jobs = jobs;
    this.sessions = new Map(); // webContents id -> {tool, file, temp: []}
    this.registerIpc();
  }

  open(tool, file) {
    if (!TITLES[tool]) throw new Error(`No editor for ${tool}`);
    const win = new BrowserWindow({
      width: tool === 'trim' ? 860 : 1000,
      height: tool === 'trim' ? 620 : 780,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: `${TITLES[tool]} — ${path.basename(file)}`,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'editor.js'),
        sandbox: true,
        contextIsolation: true,
        spellcheck: false,
      },
    });
    const id = win.webContents.id;
    this.sessions.set(id, { tool, file, temp: [], shared: [] });
    win.on('closed', () => this.cleanup(id));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.loadURL(appUrl(`editor/index.html?tool=${encodeURIComponent(tool)}`));
    return win;
  }

  cleanup(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    for (const t of s.temp) fs.rm(t, { force: true }, () => {});
    for (const f of s.shared) unshareFile(f);
    this.sessions.delete(id);
  }

  async init(session) {
    const { tool, file } = session;
    const base = { tool, title: TITLES[tool], name: path.basename(file), size: formatBytes(sizeOf(file)), platform: process.platform };
    if (tool === 'trim') {
      const info = await media.probe(file);
      session.shared.push(file);
      return { ...base, kind: kindOf(formatOfPath(file)), media: { url: shareFile(file), ...info } };
    }
    const dims = await image.dimensions(file);
    const prev = await image.preview(file, path.join(os.tmpdir(), `convertdrag-preview-${process.pid}-${Date.now()}`));
    session.temp.push(prev.file);
    session.shared.push(prev.file);
    return { ...base, kind: 'image', width: dims.width, height: dims.height, preview: { url: shareFile(prev.file), width: prev.width, height: prev.height } };
  }

  registerIpc() {
    const sessionFor = (e) => this.sessions.get(e.sender.id);
    ipcMain.handle('editor:init', async (e) => {
      const s = sessionFor(e);
      if (!s) throw new Error('No editor session');
      return this.init(s);
    });
    ipcMain.handle('editor:frame', async (e, at) => {
      const s = sessionFor(e);
      if (!s || s.tool !== 'trim') return null;
      try {
        const jpg = await media.frameJpeg(s.file, Number(at) || 0);
        return `data:image/jpeg;base64,${jpg.toString('base64')}`;
      } catch {
        return null;
      }
    });
    ipcMain.handle('editor:save', async (e, params) => {
      const s = sessionFor(e);
      if (!s) return { ok: false, error: 'No editor session' };
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await this.jobs.run(
        { actionId: `tool:${s.tool}`, files: [s.file], params: params || {} },
        { notify: true, onProgress: (v) => !e.sender.isDestroyed() && e.sender.send('editor:progress', v) },
      );
      if (result.ok && win && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.close(), 350);
      return result;
    });
    ipcMain.on('editor:close', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && this.sessions.has(e.sender.id)) win.close();
    });
  }
}

module.exports = { Editors };
