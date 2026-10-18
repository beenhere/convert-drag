'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Notification, shell } = require('electron');
const engine = require('./engine');
const { parseAction, labelOf } = require('./catalog');

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((a, n) => a + sizeOf(path.join(p, n)), 0);
  } catch {
    return NaN;
  }
}

/** Short human summary of a finished job, shown in the overlay hub. */
function summarize(actionId, files, result) {
  const { outputs, errors } = result;
  const action = parseAction(actionId);
  const name = outputs.length === 1 ? path.basename(outputs[0]) : `${outputs.length} files`;
  let detail = name;
  if (action?.type === 'tool' && action.tool === 'compress') {
    const before = files.reduce((a, f) => a + sizeOf(f), 0);
    const after = outputs.reduce((a, f) => a + sizeOf(f), 0);
    detail = `${formatBytes(before)} → ${formatBytes(after)}`;
  }
  const title = errors.length ? `${outputs.length} of ${files.length} done` : action?.type === 'convert' ? `Saved ${labelOf(action.target)}` : 'Done';
  return { title, detail, name };
}

class JobRunner {
  /**
   * @param {{settings: import('./settings').Settings, bridge: object}} deps
   */
  constructor({ settings, bridge }) {
    this.settings = settings;
    this.bridge = bridge;
    this.active = 0;
  }

  /**
   * @param {{actionId: string, files: string[], params?: object}} job
   * @param {{onProgress?: (f: number) => void, notify?: boolean}} [opts]
   */
  async run(job, { onProgress, notify = false } = {}) {
    this.active++;
    const ctx = {
      outDir: this.settings.outDir(),
      settings: this.settings.all(),
      bridge: this.bridge,
      progress: throttle(onProgress || (() => {}), 50),
    };
    try {
      const result = await engine.run(job, ctx);
      const summary = summarize(job.actionId, job.files, result);
      if (result.errors.length) this.notify('Some files failed', result.errors.map((e) => `${path.basename(e.file)}: ${e.message}`).join('\n'));
      else if (notify) this.notify(summary.title, summary.detail, result.outputs[0]);
      if (this.settings.get('revealAfter') && result.outputs[0]) shell.showItemInFolder(result.outputs[0]);
      return { ok: true, outputs: result.outputs, errors: result.errors, summary };
    } catch (e) {
      const message = cleanError(e);
      this.notify('Conversion failed', message);
      return { ok: false, error: message };
    } finally {
      this.active--;
    }
  }

  notify(title, body, reveal) {
    if (!this.settings.get('notifications') || !Notification.isSupported()) return;
    const n = new Notification({ title, body: body || '', silent: true });
    if (reveal) n.on('click', () => shell.showItemInFolder(reveal));
    n.show();
  }
}

function cleanError(e) {
  const msg = String(e?.message || e);
  if (/Input file contains unsupported image format|unsupported image format/i.test(msg)) return 'Unsupported or damaged image';
  if (/Invalid data found when processing input/i.test(msg)) return 'Unsupported or damaged media file';
  if (/EACCES|EPERM/.test(msg)) return "Can't write here — choose another output folder in Settings";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

function throttle(fn, ms) {
  let last = 0;
  return (v) => {
    const now = Date.now();
    if (v >= 1 || now - last >= ms) {
      last = now;
      fn(v);
    }
  };
}

module.exports = { JobRunner, formatBytes, sizeOf, summarize };
