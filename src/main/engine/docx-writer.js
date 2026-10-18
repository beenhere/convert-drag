'use strict';

// Minimal HTML -> DOCX. Handles what Markdown, plain text, mammoth and our PDF
// text extraction produce: headings, paragraphs, inline styles, links, lists,
// block quotes, code, tables and images.

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { parseDocument } = require('htmlparser2');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  ExternalHyperlink,
  AlignmentType,
  LevelFormat,
  BorderStyle,
  ShadingType,
} = require('docx');

const HEADINGS = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};
const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'body', 'html', 'figure', 'figcaption', 'center', 'nav', 'aside', 'details', 'summary', 'form', 'dl', 'dd', 'dt', 'tbody']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'svg', 'iframe', 'object', 'button', 'input', 'select', 'textarea']);
const MONO = 'Consolas';
const MAX_IMG_WIDTH = 600;

function isTag(n, name) {
  return n.type === 'tag' && (!name || n.name === name);
}

function find(nodes, name) {
  for (const n of nodes) {
    if (isTag(n, name)) return n;
    if (n.children) {
      const hit = find(n.children, name);
      if (hit) return hit;
    }
  }
  return null;
}

function textOf(n) {
  if (n.type === 'text') return n.data;
  if (!n.children) return '';
  return n.children.map(textOf).join('');
}

function decodeEntities(s) {
  // htmlparser2 decodes entities in text by default; this catches attribute leftovers.
  return s.replace(/&amp;/g, '&');
}

async function loadImages(root, baseDir) {
  const map = new Map();
  const imgs = [];
  (function walk(nodes) {
    for (const n of nodes) {
      if (isTag(n, 'img') && n.attribs?.src) imgs.push(n.attribs.src);
      if (n.children) walk(n.children);
    }
  })(root.children || []);
  for (const src of imgs) {
    if (map.has(src)) continue;
    try {
      let buf;
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
      if (m) buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      else if (/^[a-z]+:/i.test(src) && !/^file:/i.test(src)) continue; // remote images are skipped
      else {
        const p = /^file:/i.test(src) ? new URL(src).pathname : path.resolve(baseDir || '.', decodeURIComponent(src));
        buf = await fs.readFile(p);
      }
      const meta = await sharp(buf).metadata();
      let type = { jpeg: 'jpg', png: 'png', gif: 'gif' }[meta.format];
      if (!type) {
        buf = await sharp(buf).png().toBuffer();
        type = 'png';
      }
      const scale = Math.min(1, MAX_IMG_WIDTH / (meta.width || MAX_IMG_WIDTH));
      map.set(src, { data: buf, type, width: Math.round((meta.width || 100) * scale), height: Math.round((meta.height || 100) * scale) });
    } catch {
      // Unreadable image: leave it out rather than failing the whole document.
    }
  }
  return map;
}

class Writer {
  constructor(images) {
    this.images = images;
    this.listInstance = 0;
  }

