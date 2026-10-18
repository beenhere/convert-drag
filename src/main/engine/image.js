'use strict';

const fs = require('node:fs/promises');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const ffmpeg = require('./ffmpeg');
const { outputFor } = require('./naming');
const { formatOfPath } = require('../catalog');
const markupSvg = require('../../renderer/shared/markup-svg');

sharp.cache(false);

// Formats sharp can write directly. Everything else has a hand-written
// encoder below (bmp, ico) or goes through pdf-lib (pdf).
const SHARP_OUT = new Set(['jpg', 'png', 'webp', 'avif', 'tiff', 'gif']);
// Formats libvips can't read in the prebuilt sharp binaries.
const FFMPEG_IN = new Set(['bmp', 'ico']);
const ANIMATED = new Set(['gif', 'webp']);

/** Format to write when an edit keeps "the same" format. */
function editableFormat(src) {
  const f = formatOfPath(src);
  if (f === 'heic') return 'jpg';
  if (f === 'svg') return 'png';
  return f || 'png';
}

/**
 * Open any supported image as an auto-oriented sharp pipeline.
 * @param {string} file
 * @param {{animated?: boolean}} [opts]
 */
async function load(file, { animated = false } = {}) {
  const fmt = formatOfPath(file);
  if (fmt === 'heic') {
    const decode = require('heic-decode');
    const { width, height, data } = await decode({ buffer: await fs.readFile(file) });
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
  }
  if (FFMPEG_IN.has(fmt)) {
    const { stdout } = await ffmpeg.run(['-i', file, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
    return sharp(stdout);
  }
  const opts = { failOn: 'none', limitInputPixels: false };
  if (fmt === 'svg') opts.density = 144;
  if (animated && ANIMATED.has(fmt)) opts.animated = true;
  return sharp(file, opts).autoOrient();
}

/** Pixel size after auto-orientation. */
async function dimensions(file) {
  const fmt = formatOfPath(file);
  if (fmt === 'heic' || FFMPEG_IN.has(fmt)) {
    const meta = await (await load(file)).metadata();
    return { width: meta.width, height: meta.height };
  }
  const meta = await sharp(file, { failOn: 'none', density: fmt === 'svg' ? 144 : undefined }).metadata();
  const swap = meta.orientation >= 5;
  return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
}

// --- Encoders sharp doesn't have --------------------------------------------

/** 24-bit uncompressed BMP from RGB(A) pixels, flattened onto white. */
async function encodeBmp(img) {
  const { data, info } = await img.flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3;
      const d = dst + x * 3;
      buf[d] = data[s + 2];
      buf[d + 1] = data[s + 1];
      buf[d + 2] = data[s];
    }
  }
  return buf;
}

