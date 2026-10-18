'use strict';

const fs = require('node:fs');
const path = require('node:path');

function stem(file) {
  return path.basename(file, path.extname(file));
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a path that does not exist yet: "Photo.jpg", then "Photo (2).jpg", ...
 * @param {string} dir
 * @param {string} name file name without extension
 * @param {string} ext extension without dot ('' for folders)
 */
function uniquePath(dir, name, ext) {
  const dot = ext ? `.${ext}` : '';
  let candidate = path.join(dir, `${name}${dot}`);
  for (let i = 2; exists(candidate); i++) candidate = path.join(dir, `${name} (${i})${dot}`);
  return candidate;
}

/**
 * Where an output for `src` goes: next to the source unless the user picked
 * an output folder.
 * @param {string} src
 * @param {{ext: string, suffix?: string, outDir?: string|null, name?: string}} opts
 */
function outputFor(src, { ext, suffix = '', outDir = null, name = null }) {
  const dir = outDir || path.dirname(src);
  return uniquePath(dir, `${name || stem(src)}${suffix}`, ext);
}

module.exports = { stem, uniquePath, outputFor };