  /** Flatten inline HTML into plain items: text, break, image, link. */
  items(nodes, style = {}) {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'text') {
        const text = style.pre ? n.data : n.data.replace(/\s+/g, ' ');
        if (text) out.push({ kind: 'text', text, style });
        continue;
      }
      if (n.type !== 'tag' || SKIP.has(n.name)) continue;
      const kids = n.children || [];
      switch (n.name) {
        case 'br':
          out.push({ kind: 'break' });
          break;
        case 'img': {
          const img = this.images.get(n.attribs?.src);
          if (img) out.push({ kind: 'image', img });
          else if (n.attribs?.alt) out.push({ kind: 'text', text: `[${n.attribs.alt}]`, style });
          break;
        }
        case 'a': {
          const href = decodeEntities(n.attribs?.href || '');
          const inner = this.items(kids, { ...style, link: /^(https?:|mailto:)/i.test(href) });
          if (/^(https?:|mailto:)/i.test(href) && inner.length) out.push({ kind: 'link', href, items: inner });
          else out.push(...inner);
          break;
        }
        case 'strong':
        case 'b':
          out.push(...this.items(kids, { ...style, bold: true }));
          break;
        case 'em':
        case 'i':
        case 'cite':
          out.push(...this.items(kids, { ...style, italics: true }));
          break;
        case 'u':
        case 'ins':
          out.push(...this.items(kids, { ...style, underline: true }));
          break;
        case 's':
        case 'del':
        case 'strike':
          out.push(...this.items(kids, { ...style, strike: true }));
          break;
        case 'code':
        case 'kbd':
        case 'samp':
        case 'tt':
          out.push(...this.items(kids, { ...style, code: true }));
          break;
        case 'sup':
          out.push(...this.items(kids, { ...style, sup: true }));
          break;
        case 'sub':
          out.push(...this.items(kids, { ...style, sub: true }));
          break;
        case 'mark':
          out.push(...this.items(kids, { ...style, mark: true }));
          break;
        default:
          out.push(...this.items(kids, style));
      }
    }
    return out;
  }

  build(items) {
    return items.map((it) => {
      if (it.kind === 'break') return new TextRun({ text: '', break: 1 });
      if (it.kind === 'image') return new ImageRun({ type: it.img.type, data: it.img.data, transformation: { width: it.img.width, height: it.img.height } });
      if (it.kind === 'link') return new ExternalHyperlink({ link: it.href, children: this.build(it.items) });
      return this.textRun(it.text, it.style);
    });
  }

  textRun(text, s) {
    return new TextRun({
      text,
      bold: s.bold || undefined,
      italics: s.italics || undefined,
      underline: s.underline || s.link ? {} : undefined,
      strike: s.strike || undefined,
      font: s.code || s.pre ? MONO : undefined,
      superScript: s.sup || undefined,
      subScript: s.sub || undefined,
      color: s.link ? '0563C1' : undefined,
      highlight: s.mark ? 'yellow' : undefined,
      shading: s.code && !s.pre ? { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined,
    });
  }

  paragraph(nodes, opts = {}, style = {}) {
    const items = trimItems(this.items(nodes, style));
    if (!items.length && !opts.keepEmpty) return null;
    return new Paragraph({ ...opts, children: this.build(items) });
  }

  blocks(nodes, ctx = {}) {
    const out = [];
    let inline = [];
    const flush = () => {
      if (inline.some((n) => n.type !== 'text' || n.data.trim())) {
        const p = this.paragraph(inline, ctx.para || {}, ctx.style || {});
        if (p) out.push(p);
      }
      inline = [];
    };
    for (const n of nodes) {
      if (n.type === 'text') {
        inline.push(n);
        continue;
      }
      if (n.type !== 'tag' || SKIP.has(n.name)) continue;
      const name = n.name;
      if (HEADINGS[name]) {
        flush();
        const p = this.paragraph(n.children, { heading: HEADINGS[name] });
        if (p) out.push(p);
      } else if (name === 'p') {
        flush();
        const p = this.paragraph(n.children, ctx.para || {}, ctx.style || {});
        if (p) out.push(p);
      } else if (CONTAINERS.has(name)) {
        flush();
        out.push(...this.blocks(n.children, ctx));
      } else if (name === 'ul' || name === 'ol') {
        flush();
        out.push(...this.list(n, 0));
      } else if (name === 'li') {
        flush();
        out.push(...this.blocks(n.children, ctx));
      } else if (name === 'blockquote') {
        flush();
        out.push(
          ...this.blocks(n.children, {
            para: { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 } } },
            style: { italics: true },
          }),
        );
      } else if (name === 'pre') {
        flush();
        const text = textOf(n).replace(/\n$/, '');
        for (const line of text.split('\n')) {
          out.push(
            new Paragraph({
              spacing: { before: 0, after: 0 },
              shading: { type: ShadingType.CLEAR, fill: 'F5F5F5', color: 'auto' },
              children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
            }),
          );
        }
      } else if (name === 'table') {
        flush();
        const t = this.table(n);
        if (t) out.push(t, new Paragraph({ children: [] }));
      } else if (name === 'hr') {
        flush();
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } } }));
      } else {
        inline.push(n);
      }
    }
    flush();
    return out;
  }

  list(node, level) {
    const ordered = node.name === 'ol';
    const instance = ordered ? ++this.listInstance : 0;
    const out = [];
    for (const li of node.children.filter((c) => isTag(c, 'li'))) {
      const inline = [];
      const nested = [];
      for (const c of li.children) {
        if (isTag(c, 'ul') || isTag(c, 'ol')) nested.push(c);
        else if (isTag(c, 'p')) inline.push(...c.children, { type: 'text', data: ' ' });
        else inline.push(c);
      }
      const opts = ordered ? { numbering: { reference: 'cd-ordered', level: Math.min(level, 5), instance } } : { bullet: { level: Math.min(level, 5) } };
      const p = this.paragraph(inline, opts) || new Paragraph({ ...opts, children: [] });
      out.push(p);
      for (const sub of nested) out.push(...this.list(sub, level + 1));
    }
    return out;
  }

  table(node) {
    const rows = [];
    (function collect(nodes) {
      for (const n of nodes) {
        if (isTag(n, 'tr')) rows.push(n);
        else if (n.type === 'tag' && ['thead', 'tbody', 'tfoot'].includes(n.name)) collect(n.children);
      }
    })(node.children);
    if (!rows.length) return null;
    const cellsOf = (tr) => tr.children.filter((c) => isTag(c, 'td') || isTag(c, 'th'));
    const cols = Math.max(...rows.map((r) => cellsOf(r).length));
    if (!cols) return null;
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (tr) =>
          new TableRow({
            children: Array.from({ length: cols }, (_, i) => {
              const cell = cellsOf(tr)[i];
              const header = cell && cell.name === 'th';
              let children = cell ? this.blocks(cell.children, { style: header ? { bold: true } : {} }) : [];
              if (!children.length) children = [new Paragraph({ children: [] })];
              return new TableCell({ children, shading: header ? { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined });
            }),
          }),
      ),
    });
  }
}

/** Drop whitespace at the start and end of a paragraph, as a browser would. */
function trimItems(items) {
  const out = items.slice();
  const edge = (i, fn) => {
    const it = out[i];
    if (!it || it.kind !== 'text' || it.style.pre) return false;
    const text = fn(it.text);
    if (text) {
      out[i] = { ...it, text };
      return false;
    }
    out.splice(i, 1);
    return true;
  };
  while (out.length && edge(0, (t) => t.trimStart()));
  while (out.length && edge(out.length - 1, (t) => t.trimEnd()));
  return out;
}

const orderedLevels = Array.from({ length: 6 }, (_, level) => ({
  level,
  format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}));

/**
 * @param {string} html
 * @param {{baseDir?: string, title?: string}} [opts]
 * @returns {Promise<Buffer>}
 */
async function htmlToDocx(html, { baseDir, title } = {}) {
  const dom = parseDocument(html);
  const root = find(dom.children, 'body') || dom;
  const images = await loadImages(root, baseDir);
  const writer = new Writer(images);
  const children = writer.blocks(root.children);
  const doc = new Document({
    creator: 'ConvertDrag',
    title: title || undefined,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'cd-ordered', levels: orderedLevels }] },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { htmlToDocx };
