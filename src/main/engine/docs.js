'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { outputFor, stem } = require('./naming');
const { formatOfPath } = require('../catalog');
const { htmlToDocx } = require('./docx-writer');

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const DOC_CSS = `
  @page { margin: 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; margin: 0; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 .5em; }
  h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
  p, ul, ol, pre, table, blockquote { margin: 0 0 .8em; }
  img { max-width: 100%; height: auto; }
  pre, code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.5pt; }
  pre { background: #f5f5f7; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  :not(pre) > code { background: #f2f2f2; padding: 1px 4px; border-radius: 4px; }
  blockquote { border-left: 3px solid #d2d2d7; padding-left: 12px; color: #515154; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d2d2d7; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f5f5f7; }
  a { color: #0066cc; }
  hr { border: 0; border-top: 1px solid #d2d2d7; }
  .cd-plain { white-space: pre-wrap; word-break: break-word; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 10pt; }
`;

function wrapDocument(bodyHtml, title, baseDir) {
  const base = baseDir ? `<base href="${escapeHtml(require('node:url').pathToFileURL(baseDir + path.sep).href)}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${base}<title>${escapeHtml(title || '')}</title><style>${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

function textToHtml(text) {
  // Blank lines separate paragraphs; single newlines are kept as line breaks.
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

let turndown = null;
function htmlToMarkdown(html) {
  if (!turndown) {
    const TurndownService = require('turndown');
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndown.remove(['script', 'style', 'head', 'title']);
    turndown.addRule('table', {
      filter: 'table',
      replacement(_content, node) {
        const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()),
        );
        if (!rows.length) return '';
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ')} |`;
        return `\n\n${line(rows[0])}\n| ${Array(cols).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
      },
    });
  }
  // Inline data: images would bloat Markdown into megabytes.
  return turndown.turndown(html.replace(/<img[^>]+src="data:[^"]*"[^>]*>/gi, '')).trim() + '\n';
}

function htmlToText(html) {
  const { convert } = require('html-to-text');
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
    ],
  }).trim() + '\n';
}

/**
 * Read a document as an HTML body fragment.
 * @returns {Promise<{body: string, full: string|null, title: string, baseDir: string}>}
 */
async function readAsHtml(src) {
  const fmt = formatOfPath(src);
  const title = stem(src);
  const baseDir = path.dirname(src);
  if (fmt === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.convertToHtml({ path: src });
    return { body: value, full: null, title, baseDir };
  }
  const text = await fs.readFile(src, 'utf8');
  if (fmt === 'md') {
    const { marked } = require('marked');
    return { body: await marked.parse(text, { gfm: true }), full: null, title, baseDir };
  }
  if (fmt === 'html') {
    const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(text);
    return { body: m ? m[1] : text, full: text, title, baseDir };
  }
  return { body: textToHtml(text), full: null, title, baseDir, plain: text };
}

/** HTML string ready for printing (used for -> PDF and for merging). */
async function printableHtml(src) {
  const doc = await readAsHtml(src);
  if (doc.full) {
    // Keep the page's own styles; just make relative URLs resolve.
    const base = `<base href="${escapeHtml(require('node:url').pathToFileURL(doc.baseDir + path.sep).href)}">`;
    return /<head[^>]*>/i.test(doc.full) ? doc.full.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${base}`) : base + doc.full;
  }
  return wrapDocument(doc.body, doc.title, doc.baseDir);
}

async function toPdfBuffer(src, ctx) {
  if (!ctx.bridge?.htmlToPdf) throw new Error('PDF printing is not available');
  return ctx.bridge.htmlToPdf(await printableHtml(src));
}

async function convert(src, target, ctx) {
  const fmt = formatOfPath(src);
  const out = outputFor(src, { ext: target, outDir: ctx.outDir });
  let data;
  switch (target) {
    case 'pdf':
      data = await toPdfBuffer(src, ctx);
      break;
    case 'docx': {
      const doc = await readAsHtml(src);
      data = await htmlToDocx(doc.body, { baseDir: doc.baseDir, title: doc.title });
      break;
    }
    case 'md': {
      if (fmt === 'txt') {
        data = await fs.readFile(src, 'utf8');
        break;
      }
      data = htmlToMarkdown((await readAsHtml(src)).body);
      break;
    }
    case 'txt': {
      if (fmt === 'docx') {
        const mammoth = require('mammoth');
        data = (await mammoth.extractRawText({ path: src })).value.replace(/\n{3,}/g, '\n\n').trim() + '\n';
        break;
      }
      data = htmlToText((await readAsHtml(src)).body);
      break;
    }
    case 'html': {
      const doc = await readAsHtml(src);
      data = wrapDocument(doc.body, doc.title, null);
      break;
    }
    default:
      throw new Error(`Can't convert documents to ${target.toUpperCase()}`);
  }
  await fs.writeFile(out, data);
  return out;
}

module.exports = { convert, toPdfBuffer, readAsHtml, printableHtml, wrapDocument, htmlToMarkdown, htmlToText, textToHtml, escapeHtml };