/** Multi-size ICO with PNG-compressed entries (Vista+ format). */
async function encodeIco(img) {
  const base = await img.png().toBuffer();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(
    sizes.map((s) =>
      sharp(base)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

async function encodePdf(images) {
  const doc = await PDFDocument.create();
  for (const img of images) {
    const meta = await img.metadata();
    const opaque = !meta.hasAlpha;
    const bytes = opaque ? await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer() : await img.png().toBuffer();
    const embedded = opaque ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    // 96 dpi keeps screenshots at their on-screen size.
    const w = embedded.width * 0.75;
    const h = embedded.height * 0.75;
    const page = doc.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}

/**
 * Encode a pipeline to a format.
 * @param {import('sharp').Sharp} img
 * @param {string} fmt
 * @param {{quality?: number, compress?: boolean, keepMetadata?: boolean}} [opts]
 */
async function encode(img, fmt, { quality, compress = false, keepMetadata = false } = {}) {
  if (keepMetadata && SHARP_OUT.has(fmt)) img = img.keepMetadata();
  switch (fmt) {
    case 'jpg':
      return img
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: quality ?? (compress ? 72 : 90), mozjpeg: true })
        .toBuffer();
    case 'png':
      return compress
        ? img.png({ palette: true, quality: quality ?? 80, effort: 8, compressionLevel: 9 }).toBuffer()
        : img.png({ compressionLevel: 7 }).toBuffer();
    case 'webp':
      return img.webp({ quality: quality ?? (compress ? 70 : 88), effort: 5 }).toBuffer();
    case 'avif':
      return img.avif({ quality: quality ?? (compress ? 45 : 62), effort: 4 }).toBuffer();
    case 'tiff':
      return img.tiff({ compression: compress ? 'jpeg' : 'lzw', quality: quality ?? 80 }).toBuffer();
    case 'gif':
      return img.gif(compress ? { colours: 96, effort: 10, dither: 0.8 } : { effort: 7 }).toBuffer();
    case 'bmp':
      return encodeBmp(img);
    case 'ico':
      return encodeIco(img);
    case 'pdf':
      return encodePdf([img]);
    default:
      throw new Error(`Can't write ${fmt.toUpperCase()} images`);
  }
}

async function save(img, fmt, src, ctx, suffix = '', opts = {}) {
  const buf = await encode(img, fmt, opts);
  const out = outputFor(src, { ext: fmt, suffix, outDir: ctx.outDir });
  await fs.writeFile(out, buf);
  return out;
}

// --- Actions ----------------------------------------------------------------

async function convert(src, target, ctx) {
  const animated = ANIMATED.has(target);
  const img = await load(src, { animated });
  return save(img, target, src, ctx, '', { keepMetadata: true, quality: target === 'jpg' ? ctx.settings?.jpegQuality : undefined });
}

async function compress(src, ctx) {
  const fmt = formatOfPath(src);
  // Formats with weak or no compression get re-encoded to something smaller.
  let target = fmt;
  if (!['jpg', 'png', 'webp', 'avif', 'gif'].includes(fmt)) {
    const meta = await (await load(src)).metadata();
    target = meta.hasAlpha ? 'webp' : 'jpg';
  }
  const img = await load(src, { animated: ANIMATED.has(fmt) });
  return save(img, target, src, ctx, ' Compressed', { compress: true });
}

async function stripMetadata(src, ctx) {
  const fmt = editableFormat(src);
  // sharp drops EXIF/XMP/IPTC unless asked to keep it; orientation is baked in.
  const img = await load(src, { animated: ANIMATED.has(fmt) });
  return save(img, fmt, src, ctx, ' No Metadata', { quality: fmt === 'jpg' ? 95 : undefined });
}

async function rotate(src, ctx, degrees = 90) {
  const fmt = editableFormat(src);
  const img = (await load(src)).rotate(degrees);
  return save(img, fmt, src, ctx, ' Rotated', { keepMetadata: true, quality: fmt === 'jpg' ? 95 : undefined });
}

/** @param {{x: number, y: number, width: number, height: number}} p in oriented pixels */
async function crop(src, p, ctx) {
  const { width, height } = await dimensions(src);
  const left = clampInt(p.x, 0, width - 1);
  const top = clampInt(p.y, 0, height - 1);
  const w = clampInt(p.width, 1, width - left);
  const h = clampInt(p.height, 1, height - top);
  const fmt = editableFormat(src);
  // Materialise orientation first so extract() uses display coordinates.
  const oriented = await (await load(src)).png().toBuffer();
  const img = sharp(oriented).extract({ left, top, width: w, height: h });
  return save(img, fmt, src, ctx, ' Cropped', { quality: fmt === 'jpg' ? 95 : undefined });
}

/**
 * Brightness/contrast/saturation use the same maths as CSS filters, so the
 * editor preview (which uses CSS) matches the saved file.
 * @param {{brightness?: number, contrast?: number, saturation?: number, rotate?: number,
 *   flipH?: boolean, flipV?: boolean, grayscale?: boolean, width?: number, height?: number, format?: string}} p
 */
async function adjust(src, p, ctx) {
  let buf = await (await load(src)).png().toBuffer();
  let img = sharp(buf);
  if (p.rotate) img = img.rotate(((Math.round(p.rotate / 90) * 90) % 360 + 360) % 360);
  if (p.flipV) img = img.flip();
  if (p.flipH) img = img.flop();
  if (p.width && p.height) img = img.resize(Math.round(p.width), Math.round(p.height), { fit: 'fill' });
  buf = await img.png().toBuffer();

  const b = 1 + (p.brightness || 0) / 100;
  const c = 1 + (p.contrast || 0) / 100;
  const s = p.grayscale ? 0 : 1 + (p.saturation || 0) / 100;
  if (b !== 1 || c !== 1) {
    // CSS: brightness(b) then contrast(c) => out = in*b*c + 128*(1-c)
    buf = await sharp(buf).linear([b * c, b * c, b * c], [128 * (1 - c), 128 * (1 - c), 128 * (1 - c)]).png().toBuffer();
  }
  if (s !== 1) {
    buf = await sharp(buf)
      .recomb([
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
      ])
      .png()
      .toBuffer();
  }
  const fmt = p.format || editableFormat(src);
  return save(sharp(buf), fmt, src, ctx, ' Edited', { quality: fmt === 'jpg' ? 95 : undefined });
}

const RATIOS = { '1:1': 1, '16:9': 16 / 9, '4:3': 4 / 3, '4:5': 4 / 5, '9:16': 9 / 16, '3:2': 3 / 2 };

/** Canvas layout for "Add background"; shared with the editor preview. */
function backgroundLayout(width, height, p) {
  const pad = Math.max(0, Math.round(p.padding || 0));
  let cw = width + pad * 2;
  let ch = height + pad * 2;
  const r = RATIOS[p.ratio];
  if (r) {
    if (cw / ch > r) ch = Math.round(cw / r);
    else cw = Math.round(ch * r);
  }
  return { canvasWidth: cw, canvasHeight: ch, left: Math.round((cw - width) / 2), top: Math.round((ch - height) / 2) };
}

function backgroundSvg(w, h, bg) {
  if (!bg || bg.type === 'transparent') return null;
  if (bg.type === 'solid') return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${esc(bg.color)}"/></svg>`;
  const angle = ((bg.angle ?? 135) - 90) * (Math.PI / 180);
  // Match CSS linear-gradient(angle): the gradient line spans the box diagonal projection.
  const len = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
  const cx = w / 2;
  const cy = h / 2;
  const dx = (Math.cos(angle) * len) / 2;
  const dy = (Math.sin(angle) * len) / 2;
  const stops = (bg.stops || ['#ff9a5a', '#ff5f6d']).map((c, i, a) => `<stop offset="${a.length === 1 ? 0 : i / (a.length - 1)}" stop-color="${esc(c)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

/**
 * Screenshot-style background: padding, rounded corners, drop shadow, ratio.
 * @param {{background: object, padding: number, radius: number, shadow: number, ratio: string}} p
 */
async function background(src, p, ctx) {
  const imgBuf = await (await load(src)).png().toBuffer();
  const { width, height } = await sharp(imgBuf).metadata();
  const { canvasWidth: cw, canvasHeight: ch, left, top } = backgroundLayout(width, height, p);
  const radius = Math.max(0, Math.min(Math.round(p.radius || 0), Math.floor(Math.min(width, height) / 2)));

  let rounded = imgBuf;
  if (radius > 0) {
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`);
    rounded = await sharp(imgBuf).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }

  const layers = [];
  const bgSvg = backgroundSvg(cw, ch, p.background);
  const shadow = Math.max(0, Math.round(p.shadow || 0));
  if (shadow > 0) {
    // CSS box-shadow: 0 shadow/3 shadow rgba(0,0,0,.35) => gaussian sigma = shadow/2.
    const rect = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect x="${left}" y="${top + Math.round(shadow / 3)}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0.35)"/></svg>`);
    const blurred = await sharp(rect).blur(Math.max(0.3, shadow / 2)).png().toBuffer();
    layers.push({ input: blurred, left: 0, top: 0 });
  }
  layers.push({ input: rounded, left, top });

  const base = bgSvg
    ? sharp(Buffer.from(bgSvg))
    : sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const out = await base.composite(layers).png().toBuffer();
  const file = outputFor(src, { ext: 'png', suffix: ' with Background', outDir: ctx.outDir });
  await fs.writeFile(file, out);
  return file;
}

/**
 * Annotate / redact. Redactions are applied to pixels first, then vector
 * shapes are drawn with the same SVG the editor previews.
 * @param {{shapes: object[]}} p shapes in oriented image pixels
 */
async function markup(src, p, ctx, suffix = ' Annotated') {
  let buf = await (await load(src)).png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  const shapes = Array.isArray(p.shapes) ? p.shapes : [];

  const pixelOps = [];
  for (const s of shapes) {
    if (s.type !== 'redact' || s.style === 'solid') continue;
    const r = normRect(s, width, height);
    if (!r) continue;
    let region = sharp(buf).extract(r);
    if (s.style === 'blur') {
      region = region.blur(Math.max(8, Math.min(r.width, r.height) / 6));
    } else {
      const block = Math.max(6, Math.round(Math.max(r.width, r.height) / 24));
      const small = await region
        .resize(Math.max(1, Math.round(r.width / block)), Math.max(1, Math.round(r.height / block)), { kernel: 'nearest' })
        .png()
        .toBuffer();
      region = sharp(small).resize(r.width, r.height, { kernel: 'nearest' });
    }
    pixelOps.push({ input: await region.png().toBuffer(), left: r.left, top: r.top });
  }
  if (pixelOps.length) buf = await sharp(buf).composite(pixelOps).png().toBuffer();

  const svg = markupSvg.toSvg(shapes, width, height);
  const fmt = editableFormat(src);
  const img = sharp(buf).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]);
  return save(img, fmt, src, ctx, suffix, { quality: fmt === 'jpg' ? 95 : undefined });
}

/** Many images (or one) into a single PDF, one page each. */
async function imagesToPdfBuffer(files) {
  const images = [];
  for (const f of files) images.push(await load(f));
  return encodePdf(images);
}

/** Downscaled, browser-displayable copy used by the editors. */
async function preview(src, dest, maxSize = 2400) {
  const full = await (await load(src)).png().toBuffer();
  const { hasAlpha } = await sharp(full).metadata();
  const img = sharp(full).resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true });
  const buf = hasAlpha ? await img.png().toBuffer() : await img.jpeg({ quality: 88 }).toBuffer();
  const file = `${dest}.${hasAlpha ? 'png' : 'jpg'}`;
  await fs.writeFile(file, buf);
  const pm = await sharp(buf).metadata();
  return { file, width: pm.width, height: pm.height };
}

// --- helpers ----------------------------------------------------------------

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
}

function normRect(s, width, height) {
  const x1 = clampInt(Math.min(s.x, s.x + s.w), 0, width);
  const y1 = clampInt(Math.min(s.y, s.y + s.h), 0, height);
  const x2 = clampInt(Math.max(s.x, s.x + s.w), 0, width);
  const y2 = clampInt(Math.max(s.y, s.y + s.h), 0, height);
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
}

function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

module.exports = {
  load,
  dimensions,
  encode,
  convert,
  compress,
  stripMetadata,
  rotate,
  crop,
  adjust,
  background,
  backgroundLayout,
  markup,
  imagesToPdfBuffer,
  preview,
  editableFormat,
};
