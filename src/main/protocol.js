'use strict';

// cd://app/...  -> files under src/renderer (and vendored pdf.js)
// cd://file/<token> -> a local file the user dropped, registered by the main
//                      process. Supports Range requests so <video> can seek.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { protocol } = require('electron');

const SCHEME = 'cd';
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
};

const files = new Map(); // token -> absolute path

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** Expose a local file to renderer pages; returns its cd:// URL. */
function shareFile(file) {
  for (const [token, p] of files) if (p === file) return `${SCHEME}://file/${token}/${encodeURIComponent(path.basename(file))}`;
  const token = crypto.randomBytes(12).toString('hex');
  files.set(token, file);
  return `${SCHEME}://file/${token}/${encodeURIComponent(path.basename(file))}`;
}

function unshareFile(file) {
  for (const [token, p] of files) if (p === file) files.delete(token);
}

function inside(root, p) {
  const rel = path.relative(root, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveApp(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.startsWith('vendor/pdfjs/')) {
    const p = path.join(PDFJS_ROOT, rel.slice('vendor/pdfjs/'.length));
    return inside(PDFJS_ROOT, p) ? p : null;
  }
  const p = path.join(RENDERER_ROOT, rel);
  return inside(RENDERER_ROOT, p) ? p : null;
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

async function serve(file, request, extraHeaders = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
    if (!stat.isFile()) return notFound();
  } catch {
    return notFound();
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...extraHeaders };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && stat.size > 0) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' cd: data: blob:; media-src 'self' cd:; worker-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'";

function handle() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host === 'app') {
      const p = resolveApp(url.pathname);
      return p ? serve(p, request, p.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {}) : notFound();
    }
    if (url.host === 'file') {
      const token = url.pathname.split('/')[1];
      const p = files.get(token);
      return p ? serve(p, request) : notFound();
    }
    return notFound();
  });
}

function appUrl(rel) {
  return `${SCHEME}://app/${rel}`;
}

module.exports = { registerSchemes, handle, shareFile, unshareFile, appUrl, SCHEME };
