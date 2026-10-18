'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/main/catalog');

test('formats are detected from paths and MIME types', () => {
  assert.equal(catalog.formatOfPath('/a/Photo.JPEG'), 'jpg');
  assert.equal(catalog.formatOfPath('C:\\x\\clip.MOV'), 'mov');
  assert.equal(catalog.formatOfPath('notes.markdown'), 'md');
  assert.equal(catalog.formatOfPath('archive.rar'), null);
  assert.equal(catalog.formatOfMime('image/heic'), 'heic');
  assert.equal(catalog.formatOfMime('application/vnd.ms-excel'), 'csv');
  assert.equal(catalog.formatOfMime('text/plain; charset=utf-8'), 'txt');
  assert.equal(catalog.formatOfMime(''), null);
});

test('a single image gets convert and tools pages without its own format', () => {
  const menu = catalog.menuForPaths(['/x/Page 001.jpg']);
  assert.equal(menu.kind, 'image');
  assert.deepEqual(menu.pages.map((p) => p.name), ['Convert', 'Tools']);
  const ids = menu.pages[0].items.map((i) => i.id);
  assert.ok(!ids.includes('to:jpg'));
  assert.ok(ids.includes('to:png'));
  for (const p of menu.pages) assert.ok(p.items.length <= catalog.MAX_WEDGES);
  assert.ok(menu.pages[1].items.some((i) => i.id === 'tool:crop' && i.editor === 'crop'));
});

test('multiple files get merge tools and no editors', () => {
  const menu = catalog.menuForPaths(['a.png', 'b.jpg']);
  const tools = menu.pages.find((p) => p.name === 'Tools').items.map((i) => i.id);
  assert.ok(tools.includes('tool:merge-pdf'));
  assert.ok(!tools.includes('tool:crop'));
  // Mixed formats keep every target.
  assert.ok(menu.pages[0].items.some((i) => i.id === 'to:jpg'));
});

test('mixed kinds offer merge to PDF only when all are PDF-able', () => {
  assert.deepEqual(catalog.menuForPaths(['a.png', 'b.pdf']).pages[0].items.map((i) => i.id), ['tool:merge-pdf', 'tool:zip']);
  assert.deepEqual(catalog.menuForPaths(['a.png', 'b.mp4']).pages[0].items.map((i) => i.id), ['tool:zip']);
});

test('unknown MIME types produce the placeholder menu', () => {
  const menu = catalog.menuForMimes(['']);
  assert.equal(menu.kind, 'unknown');
});

test('actions parse', () => {
  assert.deepEqual(catalog.parseAction('to:png'), { type: 'convert', target: 'png' });
  assert.deepEqual(catalog.parseAction('tool:crop'), { type: 'tool', tool: 'crop', editor: 'crop' });
  assert.equal(catalog.parseAction('tool:nope'), null);
});

test('conversion count matches the catalog', () => {
  const { conversions, tools, formats } = catalog.countConversions();
  assert.equal(formats, Object.keys(catalog.FORMATS).length);
  assert.equal(tools, Object.keys(catalog.TOOLS).length);
  assert.ok(conversions > 200);
});
