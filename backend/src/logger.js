"use strict";

/**
 * Minimal JSON-lines logger. Callers must never pass request bodies, note content,
 * or Authorization headers: only metadata such as method, path, status and timing.
 */
function createLogger(stream = process.stdout) {
  const write = (level, msg, fields) => {
    stream.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
  };
  return {
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

module.exports = { createLogger };
