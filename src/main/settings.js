'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULTS = {
  enabled: true,
  modifier: 'shift', // shift | alt | ctrl | meta
  outputMode: 'same', // same | folder
  outputFolder: '',
  jpegQuality: 90,
  notifications: true,
  openAtLogin: false,
  revealAfter: false,
};

const MODIFIERS = new Set(['shift', 'alt', 'ctrl', 'meta']);

class Settings extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.values = { ...DEFAULTS };
    try {
      Object.assign(this.values, sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))));
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  update(patch) {
    const clean = sanitize(patch);
    Object.assign(this.values, clean);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    } catch (e) {
      console.error('Could not save settings:', e);
    }
    this.emit('change', this.all(), clean);
    return this.all();
  }

  /** Folder outputs go to, or null for "next to the original". */
  outDir() {
    if (this.values.outputMode !== 'folder' || !this.values.outputFolder) return null;
    try {
      if (fs.statSync(this.values.outputFolder).isDirectory()) return this.values.outputFolder;
    } catch {
      // Folder was removed; fall back to next-to-original.
    }
    return null;
  }
}

function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (MODIFIERS.has(input.modifier)) out.modifier = input.modifier;
  if (input.outputMode === 'same' || input.outputMode === 'folder') out.outputMode = input.outputMode;
  if (typeof input.outputFolder === 'string') out.outputFolder = input.outputFolder;
  if (Number.isFinite(input.jpegQuality)) out.jpegQuality = Math.max(40, Math.min(100, Math.round(input.jpegQuality)));
  if (typeof input.notifications === 'boolean') out.notifications = input.notifications;
  if (typeof input.openAtLogin === 'boolean') out.openAtLogin = input.openAtLogin;
  if (typeof input.revealAfter === 'boolean') out.revealAfter = input.revealAfter;
  return out;
}

module.exports = { Settings, DEFAULTS };
