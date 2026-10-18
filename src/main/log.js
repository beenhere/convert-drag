'use strict';

// Opt-in diagnostics: run with CONVERTDRAG_DEBUG=1 (or --debug) to log what
// the trigger, overlay and jobs are doing.
const enabled = Boolean(process.env.CONVERTDRAG_DEBUG) || process.argv.includes('--debug');

function debug(...args) {
  if (enabled) console.log('[convertdrag]', ...args);
}

module.exports = { debug, enabled };
