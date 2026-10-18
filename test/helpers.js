'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `convertdrag-${name}-`));
  return dir;
}

module.exports = { tmpDir };
