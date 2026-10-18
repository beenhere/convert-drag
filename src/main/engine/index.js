'use strict';

// Dispatches a menu action to the right converter. Everything here is plain
// Node; work that needs Chromium (rendering PDFs, printing HTML) goes through
// ctx.bridge, which the Electron main process provides.

const fs = require('node:fs/promises');
const path = require('node:path');
const { formatOfPath, kindOf, parseAction } = require('../catalog');
const { outputFor, stem } = require('./naming');

const image = require('./image');
const media = require('./media');
const pdf = require('./pdf');
const docs = require('./docs');
const data = require('./data');

const CONVERTERS = { image, video: media, audio: media, pdf, doc: docs, data };

async function zip(files, ctx) {
  const JSZip = require('jszip');
  const archive = new JSZip();
  const used = new Set();
  for (const f of files) {
    const stat = await fs.stat(f);
    let name = path.basename(f);
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem(f)} (${i})${path.extname(f)}`;
    used.add(name.toLowerCase());
    if (stat.isDirectory()) await addDir(archive.folder(name), f);
    else archive.file(name, await fs.readFile(f), { date: stat.mtime });
  }
  const buf = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) => ctx.progress?.(m.percent / 100));
  const out = outputFor(files[0], { ext: 'zip', name: files.length > 1 ? 'Archive' : stem(files[0]), outDir: ctx.outDir });
  await fs.writeFile(out, buf);
  return out;
}

async function addDir(folder, dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await addDir(folder.folder(entry.name), p);
    else if (entry.isFile()) folder.file(entry.name, await fs.readFile(p));
  }
}

/** Run one tool on one file. Returns the output path. */
async function runTool(tool, file, kind, params, ctx) {
  const k = kind;
  switch (tool) {
    case 'compress':
      return CONVERTERS[k].compress(file, ctx);
    case 'metadata':
      return CONVERTERS[k].stripMetadata(file, ctx);
    case 'rotate':
      return CONVERTERS[k].rotate(file, ctx);
    case 'crop':
      return image.crop(file, params, ctx);
    case 'edit':
      return image.adjust(file, params, ctx);
    case 'background':
      return image.background(file, params, ctx);
    case 'annotate':
      return image.markup(file, params, ctx, ' Annotated');
    case 'redact':
      return image.markup(file, params, ctx, ' Redacted');
    case 'trim':
      return media.trim(file, params, ctx);
    case 'mute':
      return media.mute(file, ctx);
    case 'resize':
      return media.resize(file, ctx, 720);
    case 'snapshot':
      return media.snapshot(file, ctx, params?.at);
    case 'normalize':
      return media.normalize(file, ctx);
    case 'split':
      return pdf.split(file, ctx);
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

/**
 * @param {{actionId: string, files: string[], params?: object}} job
 * @param {{outDir?: string|null, settings?: object, bridge?: object, progress?: (f: number) => void, signal?: AbortSignal}} ctx
 * @returns {Promise<{outputs: string[], errors: Array<{file: string, message: string}>}>}
 */
async function run({ actionId, files, params = {} }, ctx = {}) {
  const action = parseAction(actionId);
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  if (!files?.length) throw new Error('No files');
  const report = ctx.progress || (() => {});
  const outputs = [];
  const errors = [];

  // Whole-selection actions.
  if (action.type === 'tool' && action.tool === 'zip') {
    outputs.push(await zip(files, { ...ctx, progress: report }));
    return { outputs, errors };
  }
  if (action.type === 'tool' && action.tool === 'merge-pdf') {
    outputs.push(await pdf.merge(files, { ...ctx, progress: report }));
    return { outputs, errors };
  }
  if (action.type === 'tool' && action.tool === 'merge') {
    const kind = kindOf(formatOfPath(files[0]));
    const out = kind === 'pdf' ? await pdf.merge(files, { ...ctx, progress: report }) : await media.merge(files, { ...ctx, progress: report });
    outputs.push(out);
    return { outputs, errors };
  }

  // Per-file actions.
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileCtx = { ...ctx, progress: (f) => report((i + Math.max(0, Math.min(1, f))) / files.length) };
    try {
      const kind = kindOf(formatOfPath(file));
      if (!kind) throw new Error(`Unsupported file type: ${path.extname(file) || path.basename(file)}`);
      let out;
      if (action.type === 'convert') {
        out = await CONVERTERS[kind].convert(file, action.target, fileCtx);
      } else {
        out = await runTool(action.tool, file, kind, params, fileCtx);
      }
      outputs.push(out);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      errors.push({ file, message: e.message || String(e) });
    }
    report((i + 1) / files.length);
  }
  if (!outputs.length && errors.length) {
    const err = new Error(errors[0].message);
    err.errors = errors;
    throw err;
  }
  return { outputs, errors };
}

module.exports = { run, image, media, pdf, docs, data };
