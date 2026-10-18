'use strict';

// Work that needs a browser engine: rendering PDF pages (pdf.js on a canvas),
// extracting PDF text, and printing HTML to PDF. A hidden window runs pdf.js;
// printing uses a throwaway window per document.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { appUrl } = require('./protocol');

const PRINT_TIMEOUT = 30_000;

class ChromiumBridge {
  constructor() {
    this.win = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    ipcMain.on('engine:result', (e, msg) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error || 'Engine error'));
    });
    ipcMain.on('engine:progress', (e, msg) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      this.pending.get(msg.id)?.onProgress?.(msg.value);
    });
  }

  ensure() {
    if (this.ready) return this.ready;
    this.win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'engine.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    this.ready = new Promise((resolve, reject) => {
      ipcMain.once('engine:ready', resolve);
      this.win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`Engine failed to load: ${desc}`)));
    });
    this.win.on('closed', () => {
      this.win = null;
      this.ready = null;
      for (const p of this.pending.values()) p.reject(new Error('Engine closed'));
      this.pending.clear();
    });
    this.win.loadURL(appUrl('engine/index.html'));
    return this.ready;
  }

  async call(method, args, onProgress) {
    await this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.win.webContents.send('engine:task', { id, method, args });
    });
  }

  /** @returns {Promise<Uint8Array[]>} one PNG per page */
  renderPdf(bytes, { scale = 2, onProgress } = {}) {
    return this.call('pdf.render', { data: new Uint8Array(bytes), scale }, onProgress);
  }

  /** @returns {Promise<Array<{lines: Array<{text: string, size: number, y: number}>}>>} */
  pdfText(bytes) {
    return this.call('pdf.text', { data: new Uint8Array(bytes) });
  }

  async htmlToPdf(html) {
    const tmp = path.join(os.tmpdir(), `convertdrag-print-${process.pid}-${Date.now()}.html`);
    await fs.writeFile(tmp, html);
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, images: true },
    });
    try {
      await withTimeout(win.loadFile(tmp), PRINT_TIMEOUT, 'Timed out loading the document');
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.7, bottom: 0.7, left: 0.65, right: 0.65 },
      });
      return Buffer.from(pdf);
    } finally {
      win.destroy();
      fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  destroy() {
    this.win?.destroy();
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(timer));
}

module.exports = { ChromiumBridge };
