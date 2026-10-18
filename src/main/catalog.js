'use strict';

// Which file types we understand, and which menu each kind of file gets.
// The overlay only knows MIME types while a drag is in progress (browsers hide
// file names until the drop), so every format lists the MIME types Chromium
// may report for it on Windows and macOS.

const path = require('node:path');

const FORMATS = {
  // Images
  jpg: { kind: 'image', label: 'JPG', ext: ['jpg', 'jpeg', 'jpe', 'jfif'], mime: ['image/jpeg', 'image/pjpeg'] },
  png: { kind: 'image', label: 'PNG', ext: ['png'], mime: ['image/png', 'image/apng'] },
  webp: { kind: 'image', label: 'WEBP', ext: ['webp'], mime: ['image/webp'] },
  avif: { kind: 'image', label: 'AVIF', ext: ['avif'], mime: ['image/avif'] },
  heic: { kind: 'image', label: 'HEIC', ext: ['heic', 'heif'], mime: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'] },
  tiff: { kind: 'image', label: 'TIFF', ext: ['tiff', 'tif'], mime: ['image/tiff'] },
  gif: { kind: 'image', label: 'GIF', ext: ['gif'], mime: ['image/gif'] },
  bmp: { kind: 'image', label: 'BMP', ext: ['bmp', 'dib'], mime: ['image/bmp', 'image/x-ms-bmp', 'image/x-bmp'] },
  ico: { kind: 'image', label: 'ICO', ext: ['ico'], mime: ['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'] },
  svg: { kind: 'image', label: 'SVG', ext: ['svg'], mime: ['image/svg+xml'] },

  // Video
  mp4: { kind: 'video', label: 'MP4', ext: ['mp4', 'm4v'], mime: ['video/mp4', 'video/x-m4v'] },
  mov: { kind: 'video', label: 'MOV', ext: ['mov', 'qt'], mime: ['video/quicktime'] },
  webm: { kind: 'video', label: 'WEBM', ext: ['webm'], mime: ['video/webm'] },
  mkv: { kind: 'video', label: 'MKV', ext: ['mkv'], mime: ['video/x-matroska', 'video/matroska'] },
  avi: { kind: 'video', label: 'AVI', ext: ['avi'], mime: ['video/x-msvideo', 'video/avi', 'video/msvideo'] },
  wmv: { kind: 'video', label: 'WMV', ext: ['wmv'], mime: ['video/x-ms-wmv'] },
  flv: { kind: 'video', label: 'FLV', ext: ['flv'], mime: ['video/x-flv'] },
  mpg: { kind: 'video', label: 'MPEG', ext: ['mpg', 'mpeg', 'm2v'], mime: ['video/mpeg'] },
  '3gp': { kind: 'video', label: '3GP', ext: ['3gp', '3g2'], mime: ['video/3gpp', 'video/3gpp2'] },
  ts: { kind: 'video', label: 'TS', ext: ['mts', 'm2ts'], mime: ['video/mp2t'] },

  // Audio
  mp3: { kind: 'audio', label: 'MP3', ext: ['mp3'], mime: ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'] },
  wav: { kind: 'audio', label: 'WAV', ext: ['wav', 'wave'], mime: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  m4a: { kind: 'audio', label: 'M4A', ext: ['m4a'], mime: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  aac: { kind: 'audio', label: 'AAC', ext: ['aac'], mime: ['audio/aac', 'audio/x-aac', 'audio/aacp'] },
  flac: { kind: 'audio', label: 'FLAC', ext: ['flac'], mime: ['audio/flac', 'audio/x-flac'] },
  ogg: { kind: 'audio', label: 'OGG', ext: ['ogg', 'oga'], mime: ['audio/ogg', 'audio/vorbis'] },
  opus: { kind: 'audio', label: 'OPUS', ext: ['opus'], mime: ['audio/opus'] },
  aiff: { kind: 'audio', label: 'AIFF', ext: ['aiff', 'aif', 'aifc'], mime: ['audio/aiff', 'audio/x-aiff'] },
  wma: { kind: 'audio', label: 'WMA', ext: ['wma'], mime: ['audio/x-ms-wma'] },

  // PDF
  pdf: { kind: 'pdf', label: 'PDF', ext: ['pdf'], mime: ['application/pdf', 'application/x-pdf'] },

  // Documents
  docx: { kind: 'doc', label: 'DOCX', ext: ['docx'], mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  md: { kind: 'doc', label: 'MD', ext: ['md', 'markdown', 'mdown', 'mkd'], mime: ['text/markdown', 'text/x-markdown'] },
  txt: { kind: 'doc', label: 'TXT', ext: ['txt', 'text', 'log'], mime: ['text/plain'] },
  html: { kind: 'doc', label: 'HTML', ext: ['html', 'htm', 'xhtml'], mime: ['text/html', 'application/xhtml+xml'] },

  // Data
  csv: { kind: 'data', label: 'CSV', ext: ['csv'], mime: ['text/csv', 'text/comma-separated-values', 'application/csv'] },
  tsv: { kind: 'data', label: 'TSV', ext: ['tsv', 'tab'], mime: ['text/tab-separated-values'] },
  json: { kind: 'data', label: 'JSON', ext: ['json'], mime: ['application/json', 'text/json'] },
  xlsx: { kind: 'data', label: 'XLSX', ext: ['xlsx'], mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
};

// Conversion targets offered per kind, in menu order. A file is never offered
// its own format.
const TARGETS = {
  image: ['jpg', 'png', 'webp', 'avif', 'pdf', 'gif', 'tiff', 'bmp', 'ico'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'gif', 'mp3', 'wav'],
  audio: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aiff', 'aac'],
  pdf: ['jpg', 'png', 'webp', 'txt', 'docx', 'md', 'html'],
  doc: ['pdf', 'docx', 'md', 'txt', 'html'],
  data: ['csv', 'tsv', 'json', 'xlsx', 'md', 'html'],
};

// Labels for targets that are not formats in FORMATS (or need a different label).
const TARGET_LABELS = { gif: 'GIF', mp3: 'MP3', wav: 'WAV', md: 'MD', html: 'HTML', pdf: 'PDF', txt: 'TXT' };

const TOOLS = {
  compress: { label: 'Compress', icon: 'compress', hint: 'Make it smaller' },
  crop: { label: 'Crop', icon: 'crop', hint: 'Crop image', editor: 'crop' },
  background: { label: 'Add BG', icon: 'background', hint: 'Add a background', editor: 'background' },
  edit: { label: 'Edit', icon: 'sliders', hint: 'Adjust, rotate, resize', editor: 'edit' },
  annotate: { label: 'Annotate', icon: 'pen', hint: 'Draw arrows, boxes, text', editor: 'annotate' },
  redact: { label: 'Redact', icon: 'eye-off', hint: 'Hide sensitive parts', editor: 'redact' },
  metadata: { label: 'Metadata', icon: 'tag', hint: 'Strip metadata' },
  rotate: { label: 'Rotate', icon: 'rotate', hint: 'Rotate 90° clockwise' },
  trim: { label: 'Trim', icon: 'scissors', hint: 'Cut start and end', editor: 'trim' },
  mute: { label: 'Mute', icon: 'mute', hint: 'Remove audio' },
  resize: { label: '720p', icon: 'resize', hint: 'Scale down to 720p' },
  snapshot: { label: 'Frame', icon: 'camera', hint: 'Save a still frame' },
  normalize: { label: 'Normalize', icon: 'wave', hint: 'Even out loudness' },
  split: { label: 'Split', icon: 'split', hint: 'One PDF per page' },
  merge: { label: 'Merge', icon: 'merge', hint: 'Join into one file', multi: true },
  'merge-pdf': { label: 'Merge PDF', icon: 'merge', hint: 'Combine into one PDF', multi: true },
  zip: { label: 'Zip', icon: 'zip', hint: 'Put in a .zip archive' },
};

const KIND_TOOLS = {
  image: ['compress', 'crop', 'background', 'edit', 'annotate', 'redact', 'metadata', 'rotate'],
  video: ['compress', 'trim', 'mute', 'resize', 'snapshot', 'rotate', 'metadata', 'zip'],
  audio: ['compress', 'trim', 'normalize', 'metadata', 'zip'],
  pdf: ['compress', 'split', 'rotate', 'metadata', 'zip'],
  doc: ['zip'],
  data: ['zip'],
};

// Extra tools shown when several files of the same kind are dragged together.
const MULTI_TOOLS = {
  image: ['merge-pdf', 'zip'],
  video: ['merge'],
  audio: ['merge'],
  pdf: ['merge'],
  doc: ['merge-pdf'],
  data: [],
};

const PDFABLE = new Set(['image', 'pdf', 'doc']);
const MAX_WEDGES = 8;

const extIndex = new Map();
const mimeIndex = new Map();
for (const [id, f] of Object.entries(FORMATS)) {
  for (const e of f.ext) extIndex.set(e, id);
  for (const m of f.mime) if (!mimeIndex.has(m)) mimeIndex.set(m, id);
}
// Windows reports .csv as an Excel type when Office is installed.
mimeIndex.set('application/vnd.ms-excel', 'csv');
mimeIndex.set('audio/webm', 'webm');
mimeIndex.set('video/ogg', 'webm');

function formatOfPath(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  return extIndex.get(ext) || null;
}

function formatOfMime(m) {
  if (!m) return null;
  return mimeIndex.get(String(m).toLowerCase().split(';')[0].trim()) || null;
}

function kindOf(format) {
  return format && FORMATS[format] ? FORMATS[format].kind : null;
}

function labelOf(format) {
  return (FORMATS[format] && FORMATS[format].label) || TARGET_LABELS[format] || String(format).toUpperCase();
}

function toolItem(id) {
  const t = TOOLS[id];
  return { id: `tool:${id}`, label: t.label, icon: t.icon, hint: t.hint, editor: t.editor || null };
}

function convertItem(target) {
  return { id: `to:${target}`, label: labelOf(target), icon: null, hint: `Save as ${labelOf(target)}`, editor: null };
}

function chunk(items, name) {
  if (items.length <= MAX_WEDGES) return items.length ? [{ name, items }] : [];
  const pages = [];
  for (let i = 0; i < items.length; i += MAX_WEDGES) {
    pages.push({ name: i === 0 ? name : `${name} ${i / MAX_WEDGES + 1}`, items: items.slice(i, i + MAX_WEDGES) });
  }
  return pages;
}

/**
 * Build the radial menu for a set of dragged files.
 * @param {Array<string|null>} formats one entry per file; null = unknown
 * @returns {{kind: string, title: string, count: number, pages: Array<{name: string, items: object[]}>}}
 */
function menuFor(formats) {
  const count = formats.length;
  const known = formats.filter(Boolean);
  if (count === 0 || known.length < count) {
    // Some file has a type we can't see yet (or don't support). The overlay
    // asks again with real paths after the drop.
    return { kind: 'unknown', title: count > 1 ? `${count} files` : 'File', count, pages: [{ name: 'Files', items: [toolItem('zip')] }] };
  }
  const kinds = new Set(known.map(kindOf));
  if (kinds.size > 1) {
    const items = [];
    if ([...kinds].every((k) => PDFABLE.has(k))) items.push(toolItem('merge-pdf'));
    items.push(toolItem('zip'));
    return { kind: 'mixed', title: `${count} files`, count, pages: [{ name: 'Tools', items }] };
  }
  const kind = [...kinds][0];
  const sameFormat = new Set(known).size === 1 ? known[0] : null;
  const targets = TARGETS[kind].filter((t) => t !== sameFormat);
  const tools = [...KIND_TOOLS[kind]];
  if (count > 1) {
    for (const t of MULTI_TOOLS[kind]) if (!tools.includes(t)) tools.unshift(t);
    // Editors work on one file at a time.
    for (let i = tools.length - 1; i >= 0; i--) if (TOOLS[tools[i]].editor) tools.splice(i, 1);
  }
  const pages = [...chunk(targets.map(convertItem), 'Convert'), ...chunk(tools.map(toolItem), 'Tools')];
  const title = count > 1 ? `${count} ${kind === 'pdf' ? 'PDFs' : kind + 's'}` : labelOf(sameFormat);
  return { kind, title, count, pages };
}

function menuForPaths(paths) {
  return menuFor(paths.map(formatOfPath));
}

function menuForMimes(mimes) {
  return menuFor(mimes.map(formatOfMime));
}

function parseAction(id) {
  const [type, name] = String(id).split(':');
  if (type === 'to' && name) return { type: 'convert', target: name };
  if (type === 'tool' && TOOLS[name]) return { type: 'tool', tool: name, editor: TOOLS[name].editor || null };
  return null;
}

function menuHas(menu, actionId) {
  return menu.pages.some((p) => p.items.some((i) => i.id === actionId));
}

/** Format-to-format conversions on offer (each input format × its targets). */
function countConversions() {
  let n = 0;
  for (const [id, f] of Object.entries(FORMATS)) n += TARGETS[f.kind].filter((t) => t !== id).length;
  return { conversions: n, tools: Object.keys(TOOLS).length, formats: Object.keys(FORMATS).length };
}

module.exports = {
  FORMATS,
  TARGETS,
  TOOLS,
  MAX_WEDGES,
  formatOfPath,
  formatOfMime,
  kindOf,
  labelOf,
  menuFor,
  menuForPaths,
  menuForMimes,
  parseAction,
  menuHas,
  countConversions,
};
