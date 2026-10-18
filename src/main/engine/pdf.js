'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const sharp = require('sharp');
const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFBool, degrees } = require('pdf-lib');
const { outputFor, uniquePath, stem } = require('./naming');
const { formatOfPath, kindOf, labelOf } = require('../catalog');
const image = require('./image');
const docs = require('./docs');

async function loadPdf(src, opts = {}) {
  try {
    return await PDFDocument.load(await fs.readFile(src), { updateMetadata: false, ...opts });
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error('This PDF is password-protected');
    throw e;
  }
}

/** Writes one file per page into a folder, or a single file for one page. */
async function writePages(src, ext, buffers, ctx, label) {
  if (buffers.length === 1) {
    const out = outputFor(src, { ext, outDir: ctx.outDir });
    await fs.writeFile(out, buffers[0]);
    return out;
  }
  const dir = uniquePath(ctx.outDir || path.dirname(src), `${stem(src)} ${label}`, '');
  await fs.mkdir(dir, { recursive: true });
  const width = String(buffers.length).length;
  await Promise.all(buffers.map((b, i) => fs.writeFile(path.join(dir, `${stem(src)} ${String(i + 1).padStart(width, '0')}.${ext}`), b)));
  return dir;
}

async function toImages(src, target, ctx) {
  if (!ctx.bridge?.renderPdf) throw new Error('PDF rendering is not available');
  const pages = await ctx.bridge.renderPdf(await fs.readFile(src), { scale: 2, onProgress: ctx.progress });
  const buffers = [];
  for (const png of pages) buffers.push(await image.encode(sharp(Buffer.from(png)), target));
  return writePages(src, target, buffers, ctx, labelOf(target));
}

/**
 * Turn pdf.js text lines into simple HTML. Lines that are noticeably larger
 * than body text become headings; lines close together join into paragraphs.
 * @param {Array<{lines: Array<{text: string, size: number, y: number, bold?: boolean}>}>} pages
 */
function linesToHtml(pages) {
  const sizes = pages.flatMap((p) => p.lines.map((l) => Math.round(l.size)));
  const body = mode(sizes) || 12;
  const html = [];
  pages.forEach((page, pi) => {
    if (pi > 0) html.push('<hr>');
    let para = [];
    let lastY = null;
    const flush = () => {
      if (para.length) html.push(`<p>${para.join(' ').replace(/- (?=[a-z])/g, '')}</p>`);
      para = [];
    };
    for (const line of page.lines) {
      const text = line.text.trim();
      if (!text) {
        flush();
        lastY = null;
        continue;
      }
      const ratio = line.size / body;
      if (ratio > 1.25 && text.length < 160) {
        flush();
        const level = ratio > 1.8 ? 1 : ratio > 1.45 ? 2 : 3;
        html.push(`<h${level}>${docs.escapeHtml(text)}</h${level}>`);
        lastY = null;
        continue;
      }
      if (lastY != null && Math.abs(lastY - line.y) > line.size * 1.9) flush();
      para.push(docs.escapeHtml(text));
      lastY = line.y;
    }
    flush();
  });
  return html.join('\n');
}

