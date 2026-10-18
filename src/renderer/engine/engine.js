// Hidden page that does canvas work for the main process: rendering PDF pages
// and reading their text with pdf.js.

import * as pdfjs from '../vendor/pdfjs/legacy/build/pdf.mjs';

const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}legacy/build/pdf.worker.mjs`;

function open(data) {
  // Callers destroy the loading task, which also tears down the document.
  return pdfjs.getDocument({
    data,
    cMapUrl: `${PDFJS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}standard_fonts/`,
    wasmUrl: `${PDFJS}wasm/`,
    iccUrl: `${PDFJS}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  });
}

const MAX_PIXELS = 40_000_000;

async function render({ data, scale = 2 }, progress) {
  const task = open(data);
  const doc = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      let viewport = page.getViewport({ scale });
      const area = viewport.width * viewport.height;
      if (area > MAX_PIXELS) viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / area) });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport, background: '#ffffff' }).promise;
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      pages.push(new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
      progress(i / doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

/** Text grouped into visual lines, top to bottom, with an approximate font size. */
async function text({ data }) {
  const task = open(data);
  const doc = await task.promise;
  const out = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = [];
      let current = null;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const [, b, c, d, , f] = item.transform;
        const size = Math.hypot(c, d) || Math.hypot(item.transform[0], b) || 0;
        const y = f;
        if (current && Math.abs(current.y - y) > Math.max(2, size * 0.5)) {
          lines.push(current);
          current = null;
        }
        if (!current) current = { text: '', size: 0, y, chars: 0 };
        if (item.str) {
          current.text += item.str;
          // Weighted by length so a big drop cap doesn't make a line a heading.
          current.size = (current.size * current.chars + size * item.str.length) / (current.chars + item.str.length);
          current.chars += item.str.length;
        }
        if (item.hasEOL) {
          lines.push(current);
          current = null;
        }
      }
      if (current) lines.push(current);
      out.push({
        lines: lines
          .map(({ text, size, y }) => ({ text: text.replace(/\s+/g, ' ').trim(), size, y }))
          .filter((l) => l.text),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

const METHODS = { 'pdf.render': render, 'pdf.text': text };

window.engine.onTask(async ({ id, method, args }) => {
  try {
    const fn = METHODS[method];
    if (!fn) throw new Error(`Unknown engine method ${method}`);
    const value = await fn(args, (v) => window.engine.progress(id, v));
    window.engine.result({ id, ok: true, value });
  } catch (e) {
    window.engine.result({ id, ok: false, error: e?.message || String(e) });
  }
});

window.engine.ready();
