'use strict';

// Watches global mouse/keyboard input and fires when the user is dragging
// something (left button held + moved) while holding the trigger modifier.
// Which app the drag belongs to doesn't matter: the overlay that appears under
// the cursor then becomes a normal OS drop target.

const { EventEmitter } = require('node:events');

const DRAG_THRESHOLD = 6;
const MOD_KEYS = {
  shift: [42, 54],
  alt: [56, 3640],
  ctrl: [29, 3613],
  meta: [3675, 3676],
};
const MOD_FLAGS = { shift: 'shiftKey', alt: 'altKey', ctrl: 'ctrlKey', meta: 'metaKey' };

class DragTrigger extends EventEmitter {
  constructor({ modifier = 'shift' } = {}) {
    super();
    this.modifier = modifier;
    this.hook = null;
    this.running = false;
    this.reset();
  }

  reset() {
    this.down = false;
    this.origin = null;
    this.moved = false;
    this.fired = false;
    this.modHeld = false;
  }

  setModifier(m) {
    if (MOD_KEYS[m]) this.modifier = m;
  }

  /** @returns {boolean} whether the native hook could be started */
  start() {
    if (this.running) return true;
    try {
      const { uIOhook } = require('uiohook-napi');
      this.hook = uIOhook;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
    this.hook.on('mousedown', (e) => this.onDown(e));
    this.hook.on('mouseup', (e) => this.onUp(e));
    this.hook.on('mousemove', (e) => this.onMove(e));
    this.hook.on('keydown', (e) => this.onKey(e, true));
    this.hook.on('keyup', (e) => this.onKey(e, false));
    try {
      this.hook.start();
      this.running = true;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
    return true;
  }

  stop() {
    if (!this.running) return;
    try {
      this.hook.stop();
    } catch {
      // Already stopped.
    }
    this.hook.removeAllListeners();
    this.running = false;
    this.reset();
  }

  isMod(e) {
    return Boolean(e[MOD_FLAGS[this.modifier]]);
  }

  onDown(e) {
    if (e.button !== 1) return;
    this.down = true;
    this.origin = { x: e.x, y: e.y };
    this.moved = false;
    this.fired = false;
  }

  onUp(e) {
    if (e.button !== 1 || !this.down) return;
    const fired = this.fired;
    this.down = false;
    this.moved = false;
    this.fired = false;
    this.emit('release', { fired });
  }

  onMove(e) {
    this.emit('move', e);
    if (!this.down || this.fired) return;
    if (!this.moved && Math.hypot(e.x - this.origin.x, e.y - this.origin.y) >= DRAG_THRESHOLD) this.moved = true;
    if (this.moved && (this.isMod(e) || this.modHeld)) this.fire();
  }

  onKey(e, pressed) {
    if (!MOD_KEYS[this.modifier].includes(e.keycode)) return;
    const wasHeld = this.modHeld;
    this.modHeld = pressed;
    if (!pressed) return;
    if (this.down && this.moved && !this.fired) this.fire();
    else if (this.fired && !wasHeld) this.emit('tap');
  }

  fire() {
    this.fired = true;
    this.emit('trigger');
  }
}

module.exports = { DragTrigger };