/** Plain text; a blank line wherever the vertical gap suggests a new paragraph. */
function linesToText(pages) {
  return (
    pages
      .map((p) => {
        let out = '';
        let lastY = null;
        for (const l of p.lines) {
          if (lastY != null) out += Math.abs(lastY - l.y) > l.size * 1.9 ? '\n\n' : '\n';
          out += l.text;
          lastY = l.y;
        }
        return out;
      })
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

function mode(values) {
  const counts = new Map();
  let best = null;
  for (const v of values) {
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (best == null || c > counts.get(best)) best = v;
  }
  return best;
}

async function toText(src, target, ctx) {
  if (!ctx.bridge?.pdfText) throw new Error('PDF text extraction is not available');
  const pages = await ctx.bridge.pdfText(await fs.readFile(src));
  if (!pages.some((p) => p.lines.some((l) => l.text.trim()))) throw new Error('No text found (scanned PDF?)');
  const out = outputFor(src, { ext: target, outDir: ctx.outDir });
  const html = linesToHtml(pages);
  let data;
  if (target === 'txt') data = linesToText(pages);
  else if (target === 'md') data = docs.htmlToMarkdown(html);
  else if (target === 'html') data = docs.wrapDocument(html, stem(src), null);
  else if (target === 'docx') data = await require('./docx-writer').htmlToDocx(html, { title: stem(src) });
  else throw new Error(`Can't convert PDF to ${target}`);
  await fs.writeFile(out, data);
  return out;
}

async function convert(src, target, ctx) {
  if (['jpg', 'png', 'webp'].includes(target)) return toImages(src, target, ctx);
  return toText(src, target, ctx);
}

function filtersOf(dict) {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => x.toString());
  return [f.toString()];
}

/**
 * Recompress embedded photos (JPEG and 8-bit RGB/gray Flate images) at a
 * lower size, then re-save with object streams. Text and vectors stay intact.
 */
async function compress(src, ctx, { maxSide = 1800, quality = 62 } = {}) {
  const doc = await loadPdf(src);
  const entries = doc.context.enumerateIndirectObjects();
  let i = 0;
  for (const [ref, obj] of entries) {
    i++;
    if (ctx.progress && i % 20 === 0) ctx.progress(i / entries.length);
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    if (dict.get(PDFName.of('ImageMask')) === PDFBool.True || dict.has(PDFName.of('Decode'))) continue;
    const width = dict.get(PDFName.of('Width'))?.asNumber?.();
    const height = dict.get(PDFName.of('Height'))?.asNumber?.();
    if (!width || !height || width * height < 128 * 128) continue;
    const filters = filtersOf(dict);
    const cs = dict.get(PDFName.of('ColorSpace'));
    const csName = cs instanceof PDFName ? cs.toString() : null;
    let input;
    let gray = false;
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        const meta = await sharp(obj.contents).metadata();
        if (meta.channels !== 3 && meta.channels !== 1) continue; // CMYK JPEGs are often stored inverted
        gray = meta.channels === 1;
        input = sharp(obj.contents);
      } else if (filters.length === 1 && filters[0] === '/FlateDecode' && !dict.has(PDFName.of('DecodeParms'))) {
        const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.();
        if (bpc !== 8 || (csName !== '/DeviceRGB' && csName !== '/DeviceGray')) continue;
        const channels = csName === '/DeviceRGB' ? 3 : 1;
        const raw = zlib.inflateSync(obj.contents);
        if (raw.length < width * height * channels) continue;
        gray = channels === 1;
        input = sharp(raw.subarray(0, width * height * channels), { raw: { width, height, channels } });
      } else continue;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const nw = Math.max(1, Math.round(width * scale));
      const nh = Math.max(1, Math.round(height * scale));
      let pipeline = input.resize(nw, nh);
      if (gray) pipeline = pipeline.toColourspace('b-w');
      const jpeg = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      if (jpeg.length >= obj.contents.length * 0.9) continue;
      dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      dict.delete(PDFName.of('DecodeParms'));
      dict.set(PDFName.of('Width'), PDFNumber.of(nw));
      dict.set(PDFName.of('Height'), PDFNumber.of(nh));
      dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      if (!(cs && filters[0] === '/DCTDecode')) dict.set(PDFName.of('ColorSpace'), PDFName.of(gray ? 'DeviceGray' : 'DeviceRGB'));
      doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
    } catch {
      // Leave images we can't decode untouched.
    }
  }
  const out = outputFor(src, { ext: 'pdf', suffix: ' Compressed', outDir: ctx.outDir });
  await fs.writeFile(out, await doc.save({ useObjectStreams: true }));
  return out;
}

async function split(src, ctx) {
  const doc = await loadPdf(src);
  const count = doc.getPageCount();
  if (count < 2) throw new Error('This PDF has only one page');
  const buffers = [];
  for (let i = 0; i < count; i++) {
    const part = await PDFDocument.create();
    const [page] = await part.copyPages(doc, [i]);
    part.addPage(page);
    buffers.push(Buffer.from(await part.save()));
    ctx.progress?.((i + 1) / count);
  }
  return writePages(src, 'pdf', buffers, ctx, 'Pages');
}

async function rotate(src, ctx, by = 90) {
  const doc = await loadPdf(src);
  for (const page of doc.getPages()) page.setRotation(degrees((page.getRotation().angle + by) % 360));
  const out = outputFor(src, { ext: 'pdf', suffix: ' Rotated', outDir: ctx.outDir });
  await fs.writeFile(out, await doc.save());
  return out;
}

async function stripMetadata(src, ctx) {
  const doc = await loadPdf(src);
  const info = doc.context.trailerInfo.Info;
  if (info) doc.context.delete(info);
  doc.context.trailerInfo.Info = undefined;
  doc.catalog.delete(PDFName.of('Metadata'));
  const out = outputFor(src, { ext: 'pdf', suffix: ' No Metadata', outDir: ctx.outDir });
  await fs.writeFile(out, await doc.save({ updateFieldAppearances: false }));
  return out;
}

/** Combine PDFs, images and documents into one PDF, in the order given. */
async function merge(files, ctx) {
  const merged = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const kind = kindOf(formatOfPath(f));
    let part;
    if (kind === 'pdf') part = await loadPdf(f);
    else if (kind === 'image') part = await PDFDocument.load(await image.imagesToPdfBuffer([f]));
    else if (kind === 'doc') part = await PDFDocument.load(await docs.toPdfBuffer(f, ctx));
    else throw new Error(`Can't add ${path.basename(f)} to a PDF`);
    const pages = await merged.copyPages(part, part.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
    ctx.progress?.((i + 1) / files.length);
  }
  const out = outputFor(files[0], { ext: 'pdf', name: 'Merged', outDir: ctx.outDir });
  await fs.writeFile(out, await merged.save());
  return out;
}

async function pageCount(src) {
  return (await loadPdf(src)).getPageCount();
}

module.exports = { convert, compress, split, rotate, stripMetadata, merge, pageCount, linesToHtml, linesToText };
