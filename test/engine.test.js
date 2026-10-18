'use strict';

// End-to-end checks of the converters on generated sample files. Work that
// needs Chromium (PDF rendering, HTML printing) is covered by test/electron.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const engine = require('../src/main/engine');
const ffmpeg = require('../src/main/engine/ffmpeg');
const { tmpDir } = require('./helpers');

const dir = tmpDir('engine');
const ctx = { outDir: null, settings: {} };
const f = (name) => path.join(dir, name);

async function run(actionId, files, params) {
  const res = await engine.run({ actionId, files: [].concat(files), params }, ctx);
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  return res.outputs;
}

test.before(async () => {
  // A 300x200 gradient with a transparent corner.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#5b5bff"/></linearGradient></defs><rect width="300" height="200" fill="url(#g)"/><circle cx="150" cy="100" r="40" fill="#fff"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(f('Sample.png'));
  // JPEG that is stored landscape but displayed portrait (EXIF orientation 6).
  await sharp(Buffer.from(svg)).jpeg().withMetadata({ orientation: 6 }).toFile(f('Rotated.jpg'));
  fs.writeFileSync(f('Logo.svg'), svg);

  await ffmpeg.run(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', f('Clip.mp4')]);
  await ffmpeg.run(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', f('Silent.mp4')]);
  await ffmpeg.run(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:a', 'pcm_s16le', '-y', f('Tone.wav')]);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#3a7' } }).jpeg({ quality: 100 }).toBuffer());
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i} heading`, { x: 50, y: 780, size: 24, font });
    page.drawText('Body text line one.', { x: 50, y: 740, size: 12, font });
    page.drawImage(jpg, { x: 50, y: 300, width: 400, height: 300 });
  }
  doc.setAuthor('Someone');
  fs.writeFileSync(f('Report.pdf'), await doc.save());

  fs.writeFileSync(f('Notes.md'), '# Title\n\nSome **bold** and *italic* text with `code` and a [link](https://example.com).\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n```\ncode block\n```\n');
  fs.writeFileSync(f('Plain.txt'), 'Line one\nLine two\n\nSecond paragraph.\n');
  fs.writeFileSync(f('People.csv'), 'name,age,city\nAda,36,London\n"Grace, Admiral",85,"New York"\n');
  fs.writeFileSync(f('Items.json'), JSON.stringify([{ id: 1, tags: ['a', 'b'] }, { id: 2, name: 'two' }]));
});

test('image converts to every target', async () => {
  for (const target of ['jpg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'ico', 'pdf']) {
    const [out] = await run(`to:${target}`, f('Sample.png'));
    assert.equal(path.extname(out), `.${target}`);
    assert.ok(fs.statSync(out).size > 100, target);
  }
  // BMP and ICO round-trip back through the ffmpeg reader.
  const [png] = await run('to:png', f('Sample.bmp'));
  assert.deepEqual(await sharp(png).metadata().then((m) => [m.width, m.height]), [300, 200]);
  const [fromIco] = await run('to:png', f('Sample.ico'));
  assert.equal((await sharp(fromIco).metadata()).width, 256);
});

test('EXIF orientation is applied', async () => {
  const [out] = await run('to:png', f('Rotated.jpg'));
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height], [200, 300]);
});

test('SVG renders to PNG', async () => {
  const [out] = await run('to:png', f('Logo.svg'));
  assert.equal((await sharp(out).metadata()).format, 'png');
});

test('outputs never overwrite existing files', async () => {
  const [a] = await run('to:jpg', f('Sample.png'));
  const [b] = await run('to:jpg', f('Sample.png'));
  assert.notEqual(a, b);
  assert.match(path.basename(b), /^Sample \(\d+\)\.jpg$/);
});

test('image tools', async () => {
  const [crop] = await run('tool:crop', f('Rotated.jpg'), { x: 10, y: 20, width: 100, height: 150 });
  assert.deepEqual(await sharp(crop).metadata().then((m) => [m.width, m.height]), [100, 150]);
  assert.match(crop, /Rotated Cropped\.jpg$/);

  const [rot] = await run('tool:rotate', f('Sample.png'));
  assert.deepEqual(await sharp(rot).metadata().then((m) => [m.width, m.height]), [200, 300]);

  const [comp] = await run('tool:compress', f('Sample.png'));
  assert.ok(fs.statSync(comp).size < fs.statSync(f('Sample.png')).size);

  const [meta] = await run('tool:metadata', f('Rotated.jpg'));
  const m = await sharp(meta).metadata();
  assert.equal(m.exif, undefined);
  assert.deepEqual([m.width, m.height], [200, 300]);

  const [bg] = await run('tool:background', f('Sample.png'), {
    background: { type: 'gradient', stops: ['#ff9a5a', '#ff5f6d'], angle: 135 },
    padding: 40,
    radius: 24,
    shadow: 20,
    ratio: '1:1',
  });
  const bm = await sharp(bg).metadata();
  assert.deepEqual([bm.width, bm.height], [380, 380]);

  const [edit] = await run('tool:edit', f('Sample.png'), { brightness: 20, contrast: 10, saturation: -50, rotate: 90, flipH: true, width: 100, height: 150 });
  assert.deepEqual(await sharp(edit).metadata().then((x) => [x.width, x.height]), [100, 150]);

  const shapes = [
    { type: 'rect', x: 10, y: 10, w: 80, h: 50, color: '#ff3b30', size: 4 },
    { type: 'arrow', x1: 200, y1: 150, x2: 260, y2: 40, color: '#ff3b30', size: 4 },
    { type: 'text', x: 20, y: 120, text: 'Hello', color: '#007aff', size: 4 },
    { type: 'pen', points: [[0, 0], [30, 40], [60, 20]], color: '#34c759', size: 3 },
  ];
  const [ann] = await run('tool:annotate', f('Sample.png'), { shapes });
  assert.match(ann, /Annotated\.png$/);

  const [red] = await run('tool:redact', f('Sample.png'), {
    shapes: [
      { type: 'redact', style: 'solid', x: 0, y: 0, w: 50, h: 50 },
      { type: 'redact', style: 'pixelate', x: 100, y: 50, w: 100, h: 100 },
      { type: 'redact', style: 'blur', x: 220, y: 20, w: -60, h: 60 },
    ],
  });
  const { data, info } = await sharp(red).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  assert.deepEqual(px(10, 10), [0, 0, 0]);
});

test('images merge into one PDF', async () => {
  const [out] = await run('tool:merge-pdf', [f('Sample.png'), f('Rotated.jpg')]);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.equal(doc.getPageCount(), 2);
});

test('video conversions and tools', async () => {
  for (const target of ['mov', 'webm', 'mkv', 'avi', 'gif', 'mp3', 'wav']) {
    const [out] = await run(`to:${target}`, f('Clip.mp4'));
    assert.equal(path.extname(out), `.${target}`);
    const info = await ffmpeg.probe(out);
    assert.ok(info.duration > 1.5, `${target} duration ${info.duration}`);
  }
  const [trimmed] = await run('tool:trim', f('Clip.mp4'), { start: 0.5, end: 1.5 });
  const ti = await ffmpeg.probe(trimmed);
  assert.ok(Math.abs(ti.duration - 1) < 0.2, `trim ${ti.duration}`);

  const [muted] = await run('tool:mute', f('Clip.mp4'));
  assert.equal((await ffmpeg.probe(muted)).hasAudio, false);

  const [frame] = await run('tool:snapshot', f('Clip.mp4'));
  assert.equal((await sharp(frame).metadata()).width, 320);

  const [rot] = await run('tool:rotate', f('Clip.mp4'));
  const ri = await ffmpeg.probe(rot);
  assert.deepEqual([ri.width, ri.height], [240, 320]);

  for (const tool of ['compress', 'resize', 'metadata']) {
    const [out] = await run(`tool:${tool}`, f('Clip.mp4'));
    assert.ok((await ffmpeg.probe(out)).hasVideo, tool);
  }

  // Merging a clip without audio still works (silence is inserted).
  const [merged] = await run('tool:merge', [f('Clip.mp4'), f('Silent.mp4')]);
  const mi = await ffmpeg.probe(merged);
  assert.ok(mi.duration > 2.7, `merged ${mi.duration}`);
  assert.deepEqual([mi.width, mi.height], [320, 240]);
});

test('audio conversions and tools', async () => {
  for (const target of ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'aiff', 'aac']) {
    const [out] = await run(`to:${target}`, f('Tone.wav'));
    const info = await ffmpeg.probe(out);
    assert.ok(info.hasAudio && info.duration > 1.5, target);
  }
  const [trimmed] = await run('tool:trim', f('Tone.wav'), { start: 0.25, end: 1.25 });
  assert.ok(Math.abs((await ffmpeg.probe(trimmed)).duration - 1) < 0.1);
  const [norm] = await run('tool:normalize', f('Tone.wav'));
  assert.match(norm, /Normalized\.wav$/);
  const [comp] = await run('tool:compress', f('Tone.wav'));
  assert.match(comp, /Compressed\.mp3$/);
  const [merged] = await run('tool:merge', [f('Tone.wav'), f('Tone.wav')]);
  assert.ok((await ffmpeg.probe(merged)).duration > 3.8);
});

test('PDF tools', async () => {
  const src = f('Report.pdf');
  const [comp] = await run('tool:compress', src);
  assert.ok(fs.statSync(comp).size < fs.statSync(src).size * 0.8, `${fs.statSync(comp).size} vs ${fs.statSync(src).size}`);
  assert.equal((await PDFDocument.load(fs.readFileSync(comp))).getPageCount(), 2);

  const [split] = await run('tool:split', src);
  assert.equal(fs.readdirSync(split).filter((n) => n.endsWith('.pdf')).length, 2);

  const [rot] = await run('tool:rotate', src);
  assert.equal((await PDFDocument.load(fs.readFileSync(rot))).getPage(0).getRotation().angle, 90);

  const [clean] = await run('tool:metadata', src);
  assert.equal((await PDFDocument.load(fs.readFileSync(clean))).getAuthor(), undefined);

  const [merged] = await run('tool:merge', [src, src]);
  assert.equal((await PDFDocument.load(fs.readFileSync(merged))).getPageCount(), 4);
});

test('PDF text lines become structured HTML', () => {
  const { linesToHtml, linesToText } = engine.pdf;
  const pages = [{ lines: [{ text: 'Big Title', size: 24, y: 800 }, { text: 'First line of a para-', size: 12, y: 760 }, { text: 'graph continues.', size: 12, y: 746 }, { text: 'New paragraph.', size: 12, y: 700 }] }];
  const html = linesToHtml(pages);
  assert.match(html, /<h1>Big Title<\/h1>/);
  assert.match(html, /<p>First line of a paragraph continues\.<\/p>/);
  assert.match(html, /<p>New paragraph\.<\/p>/);
  assert.match(linesToText(pages), /Big Title\n+First line of a para-\ngraph continues\.\n\nNew paragraph/);
});

test('documents convert between formats', async () => {
  const mammoth = require('mammoth');
  const [docx] = await run('to:docx', f('Notes.md'));
  const html = (await mammoth.convertToHtml({ path: docx })).value;
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a>/);
  assert.match(html, /<table>/);
  assert.match(html, /<li>one<\/li>/);

  const [md] = await run('to:md', docx);
  const mdText = fs.readFileSync(md, 'utf8');
  assert.match(mdText, /^# Title/m);
  assert.match(mdText, /\*\*bold\*\*/);

  const [txt] = await run('to:txt', f('Notes.md'));
  assert.match(fs.readFileSync(txt, 'utf8'), /Some bold and italic text/);

  const [htmlOut] = await run('to:html', f('Plain.txt'));
  assert.match(fs.readFileSync(htmlOut, 'utf8'), /<p>Line one<br>Line two<\/p>/);

  const [txtDocx] = await run('to:docx', f('Plain.txt'));
  assert.match((await mammoth.extractRawText({ path: txtDocx })).value, /Second paragraph/);

  const [txtFromDocx] = await run('to:txt', docx);
  assert.match(fs.readFileSync(txtFromDocx, 'utf8'), /Title/);
});

test('data converts between formats', async () => {
  const [json] = await run('to:json', f('People.csv'));
  const rows = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.deepEqual(rows[1], { name: 'Grace, Admiral', age: 85, city: 'New York' });

  const [xlsx] = await run('to:xlsx', f('People.csv'));
  const [back] = await run('to:csv', xlsx);
  assert.equal(fs.readFileSync(back, 'utf8').trim().split('\n')[2], '"Grace, Admiral",85,New York');

  const [csv] = await run('to:csv', f('Items.json'));
  assert.equal(fs.readFileSync(csv, 'utf8').split('\n')[0], 'id,tags,name');

  const [md] = await run('to:md', f('People.csv'));
  assert.match(fs.readFileSync(md, 'utf8'), /\| Ada \| 36 \| London \|/);
});

test('zip collects files', async () => {
  const JSZip = require('jszip');
  const [out] = await run('tool:zip', [f('Sample.png'), f('Plain.txt')]);
  const z = await JSZip.loadAsync(fs.readFileSync(out));
  assert.deepEqual(Object.keys(z.files).sort(), ['Plain.txt', 'Sample.png']);
});

test('errors are reported per file', async () => {
  fs.writeFileSync(f('Broken.png'), 'not an image');
  const res = await engine.run({ actionId: 'to:jpg', files: [f('Broken.png'), f('Sample.png')] }, ctx);
  assert.equal(res.outputs.length, 1);
  assert.equal(res.errors.length, 1);
});
