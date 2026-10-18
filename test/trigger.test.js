'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DragTrigger } = require('../src/main/trigger');

const SHIFT = 42;
const ev = (x, y, extra = {}) => ({ x, y, button: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });

function setup(modifier = 'shift') {
  const t = new DragTrigger({ modifier });
  const fired = [];
  t.on('trigger', () => fired.push('trigger'));
  t.on('tap', () => fired.push('tap'));
  t.on('release', (r) => fired.push(`release:${r.fired}`));
  return { t, fired };
}

test('fires when dragging with Shift held', () => {
  const { t, fired } = setup();
  t.onDown(ev(100, 100));
  t.onMove(ev(103, 100, { shiftKey: true }));
  assert.deepEqual(fired, [], 'below the drag threshold');
  t.onMove(ev(120, 100, { shiftKey: true }));
  t.onMove(ev(140, 100, { shiftKey: true }));
  assert.deepEqual(fired, ['trigger'], 'fires once per drag');
  t.onUp(ev(140, 100));
  assert.deepEqual(fired, ['trigger', 'release:true']);
});

test('fires when Shift is pressed after the drag started', () => {
  const { t, fired } = setup();
  t.onDown(ev(0, 0));
  t.onMove(ev(30, 30));
  assert.deepEqual(fired, []);
  t.onKey({ keycode: SHIFT }, true);
  assert.deepEqual(fired, ['trigger']);
  // Auto-repeat keydowns don't count as taps; a release + press does.
  t.onKey({ keycode: SHIFT }, true);
  t.onKey({ keycode: SHIFT }, false);
  t.onKey({ keycode: SHIFT }, true);
  assert.deepEqual(fired, ['trigger', 'tap']);
});

test('does nothing without the modifier, or for other buttons', () => {
  const { t, fired } = setup();
  t.onDown(ev(0, 0));
  t.onMove(ev(50, 50));
  t.onUp(ev(50, 50));
  t.onDown(ev(0, 0, { button: 2 }));
  t.onMove(ev(50, 50, { shiftKey: true }));
  assert.deepEqual(fired, ['release:false']);
});

test('Shift held before pressing the mouse also works', () => {
  const { t, fired } = setup();
  t.onKey({ keycode: SHIFT }, true);
  t.onDown(ev(0, 0));
  t.onMove(ev(20, 0));
  assert.deepEqual(fired, ['trigger']);
});

test('honours the configured modifier', () => {
  const { t, fired } = setup('alt');
  t.onDown(ev(0, 0));
  t.onMove(ev(20, 0, { shiftKey: true }));
  assert.deepEqual(fired, []);
  t.onMove(ev(30, 0, { altKey: true }));
  assert.deepEqual(fired, ['trigger']);
  t.setModifier('nonsense');
  assert.equal(t.modifier, 'alt');
});
