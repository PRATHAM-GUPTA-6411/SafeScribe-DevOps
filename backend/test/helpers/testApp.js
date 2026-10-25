"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../../src/app");
const { createLogger } = require("../../src/logger");
const { createMetrics } = require("../../src/metrics");
const { createMemoryRepo } = require("./memoryRepo");

const COGNITO_DOMAIN = "https://example.auth.us-east-1.amazoncognito.com";

/** Starts the real Express app on an ephemeral port with fake auth and an in-memory repo. */
async function startTestApp(opts = {}) {
  let frontendDir = opts.frontendDir;
  if (!frontendDir) {
    frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-frontend-"));
    fs.writeFileSync(path.join(frontendDir, "index.html"), "<!doctype html><title>SafeScribe test</title>");
  }

  const logLines = [];
  const logger = createLogger({ write: (line) => logLines.push(line) });
  const metrics = createMetrics("test-1.2.3");
  const config = {
    appVersion: "test-1.2.3",
    frontendDir,
    maxCiphertextBytes: opts.maxCiphertextBytes || 1024,
    cognito: { userPoolId: "us-east-1_TestPool1", clientId: "client-abc", domain: COGNITO_DOMAIN },
  };
  const verifyToken = async (token) => {
    const match = /^(\w+)-token$/.exec(token);
    if (!match) throw Object.assign(new Error("bad token"), { name: "JwtParseError" });
    return { sub: match[1] };
  };
  const app = createApp({ config, verifyToken, repo: createMemoryRepo(), logger, metrics });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = (method, route, { token, body, raw } = {}) =>
    fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });

  return {
    base,
    call,
    logLines,
    metrics,
    config,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startTestApp, COGNITO_DOMAIN };
